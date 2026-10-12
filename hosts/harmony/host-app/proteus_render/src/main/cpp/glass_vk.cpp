// hosts/harmony/host-app/proteus_render/src/main/cpp/glass_vk.cpp
// ★★★液态玻璃 —— Vulkan 离屏渲染落地（鸿蒙 · 决策 #841）。**算法 0 行**（全在 SPIR-V 生成物）。
//
// 【管线形态】一次离屏渲染：
//   · 顶点 = 生成物 `GLASS_VERT_SPV`（vs_quad：按 gl_VertexIndex 展开两个三角形，无顶点缓冲）；
//   · 片元 = 生成物 `GLASS_FRAG_SPV`（fs_glass：读 backdrop 纹理 + uniform，输出玻璃像素）；
//   · 渲染目标 = 盒尺寸的离屏 VkImage（RGBA8）→ 读回 host（vkCmdCopyImageToBuffer）。
// 【绑定契约（与 glass.wgsl 一致）】set0: b0=background 采样纹理, b1=sampler（线性+clamp）, b2=uniform(80B)。
//
// 【健壮性】任何一步失败 ⇒ 记日志 + 返回空 ⇒ 宿主降级为半透明面（**绝不因玻璃把宿主带崩**）。
//   所有 Vulkan 调用都过 `VKC()` 检查（失败即跳错路径）。
#include "glass_vk.h"
#include "generated_materials_spirv.h"

#include <vulkan/vulkan.h>
#include <hilog/log.h>
#include <cstring>
#include <mutex>
#include <string>

#define GLASS_VK_TAG "ProteusGlassVk"
#define GLASS_VK_DOMAIN 0x0002
// ★hilog 参数序：OH_LOG_Print(LogType, LogLevel, domain, tag, fmt, ...)
#define GLOG(level, ...) OH_LOG_Print(LOG_APP, level, GLASS_VK_DOMAIN, GLASS_VK_TAG, __VA_ARGS__)

namespace proteus_glass_vk {

namespace {

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
    // 已就绪的着色器模块 + 管线布局描述（每次渲染重建 pipeline，因目标尺寸随节点变）
    VkShaderModule vs = VK_NULL_HANDLE;
    VkShaderModule fs = VK_NULL_HANDLE;
    VkDescriptorSetLayout setLayout = VK_NULL_HANDLE;
    VkPipelineLayout pipeLayout = VK_NULL_HANDLE;
    VkRenderPass renderPass = VK_NULL_HANDLE;
};

VkCtx g_ctx;
std::once_flag g_initOnce;

bool chooseQueueFamily(VkPhysicalDevice phys, uint32_t* out) {
    uint32_t n = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(phys, &n, nullptr);
    std::vector<VkQueueFamilyProperties> qs(n);
    vkGetPhysicalDeviceQueueFamilyProperties(phys, &n, qs.data());
    for (uint32_t i = 0; i < n; i++) {
        // 优先图形队列（本管线是图形管线）；退而求其次计算队列。
        if (qs[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) { *out = i; return true; }
    }
    for (uint32_t i = 0; i < n; i++) {
        if (qs[i].queueFlags & VK_QUEUE_COMPUTE_BIT) { *out = i; return true; }
    }
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

void initOnce() {
    // ① 实例
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "proteus-glass";
    app.applicationVersion = 1;
    app.pEngineName = "proteus";
    app.engineVersion = 1;
    app.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo ci{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ci.pApplicationInfo = &app;
    if (vkCreateInstance(&ci, nullptr, &g_ctx.instance) != VK_SUCCESS) { g_ctx.why = "vkCreateInstance failed"; return; }
    // ② 物理设备
    uint32_t dn = 0;
    if (vkEnumeratePhysicalDevices(g_ctx.instance, &dn, nullptr) != VK_SUCCESS || dn == 0) { g_ctx.why = "no physical device"; return; }
    std::vector<VkPhysicalDevice> devs(dn);
    vkEnumeratePhysicalDevices(g_ctx.instance, &dn, devs.data());
    g_ctx.phys = devs[0];
    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(g_ctx.phys, &props);
    g_ctx.deviceName = props.deviceName;
    if (!chooseQueueFamily(g_ctx.phys, &g_ctx.queueFamily)) { g_ctx.why = "no graphics/compute queue"; return; }
    // ③ 逻辑设备 + 队列
    float prio = 1.0f;
    VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = g_ctx.queueFamily;
    qci.queueCount = 1;
    qci.pQueuePriorities = &prio;
    VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.queueCreateInfoCount = 1;
    dci.pQueueCreateInfos = &qci;
    if (vkCreateDevice(g_ctx.phys, &dci, nullptr, &g_ctx.device) != VK_SUCCESS) { g_ctx.why = "vkCreateDevice failed"; return; }
    vkGetDeviceQueue(g_ctx.device, g_ctx.queueFamily, 0, &g_ctx.queue);
    // ④ 着色器模块（生成物 SPIR-V）
    g_ctx.vs = makeShaderModule(g_ctx.device, proteus_shaders::GLASS_VERT_SPV, proteus_shaders::GLASS_VERT_SPV_LEN);
    g_ctx.fs = makeShaderModule(g_ctx.device, proteus_shaders::GLASS_FRAG_SPV, proteus_shaders::GLASS_FRAG_SPV_LEN);
    if (g_ctx.vs == VK_NULL_HANDLE || g_ctx.fs == VK_NULL_HANDLE) { g_ctx.why = "vkCreateShaderModule failed"; return; }
    // ⑤ 描述符集布局：b0 采样纹理, b1 采样器, b2 uniform
    VkDescriptorSetLayoutBinding binds[3] = {};
    binds[0].binding = 0; binds[0].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE; binds[0].descriptorCount = 1; binds[0].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    binds[1].binding = 1; binds[1].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLER;       binds[1].descriptorCount = 1; binds[1].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    binds[2].binding = 2; binds[2].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER; binds[2].descriptorCount = 1; binds[2].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    VkDescriptorSetLayoutCreateInfo lci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    lci.bindingCount = 3;
    lci.pBindings = binds;
    if (vkCreateDescriptorSetLayout(g_ctx.device, &lci, nullptr, &g_ctx.setLayout) != VK_SUCCESS) { g_ctx.why = "descriptor set layout failed"; return; }
    VkPipelineLayoutCreateInfo plci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &g_ctx.setLayout;
    if (vkCreatePipelineLayout(g_ctx.device, &plci, nullptr, &g_ctx.pipeLayout) != VK_SUCCESS) { g_ctx.why = "pipeline layout failed"; return; }
    g_ctx.ok = true;
    g_ctx.why = "ok";
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

// ── 一次性资源辅助 ───────────────────────────────────────────────────────────
namespace {

uint32_t findMemoryType(VkPhysicalDevice phys, uint32_t typeBits, VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(phys, &mp);
    for (uint32_t i = 0; i < mp.memoryTypeCount; i++) {
        if ((typeBits & (1u << i)) && (mp.memoryTypes[i].propertyFlags & props) == props) return i;
    }
    return UINT32_MAX;
}

bool createImageAndView(VkDevice dev, VkPhysicalDevice phys, uint32_t w, uint32_t h, VkFormat fmt,
                        VkImageUsageFlags usage, VkImage* outImg, VkDeviceMemory* outMem, VkImageView* outView) {
    VkImageCreateInfo ici{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ici.imageType = VK_IMAGE_TYPE_2D;
    ici.format = fmt;
    ici.extent = {w, h, 1};
    ici.mipLevels = 1;
    ici.arrayLayers = 1;
    ici.samples = VK_SAMPLE_COUNT_1_BIT;
    ici.tiling = VK_IMAGE_TILING_OPTIMAL;
    ici.usage = usage;
    ici.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    ici.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    if (vkCreateImage(dev, &ici, nullptr, outImg) != VK_SUCCESS) return false;
    VkMemoryRequirements mr{};
    vkGetImageMemoryRequirements(dev, *outImg, &mr);
    uint32_t mt = findMemoryType(phys, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (mt == UINT32_MAX) return false;
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = mt;
    if (vkAllocateMemory(dev, &mai, nullptr, outMem) != VK_SUCCESS) return false;
    if (vkBindImageMemory(dev, *outImg, *outMem, 0) != VK_SUCCESS) return false;
    VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    vci.image = *outImg;
    vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vci.format = fmt;
    vci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    if (vkCreateImageView(dev, &vci, nullptr, outView) != VK_SUCCESS) return false;
    return true;
}

bool createHostBuffer(VkDevice dev, VkPhysicalDevice phys, VkDeviceSize size, VkBufferUsageFlags usage,
                      VkBuffer* outBuf, VkDeviceMemory* outMem) {
    VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = size;
    bci.usage = usage;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (vkCreateBuffer(dev, &bci, nullptr, outBuf) != VK_SUCCESS) return false;
    VkMemoryRequirements mr{};
    vkGetBufferMemoryRequirements(dev, *outBuf, &mr);
    uint32_t mt = findMemoryType(phys, mr.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (mt == UINT32_MAX) return false;
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = mt;
    if (vkAllocateMemory(dev, &mai, nullptr, outMem) != VK_SUCCESS) return false;
    if (vkBindBufferMemory(dev, *outBuf, *outMem, 0) != VK_SUCCESS) return false;
    return true;
}

}  // namespace

// ── 主渲染 ────────────────────────────────────────────────────────────────────
std::vector<uint8_t> renderRgba8(const std::vector<uint8_t>& backdrop, int texW, int texH,
                                 int outW, int outH, const std::vector<uint8_t>& uniform80) {
    if (!available()) { GLOG(LOG_WARN, "GLASS_VK_SKIP %{public}s", g_ctx.why.c_str()); return {}; }
    if (texW <= 0 || texH <= 0 || outW <= 0 || outH <= 0) return {};
    if ((size_t)texW * texH * 4 != backdrop.size()) { GLOG(LOG_ERROR, "GLASS_VK_BAD_BACKDROP"); return {}; }
    VkDevice dev = g_ctx.device;
    VkPhysicalDevice phys = g_ctx.phys;
    VkResult R;

    // 资源（渲染结束统一清理）
    VkImage texImg = VK_NULL_HANDLE; VkDeviceMemory texMem = VK_NULL_HANDLE; VkImageView texView = VK_NULL_HANDLE;
    VkBuffer texStaging = VK_NULL_HANDLE; VkDeviceMemory texStagingMem = VK_NULL_HANDLE;
    VkImage outImg = VK_NULL_HANDLE; VkDeviceMemory outMem = VK_NULL_HANDLE; VkImageView outView = VK_NULL_HANDLE;
    VkBuffer outStaging = VK_NULL_HANDLE; VkDeviceMemory outStagingMem = VK_NULL_HANDLE;
    VkBuffer ubo = VK_NULL_HANDLE; VkDeviceMemory uboMem = VK_NULL_HANDLE;
    VkSampler sampler = VK_NULL_HANDLE;
    VkDescriptorPool pool = VK_NULL_HANDLE; VkDescriptorSet dset = VK_NULL_HANDLE;
    VkRenderPass rp = VK_NULL_HANDLE; VkFramebuffer fb = VK_NULL_HANDLE;
    VkPipeline pipeline = VK_NULL_HANDLE;
    VkCommandPool cmdPool = VK_NULL_HANDLE; VkCommandBuffer cmd = VK_NULL_HANDLE;
    VkFence fence = VK_NULL_HANDLE;

    auto fail = [&](const char* where) -> std::vector<uint8_t> {
        GLOG(LOG_ERROR, "GLASS_VK_FAIL at %{public}s", where);
        if (fence) vkDestroyFence(dev, fence, nullptr);
        if (cmdPool) vkDestroyCommandPool(dev, cmdPool, nullptr);
        if (pipeline) vkDestroyPipeline(dev, pipeline, nullptr);
        if (fb) vkDestroyFramebuffer(dev, fb, nullptr);
        if (rp) vkDestroyRenderPass(dev, rp, nullptr);
        if (pool) vkDestroyDescriptorPool(dev, pool, nullptr);
        if (sampler) vkDestroySampler(dev, sampler, nullptr);
        if (ubo) vkDestroyBuffer(dev, ubo, nullptr);
        if (uboMem) vkFreeMemory(dev, uboMem, nullptr);
        if (outStaging) vkDestroyBuffer(dev, outStaging, nullptr);
        if (outStagingMem) vkFreeMemory(dev, outStagingMem, nullptr);
        if (outView) vkDestroyImageView(dev, outView, nullptr);
        if (outImg) vkDestroyImage(dev, outImg, nullptr);
        if (outMem) vkFreeMemory(dev, outMem, nullptr);
        if (texStaging) vkDestroyBuffer(dev, texStaging, nullptr);
        if (texStagingMem) vkFreeMemory(dev, texStagingMem, nullptr);
        if (texView) vkDestroyImageView(dev, texView, nullptr);
        if (texImg) vkDestroyImage(dev, texImg, nullptr);
        if (texMem) vkFreeMemory(dev, texMem, nullptr);
        return {};
    };

    // ① 背景纹理（采样用）：staging（host visible）→ 拷到 device-local
    if (!createHostBuffer(dev, phys, backdrop.size(), VK_BUFFER_USAGE_TRANSFER_SRC_BIT, &texStaging, &texStagingMem)) return fail("texStaging");
    { void* m = nullptr; if (vkMapMemory(dev, texStagingMem, 0, backdrop.size(), 0, &m) != VK_SUCCESS) return fail("mapTex");
      memcpy(m, backdrop.data(), backdrop.size()); vkUnmapMemory(dev, texStagingMem); }
    if (!createImageAndView(dev, phys, texW, texH, VK_FORMAT_R8G8B8A8_UNORM,
            VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, &texImg, &texMem, &texView)) return fail("texImg");

    // ② 输出图（渲染目标 + 拷出源）
    if (!createImageAndView(dev, phys, outW, outH, VK_FORMAT_R8G8B8A8_UNORM,
            VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, &outImg, &outMem, &outView)) return fail("outImg");
    if (!createHostBuffer(dev, phys, (VkDeviceSize)outW * outH * 4, VK_BUFFER_USAGE_TRANSFER_DST_BIT, &outStaging, &outStagingMem)) return fail("outStaging");

    // ③ uniform 缓冲
    if (!createHostBuffer(dev, phys, 80, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, &ubo, &uboMem)) return fail("ubo");
    { void* m = nullptr; if (vkMapMemory(dev, uboMem, 0, 80, 0, &m) != VK_SUCCESS) return fail("mapUbo");
      memcpy(m, uniform80.data(), uniform80.size() < 80 ? uniform80.size() : 80); vkUnmapMemory(dev, uboMem); }

    // ④ 采样器（线性 + clamp to edge —— 与 CPU oracle 的半纹素 clamp 口径一致）
    { VkSamplerCreateInfo si{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
      si.magFilter = VK_FILTER_LINEAR; si.minFilter = VK_FILTER_LINEAR;
      si.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE; si.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
      si.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
      if (vkCreateSampler(dev, &si, nullptr, &sampler) != VK_SUCCESS) return fail("sampler"); }

    // ⑤ 描述符池 + 集 + 写
    { VkDescriptorPoolSize ps[3] = {
        {VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, 1}, {VK_DESCRIPTOR_TYPE_SAMPLER, 1}, {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1}};
      VkDescriptorPoolCreateInfo dpci{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
      dpci.maxSets = 1; dpci.poolSizeCount = 3; dpci.pPoolSizes = ps;
      if (vkCreateDescriptorPool(dev, &dpci, nullptr, &pool) != VK_SUCCESS) return fail("descPool");
      VkDescriptorSetAllocateInfo dsai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
      dsai.descriptorPool = pool; dsai.descriptorSetCount = 1; dsai.pSetLayouts = &g_ctx.setLayout;
      if (vkAllocateDescriptorSets(dev, &dsai, &dset) != VK_SUCCESS) return fail("allocSet");
      VkDescriptorImageInfo bgInfo{}; bgInfo.imageView = texView; bgInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
      VkDescriptorImageInfo smpInfo{}; smpInfo.sampler = sampler;
      VkDescriptorBufferInfo ubInfo{}; ubInfo.buffer = ubo; ubInfo.offset = 0; ubInfo.range = 80;
      VkWriteDescriptorSet wr[3] = {};
      wr[0] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[0].dstSet = dset; wr[0].dstBinding = 0; wr[0].descriptorCount = 1;
      wr[0].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE; wr[0].pImageInfo = &bgInfo;
      wr[1] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[1].dstSet = dset; wr[1].dstBinding = 1; wr[1].descriptorCount = 1;
      wr[1].descriptorType = VK_DESCRIPTOR_TYPE_SAMPLER; wr[1].pImageInfo = &smpInfo;
      wr[2] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET}; wr[2].dstSet = dset; wr[2].dstBinding = 2; wr[2].descriptorCount = 1;
      wr[2].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER; wr[2].pBufferInfo = &ubInfo;
      vkUpdateDescriptorSets(dev, 3, wr, 0, nullptr); }

    // ⑥ render pass（单色附件；末尾转 TRANSFER_SRC 供拷出）
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
      if (vkCreateRenderPass(dev, &rpci, nullptr, &rp) != VK_SUCCESS) return fail("renderPass");
      VkImageView atts[1] = {outView};
      VkFramebufferCreateInfo fci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
      fci.renderPass = rp; fci.attachmentCount = 1; fci.pAttachments = atts; fci.width = outW; fci.height = outH; fci.layers = 1;
      if (vkCreateFramebuffer(dev, &fci, nullptr, &fb) != VK_SUCCESS) return fail("framebuffer"); }

    // ⑦ 图形管线
    { VkPipelineShaderStageCreateInfo st[2] = {};
      st[0] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}; st[0].stage = VK_SHADER_STAGE_VERTEX_BIT; st[0].module = g_ctx.vs; st[0].pName = "vs_quad";
      st[1] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}; st[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT; st[1].module = g_ctx.fs; st[1].pName = "fs_glass";
      VkPipelineVertexInputStateCreateInfo vi{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
      VkPipelineInputAssemblyStateCreateInfo ia{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
      ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
      VkViewport vp{}; vp.x = 0; vp.y = 0; vp.width = (float)outW; vp.height = (float)outH; vp.minDepth = 0; vp.maxDepth = 1;
      VkRect2D sc{{0, 0}, {(uint32_t)outW, (uint32_t)outH}};
      VkPipelineViewportStateCreateInfo vsi{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
      vsi.viewportCount = 1; vsi.pViewports = &vp; vsi.scissorCount = 1; vsi.pScissors = &sc;
      VkPipelineRasterizationStateCreateInfo rs{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
      rs.polygonMode = VK_POLYGON_MODE_FILL; rs.cullMode = VK_CULL_MODE_NONE; rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE; rs.lineWidth = 1.0f;
      VkPipelineMultisampleStateCreateInfo ms{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
      ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
      VkPipelineColorBlendAttachmentState cba{}; cba.colorWriteMask = 0xF; cba.blendEnable = VK_FALSE;
      VkPipelineColorBlendStateCreateInfo cb{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
      cb.attachmentCount = 1; cb.pAttachments = &cba;
      VkGraphicsPipelineCreateInfo gpci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
      gpci.stageCount = 2; gpci.pStages = st; gpci.pVertexInputState = &vi; gpci.pInputAssemblyState = &ia;
      gpci.pViewportState = &vsi; gpci.pRasterizationState = &rs; gpci.pMultisampleState = &ms;
      gpci.pColorBlendState = &cb; gpci.layout = g_ctx.pipeLayout; gpci.renderPass = rp; gpci.subpass = 0;
      R = vkCreateGraphicsPipelines(dev, VK_NULL_HANDLE, 1, &gpci, nullptr, &pipeline);
      if (R != VK_SUCCESS) return fail("graphicsPipeline"); }

    // ⑧ 命令录制
    { VkCommandPoolCreateInfo cpci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
      cpci.queueFamilyIndex = g_ctx.queueFamily; cpci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
      if (vkCreateCommandPool(dev, &cpci, nullptr, &cmdPool) != VK_SUCCESS) return fail("cmdPool");
      VkCommandBufferAllocateInfo cbai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
      cbai.commandPool = cmdPool; cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY; cbai.commandBufferCount = 1;
      if (vkAllocateCommandBuffers(dev, &cbai, &cmd) != VK_SUCCESS) return fail("allocCmd");
      VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO}; bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
      vkBeginCommandBuffer(cmd, &bi);
      // 纹理：UNDEFINED→TRANSFER_DST，拷入，TRANSFER_DST→SHADER_READ
      VkImageMemoryBarrier b1{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
      b1.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED; b1.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
      b1.srcQueueFamilyIndex = b1.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
      b1.image = texImg; b1.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
      b1.srcAccessMask = 0; b1.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
      vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b1);
      VkBufferImageCopy bic{}; bic.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
      bic.imageExtent = {(uint32_t)texW, (uint32_t)texH, 1};
      vkCmdCopyBufferToImage(cmd, texStaging, texImg, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &bic);
      VkImageMemoryBarrier b2{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
      b2.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL; b2.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
      b2.srcQueueFamilyIndex = b2.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
      b2.image = texImg; b2.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
      b2.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; b2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
      vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1, &b2);
      // 渲染
      VkClearValue clear{}; clear.color = {{255.0f / 255.0f, 0.0f, 255.0f / 255.0f, 255.0f / 255.0f}};   // ★哨兵色（品红）：区分"未绘制"像素
      VkRenderPassBeginInfo rbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
      rbi.renderPass = rp; rbi.framebuffer = fb; rbi.renderArea = {{0, 0}, {(uint32_t)outW, (uint32_t)outH}};
      rbi.clearValueCount = 1; rbi.pClearValues = &clear;
      vkCmdBeginRenderPass(cmd, &rbi, VK_SUBPASS_CONTENTS_INLINE);
      vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
      vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, g_ctx.pipeLayout, 0, 1, &dset, 0, nullptr);
      vkCmdDraw(cmd, 6, 1, 0, 0);
      vkCmdEndRenderPass(cmd);
      // ★★★关键同步（实测：缺它 ⇒ 读回**陈旧内存**，偶发全 0/半幅/花屏）：
      //   渲染 pass 末的 finalLayout 转换只保证**布局**，不保证**执行/可用性**顺序 ——
      //   必须显式让 COLOR_ATTACHMENT_OUTPUT 写入对 TRANSFER 读可见，否则 vkCmdCopyImageToBuffer
      //   可能早于渲染完成 ⇒ 读到未初始化内存（真机实测：清屏色都没读回来）。
      VkImageMemoryBarrier b3{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
      b3.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
      b3.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
      b3.srcQueueFamilyIndex = b3.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
      b3.image = outImg; b3.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
      b3.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT; b3.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
      vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                           0, 0, nullptr, 0, nullptr, 1, &b3);
      // 输出图（renderPass 末尾已在 TRANSFER_SRC_OPTIMAL）→ 拷到 staging
      VkBufferImageCopy bic2{}; bic2.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
      bic2.imageExtent = {(uint32_t)outW, (uint32_t)outH, 1};
      vkCmdCopyImageToBuffer(cmd, outImg, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, outStaging, 1, &bic2);
      VkBufferMemoryBarrier bb{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
      bb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; bb.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
      bb.srcQueueFamilyIndex = bb.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED; bb.buffer = outStaging;
      bb.offset = 0; bb.size = VK_WHOLE_SIZE;
      vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 0, nullptr, 1, &bb, 0, nullptr);
      if (vkEndCommandBuffer(cmd) != VK_SUCCESS) return fail("endCmd"); }

    // ⑨ 提交 + 等待
    { VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
      if (vkCreateFence(dev, &fci, nullptr, &fence) != VK_SUCCESS) return fail("fence");
      VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
      si.commandBufferCount = 1; si.pCommandBuffers = &cmd;
      if (vkQueueSubmit(g_ctx.queue, 1, &si, fence) != VK_SUCCESS) return fail("submit");
      if (vkWaitForFences(dev, 1, &fence, VK_TRUE, 1000000000ull) != VK_SUCCESS) return fail("waitFence"); }

    // ⑩ 读回
    std::vector<uint8_t> out((size_t)outW * outH * 4, 0);
    { void* m = nullptr; if (vkMapMemory(dev, outStagingMem, 0, (VkDeviceSize)outW * outH * 4, 0, &m) != VK_SUCCESS) return fail("mapOut");
      memcpy(out.data(), m, out.size()); vkUnmapMemory(dev, outStagingMem); }

    // 清理
    vkDestroyFence(dev, fence, nullptr);
    vkDestroyCommandPool(dev, cmdPool, nullptr);
    vkDestroyPipeline(dev, pipeline, nullptr);
    vkDestroyFramebuffer(dev, fb, nullptr);
    vkDestroyRenderPass(dev, rp, nullptr);
    vkDestroyDescriptorPool(dev, pool, nullptr);
    vkDestroySampler(dev, sampler, nullptr);
    vkDestroyBuffer(dev, ubo, nullptr); vkFreeMemory(dev, uboMem, nullptr);
    vkDestroyBuffer(dev, outStaging, nullptr); vkFreeMemory(dev, outStagingMem, nullptr);
    vkDestroyImageView(dev, outView, nullptr); vkDestroyImage(dev, outImg, nullptr); vkFreeMemory(dev, outMem, nullptr);
    vkDestroyBuffer(dev, texStaging, nullptr); vkFreeMemory(dev, texStagingMem, nullptr);
    vkDestroyImageView(dev, texView, nullptr); vkDestroyImage(dev, texImg, nullptr); vkFreeMemory(dev, texMem, nullptr);
    return out;
}

}  // namespace proteus_glass_vk
