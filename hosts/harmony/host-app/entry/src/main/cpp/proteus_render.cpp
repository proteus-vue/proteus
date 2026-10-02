// entry/src/main/cpp/proteus_render.cpp
// ★★★Proteus 鸿蒙宿主原生渲染模块 —— **RenderNode 直绘**（方案 §2.2 路径 B）
//
// 【它证明什么（本轮里程碑：把 Proteus 指令流真正接进方舟引擎）】
//   1. `OH_ArkUI_RenderNodeUtils_*` 系列（API 20+）在真机可用；
//   2. **不经 ArkUI measure/layout** 直接建渲染节点树（SetSize/SetPosition/SetBackgroundColor）；
//   3. 渲染结果挂到 ArkTS 页面（NodeContent 链）；
//   4. 宿主**主动上报**（hilog `PROTEUS_RENDER_*` 标记）——本仓零盲等纪律：让被测对象报告，
//      验证脚本条件等待标记（见 hosts/harmony/run-host-app.sh 的验收扩展）。
//
// 【与 Proteus 指令流的关系（诚实边界）】本模块是**接收端原型**：
//   NAPI 暴露 `renderCommands(json)` —— 参数形态 = RenderCmd（kind/x/y/width/height/color），
//   与 `@proteus-vue/layout-core` 的 emitRenderCmds 产物**同形**。当前由 ArkTS 侧直接构造
//   测试指令（先证明"通道通、画得出"）；下一步接 Rust/TS 内核产出的真实指令流（同形即直通）。
//
// 【颜色格式】OH_ArkUI_RenderNodeUtils_SetBackgroundColor 取 **ARGB uint32**
//   （bits 24-31 alpha / 16-23 R / 8-15 G / 0-7 B）——由 ArkTS 侧把 CSS 色转成这个整数传入
//   （转换放 JS 侧：一处实现，不散落在 C++）。
#include <string>
#include <cstdint>
#include <cstdio>
#include <vector>
#include <hilog/log.h>

#include <napi/native_api.h>
#include <arkui/native_interface.h>
#include <arkui/native_type.h>
#include <arkui/native_node.h>
#include <arkui/native_node_napi.h>
#include <arkui/native_render.h>
// ★文本上屏（ArkGraphics2D）：typography 在 content modifier 回调里绘制
#include <native_drawing/drawing_canvas.h>
#include <native_drawing/drawing_font_collection.h>
#include <native_drawing/drawing_text_typography.h>
#include <native_drawing/drawing_text_declaration.h>
#include <native_drawing/drawing_types.h>

#define LOG_DOMAIN 0x0002
// ★hilog 的 LogType 是第一个宏参数（不是 domain）——固定用 LOG_APP
#define PROTEUS_LOG(...) OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG, __VA_ARGS__)
#define LOG_TAG "ProteusRender"
#undef LOG_DOMAIN
#define LOG_DOMAIN 0x0002

// 模块生命周期：持有的 ArkUI_NodeContentHandle（由 ArkTS attach 时传入）
static ArkUI_NodeContentHandle g_content = nullptr;
static int32_t g_nodeCount = 0;

// ── 极简 JSON 取值（避免为原型引入第三方 JSON 库；指令结构固定：{"x":N,"y":N,"w":N,"h":N,"color":N}）──
//   ★诚实边界：仅支持本模块约定的**数字字段**；接真实指令流时换正式解析（或改传二进制块）。
static bool jsonNumber(const std::string& s, const char* key, double* out) {
    std::string needle = std::string("\"") + key + "\":";
    size_t p = s.find(needle);
    if (p == std::string::npos) return false;
    p += needle.size();
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) p++;
    char* end = nullptr;
    double v = strtod(s.c_str() + p, &end);
    if (end == s.c_str() + p) return false;
    *out = v;
    return true;
}

/** 极简 JSON 字符串取值（`"key":"value"`）；未找到返回 false */
static bool jsonString(const std::string& s, const char* key, std::string* out) {
    std::string needle = std::string("\"") + key + "\":\"";
    size_t p = s.find(needle);
    if (p == std::string::npos) return false;
    p += needle.size();
    std::string acc;
    for (size_t i = p; i < s.size(); i++) {
        if (s[i] == '\\' && i + 1 < s.size()) { acc.push_back(s[i + 1]); i++; continue; }
        if (s[i] == '"') { *out = acc; return true; }
        acc.push_back(s[i]);
    }
    return false;
}

/** 逐节点文本绘制数据（挂到 content modifier 的 userData；生命周期 = RenderNode 生命周期） */
struct TextDrawSpec {
    std::string text;
    double fontSizePx = 24.0;
    uint32_t color = 0xFFFFFFFFu;
    std::string family;
};

/**
 * content modifier 的 onDraw 回调：在节点的绘制阶段用 typography 画文字。
 *   ★挂载链（官方 API，2026-10-02 真机验证）：CreateContentModifier → SetContentModifierOnDraw(cb)
 *     → AttachContentModifier(node, modifier)。回调拿到的 DrawContext 转 OH_Drawing_Canvas*。
 *   ★所有权（实测教训沿用）：**每次回调内完整创建/销毁** typography 对象——
 *     FontCollection 跨 handler 复用在真机 CppCrash（见 proteus_bench.cpp 的 TextProbe 注释）。
 */
static void DrawTextCallback(ArkUI_DrawContext* context, void* userData) {
    auto* spec = static_cast<TextDrawSpec*>(userData);
    if (spec == nullptr || spec->text.empty()) return;
    void* canvasRaw = OH_ArkUI_DrawContext_GetCanvas(context);
    if (canvasRaw == nullptr) return;
    auto* canvas = static_cast<OH_Drawing_Canvas*>(canvasRaw);

    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleColor(tstyle, spec->color);
    OH_Drawing_SetTextStyleFontSize(tstyle, spec->fontSizePx);
    OH_Drawing_TypographyCreate* handler = OH_Drawing_CreateTypographyHandler(ts, fc);
    if (handler != nullptr) {
        OH_Drawing_TypographyHandlerPushTextStyle(handler, tstyle);
        OH_Drawing_TypographyHandlerAddText(handler, spec->text.c_str());
        OH_Drawing_Typography* typo = OH_Drawing_CreateTypography(handler);
        if (typo != nullptr) {
            OH_Drawing_TypographyLayout(typo, 10000.0);   // 单行（宽度给足）
            OH_Drawing_TypographyPaint(typo, canvas, 0.0, 0.0);
            OH_Drawing_DestroyTypography(typo);
        }
        OH_Drawing_DestroyTypographyHandler(handler);
    }
    OH_Drawing_DestroyTextStyle(tstyle);
    OH_Drawing_DestroyTypographyStyle(ts);
    OH_Drawing_DestroyFontCollection(fc);
}

/**
 * attach(content: NodeContent): number
 *   把 ArkTS 侧的 NodeContent 句柄交给本模块（页面里的 ContentSlot 挂载点）。
 *   返回 0 成功 / 负错误码。
 */
static napi_value Attach(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 1) {
        OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_ATTACH argc=0 (缺 NodeContent 参数)");
        napi_value err;
        napi_create_int32(env, -1, &err);
        return err;
    }
    ArkUI_NodeContentHandle content = nullptr;
    int32_t rc = OH_ArkUI_GetNodeContentFromNapiValue(env, args[0], &content);
    if (rc != ARKUI_ERROR_CODE_NO_ERROR || content == nullptr) {
        OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_ATTACH 失败 rc=%{public}d", rc);
        napi_value err;
        napi_create_int32(env, rc == 0 ? -2 : rc, &err);
        return err;
    }
    g_content = content;
    // ★★★CAPI 初始化（本仓实测踩坑）：`OH_ArkUI_RenderNodeUtils_CreateNode` 在 CAPI 未初始化时
    //   返回 null（本机实测：nodes=0 + reason=create-node-null 4 连发）。首次 `GetModuleInterface`
    //   会触发 CAPI 初始化 ⇒ **必须在任何 RenderNode API 调用之前**完成（放在 attach 阶段最稳）。
    ArkUI_NativeNodeAPI_1* probeApi = nullptr;
    OH_ArkUI_GetModuleInterface(ARKUI_NATIVE_NODE, ArkUI_NativeNodeAPI_1, probeApi);
    OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                 "PROTEUS_RENDER_ATTACHED ok capi=%{public}d", probeApi != nullptr ? 1 : 0);
    napi_value ok;
    napi_create_int32(env, 0, &ok);
    return ok;
}

/**
 * renderCommands(json: string): number
 *   消费一批 Proteus 指令（RenderCmd 同形），建 RenderNode 子树并挂到 NodeContent。
 *   返回实际建出的节点数。
 */
static napi_value RenderCommands(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 1 || g_content == nullptr) {
        OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_ERROR argc=%{public}zu content=%p",
                     argc, static_cast<void*>(g_content));
        napi_value err;
        napi_create_int32(env, -1, &err);
        return err;
    }
    size_t len = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
    std::string json(len + 1, '\0');
    napi_get_value_string_utf8(env, args[0], &json[0], len + 1, &len);
    json.resize(len);

    // 切分顶层数组：**大括号计数**（首版用第一个 '}' 截断——遇嵌套对象或含 '}' 的文本会断）
    std::vector<std::string> items;
    {
        size_t pos = 0;
        while ((pos = json.find('{', pos)) != std::string::npos) {
            int depth = 0;
            size_t end = pos;
            bool inStr = false;
            for (size_t i = pos; i < json.size(); i++) {
                char c = json[i];
                if (inStr) {
                    if (c == '\\') { i++; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '{') depth++;
                else if (c == '}') {
                    depth--;
                    if (depth == 0) { end = i; break; }
                }
            }
            if (end <= pos) break;
            items.push_back(json.substr(pos, end - pos + 1));
            pos = end + 1;
        }
    }

    int32_t built = 0;
    int32_t textCount = 0;
    for (const auto& it : items) {
        double x = 0, y = 0, w = 0, h = 0, color = 0, radius = 0;
        if (!jsonNumber(it, "x", &x) || !jsonNumber(it, "w", &w)) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG,
                         "PROTEUS_RENDER_SKIP reason=no-geometry item=%{public}s", it.c_str());
            continue; // 无几何 = 跳过（不静默造假）
        }
        jsonNumber(it, "y", &y);
        jsonNumber(it, "h", &h);
        jsonNumber(it, "color", &color);
        jsonNumber(it, "radius", &radius);

        ArkUI_RenderNodeHandle node = OH_ArkUI_RenderNodeUtils_CreateNode();
        if (node == nullptr) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_SKIP reason=create-node-null");
            continue;
        }
        OH_ArkUI_RenderNodeUtils_SetSize(node, static_cast<int32_t>(w), static_cast<int32_t>(h));
        OH_ArkUI_RenderNodeUtils_SetPosition(node, static_cast<int32_t>(x), static_cast<int32_t>(y));
        OH_ArkUI_RenderNodeUtils_SetBackgroundColor(node, static_cast<uint32_t>(color));
        if (radius > 0) {
            ArkUI_NodeBorderRadiusOption* br = OH_ArkUI_RenderNodeUtils_CreateNodeBorderRadiusOption();
            if (br != nullptr) {
                OH_ArkUI_RenderNodeUtils_SetNodeBorderRadiusOptionCornerRadius(
                    br, static_cast<uint32_t>(radius), ARKUI_CORNER_DIRECTION_ALL);
                OH_ArkUI_RenderNodeUtils_SetBorderRadius(node, br);
                OH_ArkUI_RenderNodeUtils_DisposeNodeBorderRadiusOption(br);
            }
        }
        // ★★★文本上屏（2026-10-02）：指令带 "text" ⇒ 给该节点挂 content modifier，
        //   在绘制阶段用 typography 画文字（Color/字号从指令取；缺省白字 24px）。
        std::string textVal;
        if (jsonString(it, "text", &textVal) && !textVal.empty()) {
            double fs = 24.0;
            jsonNumber(it, "fontSize", &fs);
            double tc = 0xFFFFFFFFu;
            jsonNumber(it, "textColor", &tc);
            auto* spec = new TextDrawSpec{textVal, fs, static_cast<uint32_t>(tc), ""};
            ArkUI_RenderContentModifierHandle mod = OH_ArkUI_RenderNodeUtils_CreateContentModifier();
            if (mod != nullptr) {
                OH_ArkUI_RenderNodeUtils_SetContentModifierOnDraw(mod, spec, DrawTextCallback);
                int32_t rcMod = OH_ArkUI_RenderNodeUtils_AttachContentModifier(node, mod);
                if (rcMod != ARKUI_ERROR_CODE_NO_ERROR) {
                    OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG,
                                 "PROTEUS_RENDER_TEXT_ATTACH_FAIL rc=%{public}d", rcMod);
                    delete spec;
                } else {
                    textCount++;
                }
            } else {
                delete spec;
            }
        }
        // 挂到宿主：需要一个 customNode 作为 RenderNode 的父（NodeContent 不直接收 RenderNode）
        //   方案 A（本实现）：每个 renderNode 建一个 customNode 包装，再 AddNode 到 content。
        ArkUI_NativeNodeAPI_1* api = nullptr;
        OH_ArkUI_GetModuleInterface(ARKUI_NATIVE_NODE, ArkUI_NativeNodeAPI_1, api);
        if (api == nullptr) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_SKIP reason=node-api-null");
            OH_ArkUI_RenderNodeUtils_DisposeNode(node);
            continue;
        }
        ArkUI_NodeHandle host = api->createNode(ARKUI_NODE_CUSTOM);
        if (host == nullptr) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_SKIP reason=custom-node-null");
            OH_ArkUI_RenderNodeUtils_DisposeNode(node);
            continue;
        }
        ArkUI_NumberValue wv[1] = {};
        wv[0].f32 = static_cast<float>(w);
        ArkUI_AttributeItem wi{wv, 1, nullptr, nullptr};
        api->setAttribute(host, NODE_WIDTH, &wi);
        ArkUI_NumberValue hv[1] = {};
        hv[0].f32 = static_cast<float>(h);
        ArkUI_AttributeItem hi{hv, 1, nullptr, nullptr};
        api->setAttribute(host, NODE_HEIGHT, &hi);

        int32_t rc = OH_ArkUI_RenderNodeUtils_AddRenderNode(host, node);
        if (rc != ARKUI_ERROR_CODE_NO_ERROR) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_ADD 失败 rc=%{public}d", rc);
            api->disposeNode(host);
            OH_ArkUI_RenderNodeUtils_DisposeNode(node);
            continue;
        }
        rc = OH_ArkUI_NodeContent_AddNode(g_content, host);
        if (rc != ARKUI_ERROR_CODE_NO_ERROR) {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_CONTENT_ADD 失败 rc=%{public}d", rc);
            api->disposeNode(host);
            OH_ArkUI_RenderNodeUtils_DisposeNode(node);
            continue;
        }
        built++;
    }
    g_nodeCount = built;
    OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                 "PROTEUS_RENDER_DONE nodes=%{public}d parsed=%{public}zu texts=%{public}d",
                built, items.size(), textCount);
    napi_value out;
    napi_create_int32(env, built, &out);
    return out;
}

/** stats(): {nodes: number} —— 机器判据读数（与 Android/iOS 宿主记账同思路） */
static napi_value Stats(napi_env env, napi_callback_info info) {
    napi_value obj;
    napi_create_object(env, &obj);
    napi_value n;
    napi_create_int32(env, g_nodeCount, &n);
    napi_set_named_property(env, obj, "nodes", n);
    return obj;
}

EXTERN_C_START
static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"renderCommands", nullptr, RenderCommands, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module demoModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = Init,
    .nm_modname = "proteus_render",
    .nm_priv = nullptr,
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterProteusRenderModule(void) {
    napi_module_register(&demoModule);
}
