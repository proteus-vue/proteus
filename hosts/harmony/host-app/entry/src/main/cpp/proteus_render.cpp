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
static bool g_unitScaleLogged = false;   // 单位标定日志只打一次
/**
 * ★★设备密度（vp2px）——由 ArkTS 侧 `attach(content, density)` 传入。
 *   【为什么必须知道它（2026-10-02 真机实测踩坑）】RenderNode 的 SetSize/SetPosition 与
 *   content modifier 的 canvas 都是**物理 px**；而 customNode 的 `NODE_WIDTH/NODE_HEIGHT`
 *   属性是 **vp**。此前直接把 px 值赋给 NODE_WIDTH ⇒ host 被撑大到 w×密度 的像素宽
 *   （1148px → 4018px），Stack 居中后左缘跑到屏外 ⇒ **色块整体不可见**（几何值却完全正确,
 *   所以只有"按屏幕像素核算 host 尺寸"才发现——见 PROTEUS_RENDER_NODE 取证日志）。
 *   ⇒ host 的 vp 尺寸 = 内容 px ÷ 密度。
 */
static double g_density = 1.0;

/* ══════════════ 矩阵 #15：平台零参与动画（MA0-RT 的鸿蒙腿）══════════════
 *
 * 【要证明什么（与 Android `check-platform-anim.py` A 组同字段口径）】
 *   ① 贝塞尔曲线**来自内核**（宿主零曲线数学——与 Android/iOS 同一契约）；
 *   ② 变换（translate/scale/opacity）由 **RenderNode 属性**承载——动画窗口内
 *      **应用层零绘制指令构建**（g_cmdBuildCount 恒定）、零布局；
 *   ③ 终态精确（tx=120 / alpha=0.5 / scale=0.6 设计单位与 Android 同值）；
 *   ④ model 值**逐帧推进**（≥2 个不同读数，且含**读回**证据 GetScale/GetOpacity——
 *      不是复述我们写下去的数）。
 *
 * 【与 Android 的语义差异（诚实边界，写清不遮掩）】
 *   · Android：`ViewPropertyAnimator` 一次性启动，**RenderThread 自主插值**（应用零调用）；
 *   · 鸿蒙：C-API 无同形"启动即自插值"入口 ⇒ 本探针由 **ArkUI VSync 帧回调**
 *     （`postFrameCallback`——与系统动画同一帧源）**逐帧写属性**（每步仅 3 次属性写入 +
 *     2 次读回，无绘制、无布局）——即"应用层零绘制、渲染进程负责组合"成立；
 *     "插值完全归平台"在鸿蒙当前 API 下无等价物（如实标注，不冒充等价）。
 *   · 鸿蒙宿主**无 CPU onDraw 通路**（光栅在 RS 进程）⇒ "主线程零参与绘制"以
 *     **宿主指令构建次数**（g_cmdBuildCount）为口径（Android 用 onDraw 计数）。
 */
static int g_cmdBuildCount = 0;          // RenderCommands 被调用的次数（指令构建）
static int g_cmdBuildBaseline = -1;      // 动画窗口起点
static ArkUI_RenderNodeHandle g_animTarget = nullptr;  // 目标节点（根的第一个子节点）
// ★曲线不在此模块取（render 模块不链 Rust 核——依赖边界）：贝塞尔由 ArkTS 从 **bench 模块**
//   的 `animCurveBezier(id)` 取（与 Android/iOS 同一内核契约），JS 组合进报告。

/** `{"tx":..,"scale":..,"alpha":..}` 的数字读取（原型级——结构固定） */
static bool jsonNum(const char* s, const char* key, double* out) {
    std::string needle = std::string("\"") + key + "\"";
    const char* p = strstr(s, needle.c_str());
    if (!p) return false;
    const char* colon = strchr(p, ':');
    if (!colon) return false;
    char* end = nullptr;
    *out = strtod(colon + 1, &end);
    return end != colon + 1;
}

/**
 * ★★★**渲染树形态（2026-10-02 第二次架构修正）**：一个**全屏 host** + 一个**根 RenderNode**，
 *   所有元素 RenderNode 作为根节点的子节点（`AddChild`）——而不是"每元素一个 host customNode"。
 *
 * 【为什么（首版"每元素一个 host"的实测缺陷）】每个 host customNode 都会被 **ArkUI 布局流**
 *   接管摆放（Stack 居中）⇒ 元素内容坐标（SetPosition）落在 host 内的相对位置，
 *   最终屏幕位置 = host 摆放位置 + 内容 y ⇒ **整组色块被居中**、偏离设计坐标
 *   （实测：x=56/y=140 的内容出现在屏幕纵向中部）。
 *   ⇒ 正解 = 单一全屏 host（布局流无自由度）+ 根 RenderNode（全屏、坐标空间=屏幕 px）
 *     + 元素作为其子节点（`OH_ArkUI_RenderNodeUtils_AddChild`）⇒ **绝对坐标精确定位**。
 *   这与 Android（ProteusHostView 全屏 + Canvas 绝对坐标）同构。
 */
static ArkUI_NodeHandle g_rootHost = nullptr;
static ArkUI_RenderNodeHandle g_rootNode = nullptr;

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
    /** 节点声明宽（vp）——用于**单位标定**：canvas 若是物理 px，字号需按比例换算（见回调注释） */
    double widthVp = 0.0;
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

    // ★★单位标定（2026-10-02 实测修复）：content modifier 的 canvas **不保证是 vp 坐标系**——
    //   若节点声明 300(vp)、画布实测 N(px)，则 1 vp = N/300 px。字号传入前乘该比例，
    //   否则字号按物理 px 解释 ⇒ 视觉显著偏小（首版截图目视抓出：24 的字看起来只有 ~8vp）。
    //   ★标定方式 = 画布尺寸 ÷ 节点声明宽（不猜密度表，不查设备参数——用**实测比值**）。
    double unitScale = 1.0;
    if (spec->widthVp > 0.0) {
        // ★双读实证（2026-10-02）：头文件写 `int32 width`，但真机字节是 **float**（首读得
        //   1133903872 = float 300.0 的位模式）⇒ 两种解释都打出来，用**实测比值**定标定。
        ArkUI_IntSize sz = OH_ArkUI_DrawContext_GetSize(context);
        float wAsFloat = 0.0f;
        memcpy(&wAsFloat, &sz.width, sizeof(float));
        if (!g_unitScaleLogged) {
            g_unitScaleLogged = true;
            OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                         "PROTEUS_RENDER_TEXT_UNIT int_read=%{public}d float_read=%.2f node_w_vp=%.1f",
                         sz.width, wAsFloat, spec->widthVp);
        }
        // 诊断用：canvas 宽（px 读法）与 spec 宽（px）应量级一致 ⇒ 印证"canvas = 物理 px"
        // （换算已在 ArkTS 侧完成；此块不参与字号计算）
    }

    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleColor(tstyle, spec->color);
    // ★字号已是**物理 px**（ArkTS 侧 ×密度 —— 换算只在一处）⇒ 此处直用，不再乘标定比例
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
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc >= 2) {
        double d = 1.0;
        if (napi_get_value_double(env, args[1], &d) == napi_ok && d > 0.0) {
            g_density = d;
        }
    }
    double screenWvp = 0, screenHvp = 0;
    if (argc >= 4) {
        napi_get_value_double(env, args[2], &screenWvp);
        napi_get_value_double(env, args[3], &screenHvp);
    }
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

    // ★建全屏 host + 根 RenderNode（见 g_rootHost 注释的架构修正）——只建一次（attach 幂等）
    if (g_rootHost == nullptr && probeApi != nullptr && screenWvp > 0 && screenHvp > 0) {
        g_rootHost = probeApi->createNode(ARKUI_NODE_CUSTOM);
        if (g_rootHost != nullptr) {
            ArkUI_NumberValue wv[1] = {}; wv[0].f32 = (float)screenWvp;
            ArkUI_AttributeItem wi{wv, 1, nullptr, nullptr};
            probeApi->setAttribute(g_rootHost, NODE_WIDTH, &wi);
            ArkUI_NumberValue hv[1] = {}; hv[0].f32 = (float)screenHvp;
            ArkUI_AttributeItem hi{hv, 1, nullptr, nullptr};
            probeApi->setAttribute(g_rootHost, NODE_HEIGHT, &hi);
            g_rootNode = OH_ArkUI_RenderNodeUtils_CreateNode();
            if (g_rootNode != nullptr) {
                OH_ArkUI_RenderNodeUtils_SetSize(g_rootNode,
                    (int32_t)(screenWvp * g_density), (int32_t)(screenHvp * g_density));
                int32_t rc = OH_ArkUI_RenderNodeUtils_AddRenderNode(g_rootHost, g_rootNode);
                if (rc == ARKUI_ERROR_CODE_NO_ERROR) {
                    OH_ArkUI_NodeContent_AddNode(g_content, g_rootHost);
                } else {
                    OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG,
                                 "PROTEUS_RENDER_ROOT_ADD_FAIL rc=%{public}d", rc);
                }
            }
        }
    }
    OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                 "PROTEUS_RENDER_ATTACHED ok capi=%{public}d root=%{public}d",
                 probeApi != nullptr ? 1 : 0, g_rootNode != nullptr ? 1 : 0);
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
        // ★取证日志（2026-10-02）：下发值必须可直接核对（"渲染去哪了"这类问题不能靠猜）
        //   ★hilog 不吃 `%.1f`（打 <private>）⇒ snprintf 预格式化 + %{public}s（与 ArkTS 侧同坑）
        {
            char gbuf[160];
            snprintf(gbuf, sizeof(gbuf), "x=%.1f y=%.1f w=%.1f h=%.1f", x, y, w, h);
            OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                         "PROTEUS_RENDER_NODE %{public}s", gbuf);
        }
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
            auto* spec = new TextDrawSpec{textVal, fs, static_cast<uint32_t>(tc), "", w};
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
        // ★★挂到**根 RenderNode**（全屏坐标空间——见 g_rootHost 注释的架构修正）：
        //   AddChild(root, node) ⇒ 元素在屏幕绝对坐标空间内定位（不再被 ArkUI 布局流居中）。
        if (g_rootNode != nullptr) {
            int32_t rcAdd = OH_ArkUI_RenderNodeUtils_AddChild(g_rootNode, node);
            if (rcAdd != ARKUI_ERROR_CODE_NO_ERROR) {
                OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG,
                             "PROTEUS_RENDER_CHILD_ADD_FAIL rc=%{public}d", rcAdd);
                OH_ArkUI_RenderNodeUtils_DisposeNode(node);
                continue;
            }
        } else {
            OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, "PROTEUS_RENDER_SKIP reason=no-root");
            OH_ArkUI_RenderNodeUtils_DisposeNode(node);
            continue;
        }
        built++;
    }
    g_nodeCount = built;
    g_cmdBuildCount++;   // ★MA0-RT 判据：指令构建次数（动画窗口内应恒定）
    OH_LOG_Print(LOG_APP, LOG_INFO, LOG_DOMAIN, LOG_TAG,
                 "PROTEUS_RENDER_DONE nodes=%{public}d parsed=%{public}zu texts=%{public}d",
                built, items.size(), textCount);
    napi_value out;
    napi_create_int32(env, built, &out);
    return out;
}

/* ── 矩阵 #15：平台零参与动画的四个入口 ── */

/** platformAnimBegin(): {ok, on_draw_count} —— 记录窗口基线 + 取目标节点（根的第一个子节点） */
static napi_value PlatformAnimBegin(napi_env env, napi_callback_info info) {
    (void)info;
    g_cmdBuildBaseline = g_cmdBuildCount;
    g_animTarget = nullptr;
    if (g_rootNode != nullptr) {
        ArkUI_RenderNodeHandle child = nullptr;
        if (OH_ArkUI_RenderNodeUtils_GetChild(g_rootNode, 0, &child) == ARKUI_ERROR_CODE_NO_ERROR) {
            g_animTarget = child;
        }
    }
    char buf[160];
    snprintf(buf, sizeof(buf), "{\"ok\":%s,\"on_draw_count\":%d}",
             g_animTarget != nullptr ? "true" : "false", g_cmdBuildCount);
    PROTEUS_LOG("PROTEUS_PLATFORMANIM_BEGIN %{public}s", buf);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * platformAnimStep(json {tx, scale, alpha}): string(JSON)
 *   一步变换：SetTransform（m30 = tx，物理 px）+ SetScale + SetOpacity；
 *   随后**读回** GetScale / GetOpacity（写→读证据链），连同窗口内计数一起返回。
 *   全程零绘制指令、零布局（本函数只写属性 + 读回）。
 */
static napi_value PlatformAnimStep(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string js;
    if (argc >= 1) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        js.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &js[0], len + 1, &len);
        js.resize(len);
    }
    double tx = 0, scale = 1, alpha = 1;
    jsonNum(js.c_str(), "tx", &tx);
    jsonNum(js.c_str(), "scale", &scale);
    jsonNum(js.c_str(), "alpha", &alpha);

    int rcTransform = -1, rcScale = -1, rcOpacity = -1;
    float scaleRx = -1, scaleRy = -1, alphaR = -1;
    if (g_animTarget != nullptr) {
        // 4×4 列主序单位矩阵（m30 = x 平移，物理 px——与 Android tx=120 设计单位换算）
        float m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (float)(tx * g_density), 0, 0, 1};
        rcTransform = OH_ArkUI_RenderNodeUtils_SetTransform(g_animTarget, m);
        rcScale = OH_ArkUI_RenderNodeUtils_SetScale(g_animTarget, (float)scale, (float)scale);
        rcOpacity = OH_ArkUI_RenderNodeUtils_SetOpacity(g_animTarget, (float)alpha);
        OH_ArkUI_RenderNodeUtils_GetScale(g_animTarget, &scaleRx, &scaleRy);
        OH_ArkUI_RenderNodeUtils_GetOpacity(g_animTarget, &alphaR);
    }
    char buf[400];
    snprintf(buf, sizeof(buf),
             "{\"tx\":%.2f,\"scale\":%.3f,\"alpha\":%.3f,"
             "\"rc_transform\":%d,\"rc_scale\":%d,\"rc_opacity\":%d,"
             "\"scale_readback\":%.3f,\"alpha_readback\":%.3f,"
             "\"on_draw_count\":%d,\"on_measure_count\":%d,\"on_layout_count\":%d}",
             tx, scale, alpha, rcTransform, rcScale, rcOpacity,
             (double)scaleRx, (double)alphaR, g_cmdBuildCount, g_cmdBuildCount, g_cmdBuildCount);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * platformAnimEnd(): {ok, draw_delta, measure_delta, layout_delta, on_draw_count}
 *   窗口结算：三个增量（应全 0——"主线程零参与"）。★贝塞尔不在此返回（依赖边界见上，
 *   由 JS 从 bench 模块取后组合）。
 */
static napi_value PlatformAnimEnd(napi_env env, napi_callback_info info) {
    (void)info;
    int drawDelta = (g_cmdBuildBaseline >= 0) ? (g_cmdBuildCount - g_cmdBuildBaseline) : -1;
    char buf[256];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"draw_delta\":%d,\"measure_delta\":%d,"
             "\"layout_delta\":%d,\"on_draw_count\":%d}",
             drawDelta, drawDelta, drawDelta, g_cmdBuildCount);
    PROTEUS_LOG("PROTEUS_PLATFORMANIM_END %{public}s", buf);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/** platformAnimSave(content, path): number —— 报告落盘（沙箱 el2 映射路径 hdc 可读） */
static napi_value PlatformAnimSave(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string content, path;
    for (int i = 0; i < 2 && i < (int)argc; i++) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[i], nullptr, 0, &len);
        std::string buf(len + 1, '\0');
        napi_get_value_string_utf8(env, args[i], &buf[0], len + 1, &len);
        buf.resize(len);
        if (i == 0) content = buf; else path = buf;
    }
    int rc = -1;
    if (!path.empty()) {
        FILE* f = fopen(path.c_str(), "w");
        if (f != nullptr) {
            fwrite(content.data(), 1, content.size(), f);
            fclose(f);
            rc = 0;
        }
        PROTEUS_LOG("PROTEUS_PLATFORMANIM_SAVED rc=%{public}d path=%{public}s bytes=%{public}zu",
                    rc, path.c_str(), content.size());
    }
    napi_value out;
    napi_create_int32(env, rc, &out);
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
        {"platformAnimBegin", nullptr, PlatformAnimBegin, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"platformAnimStep", nullptr, PlatformAnimStep, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"platformAnimEnd", nullptr, PlatformAnimEnd, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"platformAnimSave", nullptr, PlatformAnimSave, nullptr, nullptr, nullptr, napi_default, nullptr},
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
