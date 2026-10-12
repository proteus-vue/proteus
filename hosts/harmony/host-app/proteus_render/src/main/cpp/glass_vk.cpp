// hosts/harmony/host-app/proteus_render/src/main/cpp/glass_vk.cpp
// ★★★液态玻璃 —— Vulkan 离屏渲染落地（鸿蒙 · 决策 #841）。**算法 0 行**（全在 SPIR-V 生成物）。
//
// 【管线形态】一次离屏渲染：
//   · 顶点 = 生成物 `GLASS_VERT_SPV`（vs_quad：按 gl_VertexIndex 展开两个三角形，无顶点缓冲）；
//   · 片元 = 生成物 `GLASS_FRAG_SPV`（fs_glass：读 backdrop 纹理 + uniform，输出玻璃像素）；
//   · 渲染目标 = 盒尺寸的离屏 VkImage（RGBA8）→ 读回 host（vkCmdCopyImageToBuffer）。
// 【绑定契约（与 glass.wgsl 一致）】set0: b0=background 采样纹理, b1=sampler（线性+clamp）, b2=uniform(80B)。
//
// 【★★★性能（决策 #845 · 真机"滚动卡顿"根治）】v1 每帧 `vkCreateInstance`后的**重建整条管线**
//   （renderPass/framebuffer/pipeline/descriptorPool/图像/缓冲）——真机实测**单帧 615ms**（玻璃，n=33）
//   ⇒ 滚动卡死。v2 改**资源缓存**：
//     · 尺寸无关的（renderPass / pipeline（**动态 viewport**）/ sampler / commandPool / fence / shader 模块）
//       **初始化时建一次**，全程复用；
//     · 尺寸相关的（背景纹理 / 输出图 / framebuffer / 描述符池集）按 **(texW,texH,outW,outH)** 缓存；
//     · 每帧只：写纹理 staging、map uniform、录一小段命令、提交、等待、读回。⇒ 帧成本降到几 ms。
//
// 【健壮性】任何一步失败 ⇒ 记日志 + 返回空 ⇒ 宿主降级为半透明面（**绝不因玻璃把宿主带崩**）。
#include "glass_vk.h"
#include "generated_materials_spirv.h"

#include <vulkan/vulkan.h>
#include <hilog/log.h>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <cstdio>
#include <chrono>

#define GLASS_VK_TAG "ProteusGlassVk"
#define GLASS_VK_DOMAIN 0x0002
// ★hilog 参数序：OH_LOG_Print(LogType, LogLevel, domain, tag, fmt, ...)
#define GLOG(level, ...) OH_LOG_Print(LOG_APP, level, GLASS_VK_DOMAIN, GLASS_VK_TAG, __VA_ARGS__)

namespace proteus_glass_vk {

namespace {

/** 尺寸相关的缓存（每个 (texW,texH,outW,outH) 一份；玻璃尺寸少 ⇒ 命中率极高）。 */
struct SizeCache {
    uint32_t texW = 0, texH = 0, outW = 0, outH = 0;
    VkImage texImg = VK_NULL_HANDLE; VkDeviceMemory texMem = VK_NULL_HANDLE; VkImageView texView = VK_NULL_HANDLE;
    VkBuffer texStaging = VK_NULL_HANDLE; VkDeviceMemory texStagingMem = VK_NULL_HANDLE; void* texMap = nullptr;
    VkImage outImg = VK_NULL_HANDLE; VkDeviceMemory outMem = VK_NULL_HANDLE; VkImageView outView = VK_NULL_HANDLE;
    VkBuffer outStaging = VK_NULL_HANDLE; VkDeviceMemory outStagingMem = VK_NULL_HANDLE; void* outMap = nullptr;
    size_t outBytes = 0;
    VkBuffer ubo = VK_NULL_HANDLE; VkDeviceMemory uboMem = VK_NULL_HANDLE; void* uboMap = nullptr;
    VkFramebuffer fb = VK_NULL_HANDLE;
    VkDescriptorPool pool = VK_NULL_HANDLE; VkDescriptorSet dset = VK_NULL_HANDLE;
};

struct VkCtx {
    bool inited = false;
    bool ok = false;
    std::string why;
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice phys = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    std::string deviceName;
    uint32_t queueFamily = UINT32_MAX;
    VkQueue queue = VK_NULL_HANDLE;
    // 尺寸无关、建一次的对象
    VkShaderModule vs = VK_NULL_HANDLE;
    VkShaderModule fs = VK_NULL_HANDLE;
    VkDescriptorSetLayout setLayout = VK_NULL_HANDLE;
    VkPipelineLayout pipeLayout = VK_NULL_HANDLE;
    VkRenderPass renderPass = VK_NULL_HANDLE;
    VkPipeline pipeline = VK_NULL_HANDLE;       // ★动态 viewport ⇒ 尺寸无关，一次建好复用
    VkSampler sampler = VK_NULL_HANDLE;
    VkCommandPool cmdPool = VK_NULL_HANDLE;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VkFence fence = VK_NULL_HANDLE;
    std::unordered_map<long long, SizeCache> cache;   // key = 打包尺寸
};

VkCtx g_ctx;
std::once_flag g_initOnce;

bool chooseQueueFamily(VkPhysicalDevice phys, uint32_t* out) {
    uint32_t n = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(phys, &n, nullptr);
    std::vector<VkQueueFamilyProperties> qs(n);
    vkGetPhysicalDeviceQueueFamilyProperties(phys, &n, qs.data());
    for (uint32_t i = 0; i < n; i++) if (qs[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) { *out = i; return true; }
    for (uint32_t i = 0; i < n; i++) if (qs[i].queueFlags & VK_QUEUE_COMPUTE_BIT) { *out = i; return true; }
    return false;
}

VkShaderModule makeShaderModule(VkDevice dev, const uint32_t* code, size_t byteLen) {
    VkShaderModuleCreateInfo ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    ci.codeSize = byteLen;
    ci.pCode = code;
    VkShaderModule mod = VK_NULL_HANDLE;
    if (vkCreateShaderModule(dev, &ci, nullptr, &mod) != VK_SUCCESS) return VK_NULL_HANDLE;
    return mod;
}

uint32_t findMemoryType(VkPhysicalDevice phys, uint32_t typeBits, VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(phys, &mp);
    for (uint32_t i = 0; i < mp.memoryTypeCount; i++)
        if ((typeBits & (1u << i)) && (mp.memoryTypes[i].propertyFlags & props) == props) return i;
    return UINT32_MAX;
}

/** 建尺寸无关的管线（动态 viewport/scissor ⇒ pipeline 与输出尺寸解耦，一次建好长期复用）。 */
bool buildPipeline() {
    VkDevice dev = g_ctx.device;
    // 描述符集布局：b0 采样纹理, b1 采样器, b2 uniform
    VkDescriptorSetLayoutBinding binds[3] = {};
    binds[0].binding = 0; binds[0].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE; binds[0].descriptorCount = 1; binds[0].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    binds[1].binding = 1; binds[1].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLER;       binds[1].descriptorCount = 1; binds[1].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    binds[2].binding = 2; binds[2].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER; binds[2].descriptorCount = 1; binds[2].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    VkDescriptorSetLayoutCreateInfo lci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    lci.bindingCount = 3; lci.pBindings = binds;
    if (vkCreateDescriptorSetLayout(dev, &lci, nullptr, &g_ctx.setLayout) != VK_SUCCESS) { g_ctx.why = "setLayout"; return false; }
    VkPipelineLayoutCreateInfo plci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    plci.setLayoutCount = 1; plci.pSetLayouts = &g_ctx.setLayout;
    if (vkCreatePipelineLayout(dev, &plci, nullptr, &g_ctx.pipeLayout) != VK_SUCCESS) { g_ctx.why = "pipeLayout"; return false; }
    // render pass（尺寸无关：格式固定）
    { VkAttachmentDescription col{};
      col.format = VK_FORMAT_R8G8B8A8_UNORM; col.samples = VK_SAMPLE_COUNT_1_BIT;
      col.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR; col.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
      col.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE; col.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
      col.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED; col.finalLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
      VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
      VkSubpassDescription sp{}; sp.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS; sp.colorAttachmentCount = 1; sp.pColorAttachments = &ref;
      VkSubpassDependency dep{};
      dep.srcSubpass = VK_SUBPASS_EXTERNAL; dep.dstSubpass = 0;
      dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT; dep.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
      dep.srcAccessMask = 0; dep.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
      VkRenderPassCreateInfo rpci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
      rpci.attachmentCount = 1; rpci.pAttachments = &col; rpci.subpassCount = 1; rpci.pSubpasses = &sp;
      rpci.dependencyCount = 1; rpci.pDependencies = &dep;
      if (vkCreateRenderPass(dev, &rpci, nullptr, &g_ctx.renderPass) != VK_SUCCESS) { g_ctx.why = "renderPass"; return false; } }
    // 图形管线（★动态 viewport/scissor）
    { VkPipelineShaderStageCreateInfo st[2] = {};
      st[0] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}; st[0].stage = VK_SHADER_STAGE_VERTEX_BIT; st[0].module = g_ctx.vs; st[0].pName = "vs_quad";
      st[1] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}; st[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT; st[1].module = g_ctx.fs; st[1].pName = "fs_glass";
      VkPipelineVertexInputStateCreateInfo vi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
      VkPipelineInputAssemblyStateCreateInfo ia{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
      ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
      VkPipelineViewportStateCreateInfo vsi{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
      vsi.viewportCount = 1; vsi.scissorCount = 1;   // 动态：pViewports/pScissors 忽略
      VkPipelineRasterizationStateCreateInfo rs{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
      rs.polygonMode = VK_POLYGON_MODE_FILL; rs.cullMode = VK_CULL_MODE_NONE; rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE; rs.lineWidth = 1.0f;
      VkPipelineMultisampleStateCreateInfo ms{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
      ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
      VkPipelineColorBlendAttachmentState cba{}; cba.colorWriteMask = 0xF; cba.blendEnable = VK_FALSE;
      VkPipelineColorBlendStateCreateInfo cb{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
      cb.attachmentCount = 1; cb.pAttachments = &cba;
      VkDynamicState dyn[2] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
      VkPipelineDynamicStateCreateInfo dy{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
      dy.dynamicStateCount = 2; dy.pDynamicStates = dyn;
      VkGraphicsPipelineCreateInfo gpci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
      gpci.stageCount = 2; gpci.pStages = st; gpci.pVertexInputState = &vi; gpci.pInputAssemblyState = &ia;
      gpci.pViewportState = &vsi; gpci.pRasterizationState = &rs; gpci.pMultisampleState = &ms;
      gpci.pColorBlendState = &cb; gpci.pDynamicState = &dy; gpci.layout = g_ctx.pipeLayout; gpci.renderPass = g_ctx.renderPass; gpci.subpass = 0;
      if (vkCreateGraphicsPipelines(dev, VK_NULL_HANDLE, 1, &gpci, nullptr, &g_ctx.pipeline) != VK_SUCCESS) { g_ctx.why = "graphicsPipeline"; return false; } }
    // 采样器（线性 + clamp）
    { VkSamplerCreateInfo si{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
      si.magFilter = VK_FILTER_LINEAR; si.minFilter = VK_FILTER_LINEAR;
      si.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE; si.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
      si.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
      if (vkCreateSampler(dev, &si, nullptr, &g_ctx.sampler) != VK_SUCCESS) { g_ctx.why = "sampler"; return false; } }
    // 命令池 + 命令缓冲 + 围栏（一次建好复用）
    { VkCommandPoolCreateInfo cpci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
      cpci.queueFamilyIndex = g_ctx.queueFamily; cpci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
      if (vkCreateCommandPool(dev, &cpci, nullptr, &g_ctx.cmdPool) != VK_SUCCESS) { g_ctx.why = "cmdPool"; return false; }
      VkCommandBufferAllocateInfo cbai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
      cbai.commandPool = g_ctx.cmdPool; cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY; cbai.commandBufferCount = 1;
      if (vkAllocateCommandBuffers(dev, &cbai, &g_ctx.cmd) != VK_SUCCESS) { g_ctx.why = "allocCmd"; return false; }
      VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
      if (vkCreateFence(dev, &fci, nullptr, &g_ctx.fence) != VK_SUCCESS) { g_ctx.why = "fence"; return false; } }
    return true;
}

void initOnce() {
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "proteus-glass"; app.applicationVersion = 1;
    app.pEngineName = "proteus"; app.engineVersion = 1; app.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo ci{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ci.pApplicationInfo = &app;
    if (vkCreateInstance(&ci, nullptr, &g_ctx.instance) != VK_SUCCESS) { g_ctx.why = "vkCreateInstance failed"; return; }
    uint32_t dn = 0;
    if (vkEnumeratePhysicalDevices(g_ctx.instance, &dn, nullptr) != VK_SUCCESS || dn == 0) { g_ctx.why = "no physical device"; return; }
    std::vector<VkPhysicalDevice> devs(dn);
    vkEnumeratePhysicalDevices(g_ctx.instance, &dn, devs.data());
    g_ctx.phys = devs[0];
    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(g_ctx.phys, &props);
    g_ctx.deviceName = props.deviceName;
    if (!chooseQueueFamily(g_ctx.phys, &g_ctx.queueFamily)) { g_ctx.why = "no graphics/compute queue"; return; }
    float prio = 1.0f;
    VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = g_ctx.queueFamily; qci.queueCount = 1; qci.pQueuePriorities = &prio;
    VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.queueCreateInfoCount = 1; dci.pQueueCreateInfos = &qci;
    if (vkCreateDevice(g_ctx.phys, &dci, nullptr, &g_ctx.device) != VK_SUCCESS) { g_ctx.why = "vkCreateDevice failed"; return; }
    vkGetDeviceQueue(g_ctx.device, g_ctx.queueFamily, 0, &g_ctx.queue);
    g_ctx.vs = makeShaderModule(g_ctx.device, proteus_shaders::GLASS_VERT_SPV, proteus_shaders::GLASS_VERT_SPV_LEN);
    g_ctx.fs = makeShaderModule(g_ctx.device, proteus_shaders::GLASS_FRAG_SPV, proteus_shaders::GLASS_FRAG_SPV_LEN);
    if (g_ctx.vs == VK_NULL_HANDLE || g_ctx.fs == VK_NULL_HANDLE) { g_ctx.why = "shader module"; return; }
    if (!buildPipeline()) return;
    g_ctx.ok = true;
    g_ctx.why = "ok";
}

/** 为某尺寸分配全套资源（`sc` 的尺寸字段须已设）。★决策 #851：抽出以便批量/缓存复用。 */
static bool buildSizeCache(SizeCache& sc) {
    const uint32_t texW = sc.texW, texH = sc.texH, outW = sc.outW, outH = sc.outH;
    VkDevice dev = g_ctx.device;
    VkPhysicalDevice phys = g_ctx.phys;
    auto failMem = [&](VkDeviceMemory m) { if (m) vkFreeMemory(dev, m, nullptr); };
    // hostBuf：cachedRead=true ⇒ 优先用 **HOST_CACHED**（CPU 读快；回读场景必需——HOST_COHERENT 是
    //   write-combined，CPU 读极慢，真机实测 6MB 回读要 ~70ms）。非 cached 读场景（纹理上传=只写）用 COHERENT。
    auto hostBuf = [&](VkDeviceSize size, VkBufferUsageFlags use, VkBuffer* buf, VkDeviceMemory* mem, void** map, bool cachedRead) -> bool {
        VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO}; bci.size = size; bci.usage = use; bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        if (vkCreateBuffer(dev, &bci, nullptr, buf) != VK_SUCCESS) return false;
        VkMemoryRequirements mr{}; vkGetBufferMemoryRequirements(dev, *buf, &mr);
        VkMemoryPropertyFlags props = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        if (cachedRead) {
            VkMemoryPropertyFlags cp = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_CACHED_BIT;
            if (findMemoryType(phys, mr.memoryTypeBits, cp) != UINT32_MAX) props = cp;
        }
        uint32_t mt = findMemoryType(phys, mr.memoryTypeBits, props);
        if (mt == UINT32_MAX) return false;
        VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO}; mai.allocationSize = mr.size; mai.memoryTypeIndex = mt;
        if (vkAllocateMemory(dev, &mai, nullptr, mem) != VK_SUCCESS) return false;
        if (vkBindBufferMemory(dev, *buf, *mem, 0) != VK_SUCCESS) return false;
        if (map) { if (vkMapMemory(dev, *mem, 0, VK_WHOLE_SIZE, 0, map) != VK_SUCCESS) return false; }
        return true;
    };
    auto image = [&](uint32_t w, uint32_t h, VkImageUsageFlags use, VkImage* img, VkDeviceMemory* mem, VkImageView* view) -> bool {
        VkImageCreateInfo ici{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ici.imageType = VK_IMAGE_TYPE_2D; ici.format = VK_FORMAT_R8G8B8A8_UNORM; ici.extent = {w, h, 1};
        ici.mipLevels = 1; ici.arrayLayers = 1; ici.samples = VK_SAMPLE_COUNT_1_BIT; ici.tiling = VK_IMAGE_TILING_OPTIMAL;
        ici.usage = use; ici.sharingMode = VK_SHARING_MODE_EXCLUSIVE; ici.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        if (vkCreateImage(dev, &ici, nullptr, img) != VK_SUCCESS) return false;
        VkMemoryRequirements mr{}; vkGetImageMemoryRequirements(dev, *img, &mr);
        uint32_t mt = findMemoryType(phys, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        if (mt == UINT32_MAX) return false;
        VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO}; mai.allocationSize = mr.size; mai.memoryTypeIndex = mt;
        if (vkAllocateMemory(dev, &mai, nullptr, mem) != VK_SUCCESS) return false;
        if (vkBindImageMemory(dev, *img, *mem, 0) != VK_SUCCESS) return false;
        VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vci.image = *img; vci.viewType = VK_IMAGE_VIEW_TYPE_2D; vci.format = VK_FORMAT_R8G8B8A8_UNORM;
        vci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        if (vkCreateImageView(dev, &vci, nullptr, view) != VK_SUCCESS) return false;
        return true;
    };
    size_t texBytes = (size_t)texW * texH * 4, outBytes = (size_t)outW * outH * 4;
    if (!hostBuf(texBytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT, &sc.texStaging, &sc.texStagingMem, &sc.texMap, false)) { failMem(sc.texStagingMem); return false; }
    if (!image(texW, texH, VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, &sc.texImg, &sc.texMem, &sc.texView)) { failMem(sc.texMem); return false; }
    if (!image(outW, outH, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, &sc.outImg, &sc.outMem, &sc.outView)) { failMem(sc.outMem); return false; }
    if (!hostBuf(outBytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT, &sc.outStaging, &sc.outStagingMem, &sc.outMap, true /*cached 回读*/)) { failMem(sc.outStagingMem); return false; }
    if (!hostBuf(80, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, &sc.ubo, &sc.uboMem, &sc.uboMap, false)) { failMem(sc.uboMem); return false; }
    sc.outBytes = outBytes;
    { VkImageView atts[1] = {sc.outView};
      VkFramebufferCreateInfo fci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
      fci.renderPass = g_ctx.renderPass; fci.attachmentCount = 1; fci.pAttachments = atts; fci.width = outW; fci.height = outH; fci.layers = 1;
      if (vkCreateFramebuffer(dev, &fci, nullptr, &sc.fb) != VK_SUCCESS) return false; }
    { VkDescriptorPoolSize ps[3] = {
        {VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, 1}, {VK_DESCRIPTOR_TYPE_SAMPLER, 1}, {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1}};
      VkDescriptorPoolCreateInfo dpci{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
      dpci.maxSets = 1; dpci.poolSizeCount = 3; dpci.pPoolSizes = ps;
      if (vkCreateDescriptorPool(dev, &dpci, nullptr, &sc.pool) != VK_SUCCESS) return false;
      VkDescriptorSetAllocateInfo dsai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
      dsai.descriptorPool = sc.pool; dsai.descriptorSetCount = 1; dsai.pSetLayouts = &g_ctx.setLayout;
      if (vkAllocateDescriptorSets(dev, &dsai, &sc.dset) != VK_SUCCESS) return false;
      VkDescriptorImageInfo bgInfo{}; bgInfo.imageView = sc.texView; bgInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
      VkDescriptorImageInfo smpInfo{}; smpInfo.sampler = g_ctx.sampler;
      VkDescriptorBufferInfo ubInfo{}; ubInfo.buffer = sc.ubo; ubInfo.offset = 0; ubInfo.range = 80;
      VkWriteDescriptorSet wr[3] = {};
      wr[0] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[0].dstSet = sc.dset; wr[0].dstBinding = 0; wr[0].descriptorCount = 1;
      wr[0].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE; wr[0].pImageInfo = &bgInfo;
      wr[1] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[1].dstSet = sc.dset; wr[1].dstBinding = 1; wr[1].descriptorCount = 1;
      wr[1].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLER; wr[1].pImageInfo = &smpInfo;
      wr[2] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[2].dstSet = sc.dset; wr[2].dstBinding = 2; wr[2].descriptorCount = 1;
      wr[2].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER; wr[2].pBufferInfo = &ubInfo;
      vkUpdateDescriptorSets(dev, 3, wr, 0, nullptr); }
    return true;
}

/** 复用/建某尺寸缓存（单节点路径）。 */
SizeCache* getSizeCache(uint32_t texW, uint32_t texH, uint32_t outW, uint32_t outH) {
    long long key = ((long long)texW << 42) ^ ((long long)texH << 28) ^ ((long long)outW << 14) ^ (long long)outH;
    auto it = g_ctx.cache.find(key);
    if (it != g_ctx.cache.end()) return &it->second;
    SizeCache sc; sc.texW = texW; sc.texH = texH; sc.outW = outW; sc.outH = outH;
    if (!buildSizeCache(sc)) return nullptr;
    return &g_ctx.cache.emplace(key, sc).first->second;
}

/** 释放某缓存的全部资源。 */
void disposeSizeCache(SizeCache& sc) {
    VkDevice dev = g_ctx.device;
    if (sc.fb) vkDestroyFramebuffer(dev, sc.fb, nullptr);
    if (sc.pool) vkDestroyDescriptorPool(dev, sc.pool, nullptr);
    if (sc.texView) vkDestroyImageView(dev, sc.texView, nullptr);
    if (sc.texImg) vkDestroyImage(dev, sc.texImg, nullptr);
    if (sc.texMem) vkFreeMemory(dev, sc.texMem, nullptr);
    if (sc.texStaging) vkDestroyBuffer(dev, sc.texStaging, nullptr);
    if (sc.texStagingMem) vkFreeMemory(dev, sc.texStagingMem, nullptr);
    if (sc.outView) vkDestroyImageView(dev, sc.outView, nullptr);
    if (sc.outImg) vkDestroyImage(dev, sc.outImg, nullptr);
    if (sc.outMem) vkFreeMemory(dev, sc.outMem, nullptr);
    if (sc.outStaging) vkDestroyBuffer(dev, sc.outStaging, nullptr);
    if (sc.outStagingMem) vkFreeMemory(dev, sc.outStagingMem, nullptr);
    if (sc.ubo) vkDestroyBuffer(dev, sc.ubo, nullptr);
    if (sc.uboMem) vkFreeMemory(dev, sc.uboMem, nullptr);
    sc = SizeCache{};
}

/** 在命令缓冲上录一段玻璃绘制（纹理 upload → 渲染 → 拷出到 outStaging）。 */
void recordGlassDraw(VkCommandBuffer cmd, SizeCache& sc) {
    const uint32_t texW = sc.texW, texH = sc.texH, outW = sc.outW, outH = sc.outH;
    VkImageMemoryBarrier b1{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b1.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED; b1.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    b1.srcQueueFamilyIndex = b1.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b1.image = sc.texImg; b1.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b1.srcAccessMask = 0; b1.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b1);
    VkBufferImageCopy bic{}; bic.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    bic.imageExtent = {texW, texH, 1};
    vkCmdCopyBufferToImage(cmd, sc.texStaging, sc.texImg, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &bic);
    VkImageMemoryBarrier b2{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b2.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL; b2.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    b2.srcQueueFamilyIndex = b2.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b2.image = sc.texImg; b2.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b2.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; b2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b2);
    VkClearValue clear{}; clear.color = {{1.0f, 0.0f, 1.0f, 1.0f}};
    VkRenderPassBeginInfo rbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    rbi.renderPass = g_ctx.renderPass; rbi.framebuffer = sc.fb;
    rbi.renderArea = {{0, 0}, {outW, outH}}; rbi.clearValueCount = 1; rbi.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &rbi, VK_SUBPASS_CONTENTS_INLINE);
    VkViewport vp{}; vp.x = 0; vp.y = 0; vp.width = (float)outW; vp.height = (float)outH; vp.minDepth = 0; vp.maxDepth = 1;
    vkCmdSetViewport(cmd, 0, 1, &vp);
    VkRect2D sc2{{0, 0}, {outW, outH}};
    vkCmdSetScissor(cmd, 0, 1, &sc2);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, g_ctx.pipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, g_ctx.pipeLayout, 0, 1, &sc.dset, 0, nullptr);
    vkCmdDraw(cmd, 6, 1, 0, 0);
    vkCmdEndRenderPass(cmd);
    VkImageMemoryBarrier b3{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b3.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL; b3.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    b3.srcQueueFamilyIndex = b3.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b3.image = sc.outImg; b3.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b3.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT; b3.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b3);
    VkBufferImageCopy bic2{}; bic2.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    bic2.imageExtent = {outW, outH, 1};
    vkCmdCopyImageToBuffer(cmd, sc.outImg, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, sc.outStaging, 1, &bic2);
    VkBufferMemoryBarrier bb{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    bb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; bb.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    bb.srcQueueFamilyIndex = bb.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED; bb.buffer = sc.outStaging;
    bb.offset = 0; bb.size = VK_WHOLE_SIZE;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 0, nullptr, 1, &bb, 0, nullptr);
}

// ★决策 #851：批量资源（每 slot 双缓冲） + 批量命令/围栏
struct SlotBuf { SizeCache sc[2]; bool inited[2] = {false, false}; };
std::unordered_map<int, SlotBuf> g_slotCache;
VkCommandBuffer g_bCmd[2] = {VK_NULL_HANDLE, VK_NULL_HANDLE};
VkFence g_bFence[2] = {VK_NULL_HANDLE, VK_NULL_HANDLE};
bool g_bSubmitted[2] = {false, false};
int g_bParity = 0;
bool ensureBatchInit() {
    if (g_bCmd[0] != VK_NULL_HANDLE) return true;
    VkCommandBufferAllocateInfo cbai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    cbai.commandPool = g_ctx.cmdPool; cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY; cbai.commandBufferCount = 2;
    if (vkAllocateCommandBuffers(g_ctx.device, &cbai, g_bCmd) != VK_SUCCESS) return false;
    VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    for (int i = 0; i < 2; i++) if (vkCreateFence(g_ctx.device, &fci, nullptr, &g_bFence[i]) != VK_SUCCESS) return false;
    return true;
}

}  // namespace

bool available() {
    std::call_once(g_initOnce, initOnce);
    return g_ctx.ok;
}

std::string info() {
    std::call_once(g_initOnce, initOnce);
    std::string s = "{\"ok\":" + std::string(g_ctx.ok ? "1" : "0");
    s += ",\"why\":\"" + g_ctx.why + "\"";
    s += ",\"device\":\"" + g_ctx.deviceName + "\"";
    s += ",\"queueFamily\":" + std::to_string((int)g_ctx.queueFamily);
    s += "}";
    return s;
}

// ── 主渲染（复用缓存资源；每帧只写缓冲 + 录命令 + 提交）────────────────────────
std::vector<uint8_t> renderRgba8(const std::vector<uint8_t>& backdrop, int texW, int texH,
                                 int outW, int outH, const std::vector<uint8_t>& uniform80) {
    if (!available()) { GLOG(LOG_WARN, "GLASS_VK_SKIP %{public}s", g_ctx.why.c_str()); return {}; }
    if (texW <= 0 || texH <= 0 || outW <= 0 || outH <= 0) return {};
    if ((size_t)texW * texH * 4 != backdrop.size()) { GLOG(LOG_ERROR, "GLASS_VK_BAD_BACKDROP"); return {}; }
    VkDevice dev = g_ctx.device;
    auto T0 = std::chrono::steady_clock::now();
    SizeCache* sc = getSizeCache((uint32_t)texW, (uint32_t)texH, (uint32_t)outW, (uint32_t)outH);
    if (sc == nullptr) { GLOG(LOG_ERROR, "GLASS_VK_CACHE_FAIL"); return {}; }
    auto T1 = std::chrono::steady_clock::now();

    // 更新输入：背景纹理 staging + uniform（两者都是持久映射，直接 memcpy）
    memcpy(sc->texMap, backdrop.data(), backdrop.size());
    memcpy(sc->uboMap, uniform80.data(), uniform80.size() < 80 ? uniform80.size() : 80);

    VkCommandBuffer cmd = g_ctx.cmd;
    vkResetCommandBuffer(cmd, 0);
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO}; bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &bi);
    // 纹理：UNDEFINED→TRANSFER_DST，拷入，TRANSFER_DST→SHADER_READ
    VkImageMemoryBarrier b1{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b1.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED; b1.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    b1.srcQueueFamilyIndex = b1.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b1.image = sc->texImg; b1.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b1.srcAccessMask = 0; b1.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b1);
    VkBufferImageCopy bic{}; bic.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    bic.imageExtent = {(uint32_t)texW, (uint32_t)texH, 1};
    vkCmdCopyBufferToImage(cmd, sc->texStaging, sc->texImg, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &bic);
    VkImageMemoryBarrier b2{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b2.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL; b2.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    b2.srcQueueFamilyIndex = b2.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b2.image = sc->texImg; b2.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b2.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; b2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b2);
    // 渲染（动态 viewport/scissor）
    VkClearValue clear{}; clear.color = {{1.0f, 0.0f, 1.0f, 1.0f}};   // 哨兵色（品红）
    VkRenderPassBeginInfo rbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    rbi.renderPass = g_ctx.renderPass; rbi.framebuffer = sc->fb;
    rbi.renderArea = {{0, 0}, {(uint32_t)outW, (uint32_t)outH}};
    rbi.clearValueCount = 1; rbi.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &rbi, VK_SUBPASS_CONTENTS_INLINE);
    VkViewport vp{}; vp.x = 0; vp.y = 0; vp.width = (float)outW; vp.height = (float)outH; vp.minDepth = 0; vp.maxDepth = 1;
    vkCmdSetViewport(cmd, 0, 1, &vp);
    VkRect2D sc2{{0, 0}, {(uint32_t)outW, (uint32_t)outH}};
    vkCmdSetScissor(cmd, 0, 1, &sc2);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, g_ctx.pipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, g_ctx.pipeLayout, 0, 1, &sc->dset, 0, nullptr);
    vkCmdDraw(cmd, 6, 1, 0, 0);
    vkCmdEndRenderPass(cmd);
    // 输出图（renderPass 末尾已在 TRANSFER_SRC_OPTIMAL）——★显式同步：渲染写 → TRANSFER 读
    VkImageMemoryBarrier b3{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b3.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL; b3.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    b3.srcQueueFamilyIndex = b3.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b3.image = sc->outImg; b3.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b3.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT; b3.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b3);
    VkBufferImageCopy bic2{}; bic2.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    bic2.imageExtent = {(uint32_t)outW, (uint32_t)outH, 1};
    vkCmdCopyImageToBuffer(cmd, sc->outImg, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, sc->outStaging, 1, &bic2);
    VkBufferMemoryBarrier bb{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    bb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; bb.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    bb.srcQueueFamilyIndex = bb.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED; bb.buffer = sc->outStaging;
    bb.offset = 0; bb.size = VK_WHOLE_SIZE;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 0, nullptr, 1, &bb, 0, nullptr);
    if (vkEndCommandBuffer(cmd) != VK_SUCCESS) { GLOG(LOG_ERROR, "GLASS_VK_FAIL endCmd"); return {}; }
    auto T2 = std::chrono::steady_clock::now();
    // 提交 + 等待（围栏复用；先复位）
    vkResetFences(dev, 1, &g_ctx.fence);
    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1; si.pCommandBuffers = &cmd;
    if (vkQueueSubmit(g_ctx.queue, 1, &si, g_ctx.fence) != VK_SUCCESS) { GLOG(LOG_ERROR, "GLASS_VK_FAIL submit"); return {}; }
    if (vkWaitForFences(dev, 1, &g_ctx.fence, VK_TRUE, 1000000000ull) != VK_SUCCESS) { GLOG(LOG_ERROR, "GLASS_VK_FAIL waitFence"); return {}; }
    auto T3 = std::chrono::steady_clock::now();
    // 读回（持久映射）。★cached 内存（非 COHERENT）须先 invalidate 才读到 GPU 写入。
    { VkMappedMemoryRange rng{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};
      rng.memory = sc->outStagingMem; rng.offset = 0; rng.size = VK_WHOLE_SIZE;
      vkInvalidateMappedMemoryRanges(dev, 1, &rng); }
    std::vector<uint8_t> out((size_t)outW * outH * 4, 0);
    memcpy(out.data(), sc->outMap, out.size());
    auto T4 = std::chrono::steady_clock::now();
    { static int lg = 0; lg++; if (lg <= 8) { auto ms = [](auto a, auto b) { return std::chrono::duration<double, std::milli>(b - a).count(); };
      char pb[128]; snprintf(pb, sizeof(pb), "%dx%d write=%.1f record=%.1f submitWait=%.1f read=%.1f", outW, outH, ms(T0,T1), ms(T1,T2), ms(T2,T3), ms(T3,T4));
      OH_LOG_Print(LOG_APP, LOG_INFO, GLASS_VK_DOMAIN, GLASS_VK_TAG, "GLASS_VK_T %{public}s", pb); } }
    return out;
}

// ── ★决策 #851：批量渲染（多玻璃合并一次提交 + 异步双缓冲回读）──────────────────
std::vector<std::vector<uint8_t>> renderBatch(const std::vector<BatchItem>& items) {
    std::vector<std::vector<uint8_t>> outs(items.size());
    if (!available() || items.empty()) return outs;
    if (!ensureBatchInit()) return outs;
    VkDevice dev = g_ctx.device;

    const int p = g_bParity;
    // ① 等本 parity 缓冲上一次提交（上一轮，早已在跑 ⇒ 等待≈0）
    if (g_bSubmitted[p]) { vkWaitForFences(dev, 1, &g_bFence[p], VK_TRUE, 1000000000ull); }

    // ② 逐 item：取/建双缓冲资源、写 staging+ubo、录制
    vkResetCommandBuffer(g_bCmd[p], 0);
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO}; bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(g_bCmd[p], &bi);
    for (const auto& it : items) {
        if (it.texW <= 0 || it.texH <= 0 || it.outW <= 0 || it.outH <= 0) continue;
        if ((size_t)it.texW * it.texH * 4 != it.backdrop.size()) continue;
        SlotBuf& sb = g_slotCache[it.id];
        SizeCache& sc = sb.sc[p];
        if (!sb.inited[p]) {
            sc.texW = (uint32_t)it.texW; sc.texH = (uint32_t)it.texH; sc.outW = (uint32_t)it.outW; sc.outH = (uint32_t)it.outH;
            if (!buildSizeCache(sc)) continue;
            sb.inited[p] = true;
        }
        memcpy(sc.texMap, it.backdrop.data(), it.backdrop.size());
        memcpy(sc.uboMap, it.uniform80.data(), it.uniform80.size() < 80 ? it.uniform80.size() : 80);
        recordGlassDraw(g_bCmd[p], sc);
    }
    if (vkEndCommandBuffer(g_bCmd[p]) != VK_SUCCESS) { g_bParity ^= 1; return outs; }
    // ③ 提交本缓冲
    vkResetFences(dev, 1, &g_bFence[p]);
    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1; si.pCommandBuffers = &g_bCmd[p];
    if (vkQueueSubmit(g_ctx.queue, 1, &si, g_bFence[p]) != VK_SUCCESS) { g_bParity ^= 1; return outs; }
    g_bSubmitted[p] = true;

    // ④ 回读**上一 parity** 缓冲（已完成）⇒ 无本帧同步等待
    const int q = p ^ 1;
    if (g_bSubmitted[q]) {
        for (size_t i = 0; i < items.size(); i++) {
            auto sit = g_slotCache.find(items[i].id);
            if (sit == g_slotCache.end() || !sit->second.inited[q]) continue;
            SizeCache& sc = sit->second.sc[q];
            VkMappedMemoryRange rng{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};
            rng.memory = sc.outStagingMem; rng.offset = 0; rng.size = VK_WHOLE_SIZE;
            vkInvalidateMappedMemoryRanges(dev, 1, &rng);
            std::vector<uint8_t> o(sc.outBytes);
            memcpy(o.data(), sc.outMap, o.size());
            outs[i] = std::move(o);
        }
    }
    // ★决策 #852：**首帧兜底**——上一 parity 无可读结果（启动/重建/尺寸变）⇒ 无异步可复用 ⇒
    //   同步等待本帧提交并读当前 parity。仅发生一次（此后每帧都有上帧可读）⇒ 不影响稳态性能。
    //   【为什么必须】用户实测「启动后没有液态玻璃，滑动才出现」：首帧无上批 ⇒ 回读全空 ⇒ 玻璃空；
    //   滑动才触发出帧、才有上批可读。
    vkWaitForFences(dev, 1, &g_bFence[p], VK_TRUE, 1000000000ull);
    for (size_t i = 0; i < items.size(); i++) {
        if (!outs[i].empty()) continue;
        auto sit = g_slotCache.find(items[i].id);
        if (sit == g_slotCache.end() || !sit->second.inited[p]) continue;
        SizeCache& sc = sit->second.sc[p];
        VkMappedMemoryRange rng{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};
        rng.memory = sc.outStagingMem; rng.offset = 0; rng.size = VK_WHOLE_SIZE;
        vkInvalidateMappedMemoryRanges(dev, 1, &rng);
        std::vector<uint8_t> o(sc.outBytes);
        memcpy(o.data(), sc.outMap, o.size());
        outs[i] = std::move(o);
    }
    g_bParity ^= 1;   // 下一帧换缓冲
    return outs;
}

void releaseBatch(const std::vector<int>& ids) {
    if (!available()) return;
    for (int id : ids) {
        auto it = g_slotCache.find(id);
        if (it == g_slotCache.end()) continue;
        for (int k = 0; k < 2; k++) if (it->second.inited[k]) disposeSizeCache(it->second.sc[k]);
        g_slotCache.erase(it);
    }
}

}  // namespace proteus_glass_vk
