// entry/src/main/cpp/proteus_bench.cpp
// ★★★Proteus 鸿蒙宿主 —— **4050 元素应用级基准**（方案 M5，对标 Android/iOS 同口径）
//
// 【口径（逐条照搬 Android `app4050Run`——三端数字可比的前提）】
//   同一份夹具（真 SFC 编译产物 `app-4050-tree.json`：2050 view + 2000 text = 4050 元素 + 1 根）；
//   起点 = 触发时刻；终点 = **主线程侧渲染指令全部编码完毕**（Android 用 RenderNode.endRecording
//   作"送达"判定；鸿蒙对应物 = RenderNode 树构建完成）。
//   分段：建树+排版（Rust 核）→ 几何提取 + 直绘树构建。
//
// 【诚实边界（写进报告）】
//   ① 本宿主无 JS 引擎参与基准链路 ⇒ 编译+模板实例化在构建期完成（与 Android 宿主同）；
//   ② 鸿蒙的"录制"语义与 Android DisplayList 不同（RenderNode 是渲染节点树）——分段不逐段可比，
//      **总耗时 / 对原生比值** 才是三端口径对齐的指标；
//   ③ 文本绘制未实现（本里程碑只有 background 直绘）⇒ 直绘树只建"带背景色"的节点
//      （2050 view 格）；文本节点参与**排版**但不参与直绘——如实标注，不假装画了文字。
//
// 【Rust 核】链接 `libproteus_layout_core.a`（aarch64-unknown-linux-ohos 交叉编译；
//   与 Android/iOS 同一份 Rust 源码——"排版核心写一遍"的再次兑现）。
#include <string>
#include <vector>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cstdlib>
#include <chrono>
#include <unordered_map>
#include <hilog/log.h>

#include <napi/native_api.h>
#include <arkui/native_interface.h>
// ★文本通道（ArkGraphics2D）：typography 绘制（见 TextProbe）
#include <native_drawing/drawing_canvas.h>
#include <native_drawing/drawing_font_collection.h>
#include <native_drawing/drawing_text_typography.h>
#include <native_drawing/drawing_text_declaration.h>
#include <native_drawing/drawing_types.h>
#include <arkui/native_type.h>
#include <arkui/native_node.h>
#include <arkui/native_render.h>
// ★JSVM（V8）——矩阵 #13/#14 前置：设备端 JS 引擎可用性探针（与 Android QuickJS / iOS JSC 同定位）
#include <ark_runtime/jsvm.h>
// ★离屏像素自检（矩阵 #14 的 host_painted_samples）——与 Android "离屏位图采样" 同口径
#include <native_drawing/drawing_bitmap.h>
#include <native_drawing/drawing_brush.h>
#include <native_drawing/drawing_rect.h>
#include <native_drawing/drawing_round_rect.h>
#include <arkui/native_node_napi.h>

#define PROTEUS_BENCH_DOMAIN 0x0003
#define PROTEUS_BENCH_TAG "ProteusBench"

// ── Rust 核 C ABI（与 iOS `@_silgen_name` / Android JNI 同一组函数）──
extern "C" {
uint64_t proteus_layout_create(const char* request_json);
char* proteus_layout_rects(uint64_t handle);
char* proteus_layout_hit_test(uint64_t handle, float x, float y);
// ★★二进制指令流（矩阵 #14）：SFC 订阅驱动更新 → 内核增量重排（与 Android JNI 同一 ABI）
char* proteus_layout_apply_ops(uint64_t handle, const uint8_t* ptr, uint32_t len);
// ★复用池（长列表）——与 Android JNI / iOS @_silgen_name 同一组 C ABI
uint64_t proteus_recycle_create(uint32_t item_count, uint32_t leading_rows, uint32_t following_rows);
char* proteus_recycle_update(uint64_t handle, uint32_t first_visible, uint32_t last_visible);
char* proteus_recycle_stats(uint64_t handle);
void proteus_recycle_destroy(uint64_t handle);
// ★结构变更（splice）——与 Android `spliceRun` / iOS 同一组 ABI
char* proteus_layout_splice(uint64_t handle, const char* splice_json);
// ★★内核动画（矩阵 #16）——与 Android `kernelAnimRun` / iOS 同一组 C ABI：
//   start 承载"声明动画"（低频）；tick 承载"每帧推进"（高频，只有一个 dt）；
//   stop 清表 / seekScroll 滚动联动 / sharedElement 共享元素 / curveBezier 曲线采样。
char* proteus_layout_anim_start(uint64_t handle, const char* json);
char* proteus_layout_anim_tick(uint64_t handle, float dt_ms);
char* proteus_layout_anim_stop(uint64_t handle, const char* json);
char* proteus_layout_anim_seek_scroll(uint64_t handle, const char* json);
char* proteus_layout_anim_seek(uint64_t handle, const char* json);
char* proteus_layout_shared_element(uint64_t handle, const char* json);
char* proteus_anim_curve_bezier(uint32_t curve);
char* proteus_layout_version(void);
void proteus_layout_free_string(char* ptr);
bool proteus_layout_destroy(uint64_t handle);
}

using Clock = std::chrono::steady_clock;
static double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

/** 提取 JSON 数字字段（原型级解析——结构与夹具固定） */
static bool jnum(const char* s, size_t segLen, const char* key, double* out) {
    std::string seg(s, segLen);
    std::string needle = std::string("\"") + key + "\":";
    size_t p = seg.find(needle);
    if (p == std::string::npos) return false;
    p += needle.size();
    const char* base = seg.c_str() + p;
    char* end = nullptr;
    *out = strtod(base, &end);
    return end != base;
}

/** 解析 JSON 里的整型数组（`"key":[...]`）——原型级（结构与 ABI 输出固定） */
static void parseIntArray(const std::string& s, const char* key, std::vector<int>& out) {
    std::string needle = std::string("\"") + key + "\":[";
    size_t p = s.find(needle);
    if (p == std::string::npos) return;
    p += needle.size();
    size_t end = s.find(']', p);
    if (end == std::string::npos) return;
    std::string body = s.substr(p, end - p);
    size_t q = 0;
    while (q < body.size()) {
        while (q < body.size() && !isdigit((unsigned char)body[q])) q++;
        if (q >= body.size()) break;
        size_t st = q;
        while (q < body.size() && isdigit((unsigned char)body[q])) q++;
        out.push_back(atoi(body.substr(st, q - st).c_str()));
    }
}

/** 几何记录 */
struct Rect { float x, y, w, h; };

/**
 * ★★提取 `"nodes":[…]` 子串（**容忍任意空白**）。
 *   【为什么必须容忍（本轮实测踩到）】首版用精确串 `"nodes":[` —— 而构建期生成的夹具是
 *   **pretty-print**（`"nodes": [` 带空格）⇒ 匹配失败 ⇒ 探针报"夹具无 nodes"（值全对但格式不符）。
 *   ⇒ 判据/解析对**格式变化**要健壮（本仓纪律：解析器不假设输入格式）。
 */
static std::string extractNodesArray(const std::string& json) {
    size_t p = json.find("\"nodes\"");
    if (p == std::string::npos) return "";
    size_t colon = json.find(':', p);
    if (colon == std::string::npos) return "";
    size_t open = json.find('[', colon);
    if (open == std::string::npos) return "";
    // 大括号/方括号计数找到配对的 ']'
    int depth = 0;
    bool inStr = false;
    for (size_t i = open; i < json.size(); i++) {
        char c = json[i];
        if (inStr) {
            if (c == '\\') { i++; continue; }
            if (c == '"') inStr = false;
            continue;
        }
        if (c == '"') { inStr = true; continue; }
        if (c == '[') depth++;
        else if (c == ']') {
            depth--;
            if (depth == 0) return json.substr(open, i - open + 1);
        }
    }
    return "";
}

/**
 * 提取 JSON 字符串字段（原型级；带最小转义还原）。
 *   ★★**冒号后必须容忍空白**（本轮实测踩坑）：夹具是 pretty-print（`"backgroundColor": "#2f6fed"`
 *   **冒号后有空格**），首版精确匹配 `"key":"` ⇒ 全部字段静默取空（color 全 0 / text 全空
 *   ⇒ 渲染出一棵"几何正确但全透明"的树，画面上什么都没有）。
 *   这与 `extractNodesArray` 的空白坑**同源**：解析器一律不假设输入格式。
 *   （数值字段没踩到：`jnum` 用 strtod，strtod 自己跳过前导空白。）
 */
static bool jstr(const char* s, size_t segLen, const char* key, std::string* out) {
    std::string seg(s, segLen);
    std::string needle = std::string("\"") + key + "\"";
    size_t p = seg.find(needle);
    if (p == std::string::npos) return false;
    size_t colon = seg.find(':', p + needle.size());
    if (colon == std::string::npos) return false;
    size_t q = colon + 1;
    while (q < seg.size() && (seg[q] == ' ' || seg[q] == '\t' || seg[q] == '\n' || seg[q] == '\r')) q++;
    if (q >= seg.size() || seg[q] != '"') return false;
    p = q + 1;
    std::string r;
    for (size_t i = p; i < seg.size(); i++) {
        char c = seg[i];
        if (c == '\\' && i + 1 < seg.size()) {
            char n = seg[i + 1];
            if (n == 'n') r += '\n'; else if (n == 't') r += '\t'; else r += n;
            i++;
            continue;
        }
        if (c == '"') break;
        r += c;
    }
    *out = r;
    return true;
}

/** CSS 十六进制色（#RRGGBB / #AARRGGBB）→ ARGB；非法给 0（= 透明，不静默画错色） */
static uint32_t hexToArgb(const std::string& css) {
    std::string h = css;
    if (!h.empty() && h[0] == '#') h = h.substr(1);
    if (h.size() != 6 && h.size() != 8) return 0;
    uint32_t v = (uint32_t)strtoul(h.c_str(), nullptr, 16);
    if (h.size() == 6) v |= 0xFF000000u;
    return v;
}

/** 顶层数组切分为对象子串（大括号计数；字符串感知）——与 proteus_render.cpp 的切分同款 */
static std::vector<std::string> splitJsonObjects(const std::string& json) {
    std::vector<std::string> items;
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
    return items;
}

/** SFC 夹具节点的样式子集（渲染指令需要的字段） */
struct SfcStyle {
    uint32_t bg = 0;             // 0 = 无背景（透明）
    double radius = 0;
    uint32_t textColor = 0xFFFFFFFFu;
    double fontSize = 24;
    std::string text;
};

/** 按**文档序**解析样式表（id → SfcStyle）——顺序即绘制层序（父先子后） */
static void parseSfcStyles(const std::string& fixture, std::vector<std::pair<int, SfcStyle>>& out) {
    std::string arr = extractNodesArray(fixture);
    if (arr.empty()) return;
    for (const auto& item : splitJsonObjects(arr)) {
        double id = -1;
        if (!jnum(item.c_str(), item.size(), "id", &id)) continue;
        SfcStyle st;
        std::string bgCss;
        if (jstr(item.c_str(), item.size(), "backgroundColor", &bgCss)) st.bg = hexToArgb(bgCss);
        jnum(item.c_str(), item.size(), "borderRadius", &st.radius);
        std::string colorCss;
        if (jstr(item.c_str(), item.size(), "color", &colorCss)) st.textColor = hexToArgb(colorCss);
        jnum(item.c_str(), item.size(), "fontSize", &st.fontSize);
        jstr(item.c_str(), item.size(), "text", &st.text);
        out.emplace_back((int)id, st);
    }
}

/** JSON 字符串转义（文本进指令数组前必须转义引号/反斜杠/控制符） */
static std::string jsonEscape(const std::string& s) {
    std::string r;
    for (char c : s) {
        switch (c) {
            case '"': r += "\\\""; break;
            case '\\': r += "\\\\"; break;
            case '\n': r += "\\n"; break;
            case '\t': r += "\\t"; break;
            case '\r': r += "\\r"; break;
            default: r += c;
        }
    }
    return r;
}

static void parseRects(const std::string& s, std::unordered_map<int, Rect>& out);

/**
 * ★★typography 文本度量（物理 px 输入 → 物理 px 输出）——**与绘制同一条引擎**（自洽）。
 *
 * 【为什么必须有（本轮实测踩坑）】夹具的文本节点多数**没有显式 height**（行文本靠内容撑高）——
 *   内核的输入契约是"度量表随树给"（`textMeasures`），宿主不填 ⇒ 内核按零尺寸处理 ⇒
 *   文本节点盒高 0 ⇒ content modifier 画布 0 像素 ⇒ **画面上什么都没有**（几何全对、色块全对，
 *   唯独文字消失）。对照端各宿主都有度量：Android `TextPaint.measureText`（真实字体度量）、
 *   iOS CoreText、Web 浏览器行盒。鸿蒙腿此前 `"textMeasures":{}`（= 缺这一环）。
 *   ⇒ 度量放**宿主侧**（内核平台无关性的体现）；本函数即鸿蒙宿主的 `measure_text` 实现。
 *   ★口径：物理字号量一次（与 DrawTextCallback 的绘制字号完全一致），再由调用方换回设计单位。
 */
static void measureTextTypoPx(const std::string& text, double fontPx, double* outW, double* outH) {
    *outW = 0;
    *outH = 0;
    if (text.empty() || fontPx <= 0) return;
    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleFontSize(tstyle, fontPx);
    OH_Drawing_TypographyCreate* handler = OH_Drawing_CreateTypographyHandler(ts, fc);
    if (handler != nullptr) {
        OH_Drawing_TypographyHandlerPushTextStyle(handler, tstyle);
        OH_Drawing_TypographyHandlerAddText(handler, text.c_str());
        OH_Drawing_Typography* typo = OH_Drawing_CreateTypography(handler);
        if (typo != nullptr) {
            OH_Drawing_TypographyLayout(typo, 10000.0);
            *outW = OH_Drawing_TypographyGetLongestLine(typo);
            *outH = OH_Drawing_TypographyGetHeight(typo);
            OH_Drawing_DestroyTypography(typo);
        }
        OH_Drawing_DestroyTypographyHandler(handler);
    }
    OH_Drawing_DestroyTextStyle(tstyle);
    OH_Drawing_DestroyTypographyStyle(ts);
    OH_Drawing_DestroyFontCollection(fc);
}

/** 夹具排版（视口 = 调用方传入的**逻辑 vp 尺寸**——夹具 device-independent，视口运行时给）：
 *   返回 layout handle（0 = 失败）；rects 输出 id→几何（逻辑单位）。 */
static uint64_t layoutSfcFixture(const std::string& fixture, double vpW, double vpH,
                                 double density, std::unordered_map<int, Rect>& rects) {
    std::string nodesArr = extractNodesArray(fixture);
    if (nodesArr.empty() || vpW <= 0 || vpH <= 0) return 0;
    if (density <= 0) density = 1.0;
    // ★★度量表（宿主职责）：逐文本节点用 typography 量（物理字号），换回**设计单位**（÷密度）。
    //   —— 不填表 = 文本零尺寸 = 文字不显示（见 measureTextTypoPx 注释的实测）。
    std::vector<std::pair<int, SfcStyle>> stylesForMeasure;
    parseSfcStyles(fixture, stylesForMeasure);
    std::string measures = "{";
    int mCount = 0;
    for (const auto& kv : stylesForMeasure) {
        if (kv.second.text.empty()) continue;
        double wpx = 0, hpx = 0;
        measureTextTypoPx(kv.second.text, kv.second.fontSize * density, &wpx, &hpx);
        char mb[160];
        snprintf(mb, sizeof(mb), "%s\"%d\":{\"width\":%.4f,\"height\":%.4f}",
                 mCount > 0 ? "," : "", kv.first, wpx / density, hpx / density);
        measures += mb;
        mCount++;
    }
    measures += "}";
    char vp[96];
    snprintf(vp, sizeof(vp), "{\"width\":%.4f,\"height\":%.4f}", vpW, vpH);
    std::string req = std::string("{\"viewport\":") + vp + ",\"nodes\":" + nodesArr +
                      ",\"textMeasures\":" + measures + "}";
    uint64_t handle = proteus_layout_create(req.c_str());
    if (handle == 0) return 0;
    char* rectsRaw = proteus_layout_rects(handle);
    std::string rectsStr = rectsRaw ? rectsRaw : "{}";
    if (rectsRaw) proteus_layout_free_string(rectsRaw);
    parseRects(rectsStr, rects);
    return handle;
}

/** 提取 `"key":{…}` 或 `"key":[…]` 的子串（括号计数；字符串感知）——viewport/rects/text_updates 复用 */
static std::string extractValueAfterKey(const std::string& json, const char* key, char openCh, char closeCh) {
    std::string needle = std::string("\"") + key + "\"";
    size_t p = json.find(needle);
    if (p == std::string::npos) return "";
    size_t open = json.find(openCh, p + needle.size());
    if (open == std::string::npos) return "";
    int depth = 0;
    bool inStr = false;
    for (size_t i = open; i < json.size(); i++) {
        char c = json[i];
        if (inStr) {
            if (c == '\\') { i++; continue; }
            if (c == '"') inStr = false;
            continue;
        }
        if (c == '"') { inStr = true; continue; }
        if (c == openCh) depth++;
        else if (c == closeCh) {
            depth--;
            if (depth == 0) return json.substr(open, i - open + 1);
        }
    }
    return "";
}

/**
 * 单遍解析 rects JSON → map<id, Rect>
 *   ★为什么必须单遍（首版隐患）：对每个节点在整串里 `find` 是 O(n²)——
 *     4051 节点 × ~600KB ≈ 2.4GB 扫描，会把"几何提取"段推高到秒级、污染计时。
 *   结构固定：{"rects":{"<id>":{"x":..,"y":..,"width":..,"height":..},...}}
 */
static void parseRects(const std::string& s, std::unordered_map<int, Rect>& out) {
    size_t p = 0;
    while (true) {
        size_t q = s.find("\":{", p);
        if (q == std::string::npos) break;
        size_t e = q, b = e;
        while (b > 0 && isdigit((unsigned char)s[b - 1])) b--;
        if (b == e) { p = q + 1; continue; }
        int id = atoi(s.substr(b, e - b).c_str());
        size_t segEnd = s.find('}', q);
        if (segEnd == std::string::npos) break;
        double x = 0, y = 0, w = 0, h = 0;
        jnum(s.c_str() + q, segEnd - q, "x", &x);
        jnum(s.c_str() + q, segEnd - q, "y", &y);
        jnum(s.c_str() + q, segEnd - q, "width", &w);
        jnum(s.c_str() + q, segEnd - q, "height", &h);
        out[id] = Rect{(float)x, (float)y, (float)w, (float)h};
        p = segEnd + 1;
    }
}

/**
 * bench4050(fixtureJson, viewportW, viewportH, depthLimit): string(JSON)
 *   depthLimit: 直绘树构建的节点上限（0 = 全量）
 */
static napi_value Bench4050(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 3) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"参数不足\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t len = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
    std::string fixture(len + 1, '\0');
    napi_get_value_string_utf8(env, args[0], &fixture[0], len + 1, &len);
    fixture.resize(len);
    double W = 1080, H = 2400, depthLimit = 0;
    napi_get_value_double(env, args[1], &W);
    napi_get_value_double(env, args[2], &H);
    if (argc >= 4) napi_get_value_double(env, args[3], &depthLimit);

    size_t nodesKey = fixture.find("\"nodes\":[");
    if (nodesKey == std::string::npos) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"夹具无 nodes 数组\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t arrStart = nodesKey + strlen("\"nodes\":");
    size_t arrEnd = fixture.rfind(']');
    if (arrEnd <= arrStart) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"夹具 nodes 数组不完整\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    std::string nodes = fixture.substr(arrStart, arrEnd - arrStart + 1);

    int nodeCount = 0;
    std::vector<int> bgIds;
    {
        size_t p = 0;
        while ((p = nodes.find("\"id\":", p)) != std::string::npos) {
            double id = 0;
            if (jnum(nodes.c_str() + p, 24, "id", &id)) {
                nodeCount++;
                size_t next = nodes.find("\"id\":", p + 5);
                size_t segEnd = next == std::string::npos ? nodes.size() : next;
                std::string seg = nodes.substr(p, segEnd - p);
                if (seg.find("\"backgroundColor\"") != std::string::npos) bgIds.push_back((int)id);
            }
            p += 5;
        }
    }

    // ── ① 建树 + 排版（Rust 核；与 Android/iOS 同一份源码）──
    std::string req = "{\"viewport\":{\"width\":" + std::to_string((int)W) +
                      ",\"height\":" + std::to_string((int)H) +
                      "},\"nodes\":" + nodes + ",\"textMeasures\":{}}";
    auto t0 = Clock::now();
    uint64_t handle = proteus_layout_create(req.c_str());
    double layoutMs = msSince(t0);
    if (handle == 0) {
        OH_LOG_Print(LOG_APP, LOG_ERROR, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                     "PROTEUS_BENCH_ERROR proteus_layout_create 失败（nodes=%{public}d）", nodeCount);
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"proteus_layout_create 失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }

    // ── ② 几何提取（单遍）+ 直绘树构建 ──
    auto t1 = Clock::now();
    char* rectsRaw = proteus_layout_rects(handle);
    std::string rects = rectsRaw ? rectsRaw : "{}";
    if (rectsRaw) proteus_layout_free_string(rectsRaw);
    std::unordered_map<int, Rect> rectMap;
    rectMap.reserve(nodeCount * 2);
    parseRects(rects, rectMap);

    ArkUI_NativeNodeAPI_1* api = nullptr;
    OH_ArkUI_GetModuleInterface(ARKUI_NATIVE_NODE, ArkUI_NativeNodeAPI_1, api);
    int built = 0, processed = 0;
    for (int id : bgIds) {
        if (depthLimit > 0 && processed >= (int)depthLimit) break;
        processed++;
        auto it = rectMap.find(id);
        if (it == rectMap.end()) continue;
        ArkUI_RenderNodeHandle node = OH_ArkUI_RenderNodeUtils_CreateNode();
        if (node == nullptr) continue;
        OH_ArkUI_RenderNodeUtils_SetSize(node, (int32_t)it->second.w, (int32_t)it->second.h);
        OH_ArkUI_RenderNodeUtils_SetPosition(node, (int32_t)it->second.x, (int32_t)it->second.y);
        OH_ArkUI_RenderNodeUtils_SetBackgroundColor(node, 0xFF285AC8u);
        built++;
        OH_ArkUI_RenderNodeUtils_DisposeNode(node);
    }
    double emitMs = msSince(t1);

    double scopeMs = msSince(t0);
    char* verRaw = proteus_layout_version();
    std::string ver = verRaw ? verRaw : "unknown";
    if (verRaw) proteus_layout_free_string(verRaw);
    proteus_layout_destroy(handle);

    char buf[768];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"engine\":\"%s\",\"node_count\":%d,\"rect_count\":%d,\"bg_node_count\":%d,"
             "\"built_render_nodes\":%d,\"scope_ms\":%.2f,\"layout_ms\":%.2f,\"emit_ms\":%.2f,"
             "\"note\":\"鸿蒙腿：Rust 核（aarch64-unknown-linux-ohos）+ RenderNode 直绘树构建；"
             "文本绘制未实现（只建带背景色节点）\"}",
             ver.c_str(), nodeCount, (int)rectMap.size(), (int)bgIds.size(), built,
             scopeMs, layoutMs, emitMs);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_BENCH_DONE nodes=%{public}d rects=%{public}d built=%{public}d scope=%.2fms layout=%.2fms",
                 nodeCount, (int)rectMap.size(), built, scopeMs, layoutMs);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * hitProbe(): string(JSON) —— ★命中测试探针（与 Android `hitTestRun` / iOS `runHitProbes`
 *   **同一份场景与探针点**；三端共享核心的直接证据，要求**逐位相同**）。
 *
 * 场景（与两端完全一致）：
 *   root 300×300
 *     ├── 2 顶栏 300×60（在流）
 *     ├── 3 卡片 300×180（在流）
 *     │     ├── 4 absolute 240×140 @(30,20)
 *     │     └── 5 absolute 140×100 @(60,50)
 *     └── 6 底栏 300×60
 * 期望（纯几何，本文件独立声明）：
 *   (150,30)→2 · (150,90)→4 · (100,110)→5 · (150,140)→5 · (150,290)→6 · (400,400)→-1
 */
static napi_value HitProbe(napi_env env, napi_callback_info info) {
    const char* scene =
        "{\"viewport\":{\"width\":300,\"height\":300},\"nodes\":["
        "{\"id\":1,\"parentId\":null,\"width\":300.0,\"height\":300.0,\"flexDirection\":\"column\"},"
        "{\"id\":2,\"parentId\":1,\"width\":300.0,\"height\":60.0},"
        "{\"id\":3,\"parentId\":1,\"width\":300.0,\"height\":180.0},"
        "{\"id\":4,\"parentId\":3,\"position\":\"absolute\",\"top\":20.0,\"left\":30.0,\"width\":240.0,\"height\":140.0},"
        "{\"id\":5,\"parentId\":3,\"position\":\"absolute\",\"top\":50.0,\"left\":60.0,\"width\":140.0,\"height\":100.0},"
        "{\"id\":6,\"parentId\":1,\"width\":300.0,\"height\":60.0}"
        "],\"textMeasures\":{}}";
    uint64_t handle = proteus_layout_create(scene);
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    // ★期望值独立声明（不取自任何一端的结果——避免「共同错」被当成一致）
    const float probes[6][2] = {{150, 30}, {150, 90}, {100, 110}, {150, 140}, {150, 290}, {400, 400}};
    const int expect[6] = {2, 4, 5, 5, 6, -1};
    std::string results = "[";
    int mismatch = 0;
    for (int i = 0; i < 6; i++) {
        char* raw = proteus_layout_hit_test(handle, probes[i][0], probes[i][1]);
        std::string rj = raw ? raw : "{}";
        if (raw) proteus_layout_free_string(raw);
        // ★字段名以 Rust 侧返回为准（`{"ok":true,"target":<id|null>,"path":[...],"chain":[...]}`）——
        //   首版误写 `hit_node_id` ⇒ 恒 -1（假红 5 条），修正如实记：**接口字段名要读实现，不要猜**。
        // ★★`target` 可为 **null**（界外未命中）——必须显式判 null：
        //   直接数字解析会把 null 读成 0（strtod 不动指针 ⇒ 返回 false 但残留 0）⇒ 误报命中根节点。
        //   （Android 侧同语义：`!ho.isNull("target")` 才取值，否则 -1。）
        double hit = -1;
        if (rj.find("\"target\":null") == std::string::npos) {
            jnum(rj.c_str(), rj.size(), "target", &hit);
        }
        if (hit != expect[i]) mismatch++;
        char buf[96];
        snprintf(buf, sizeof(buf), "%s{\"x\":%.0f,\"y\":%.0f,\"hit\":%d,\"expect\":%d}",
                 i ? "," : "", probes[i][0], probes[i][1], (int)hit, expect[i]);
        results += buf;
    }
    results += "]";
    proteus_layout_destroy(handle);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_HIT_PROBE_DONE mismatch=%{public}d", mismatch);
    std::string out = "{\"ok\":" + std::string(mismatch == 0 ? "true" : "false")
        + ",\"mismatch\":" + std::to_string(mismatch) + ",\"probes\":" + results + "}";
    napi_value v;
    napi_create_string_utf8(env, out.c_str(), NAPI_AUTO_LENGTH, &v);
    return v;
}

/**
 * recycleProbe(rows: number, frames: number): string(JSON)
 *
 * ★★长列表复用池（与 Android `recycle` 通路 / iOS `V12_scroll_recycle` 同一条路）：
 *   **Rust 核只给决策**（本帧 acquire/release 哪几行 + 方向）、**宿主只执行动作**
 *   （取/还 RenderNode 句柄——鸿蒙的 layer 等价物）。
 *
 * 读数（与两端同口径）：created / reused / reuse_ratio / max_live / 层数恒定。
 * ★纪律（沿用 ABI 注释）：**先 release 再 acquire**——反过来会让本帧新层无法复用刚释放的层，
 *   `created` 虚高、复用率虚低（池的效果被自己吃掉）。
 */
static napi_value RecycleProbe(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    double rowsD = 4000, framesD = 400;
    if (argc >= 1) napi_get_value_double(env, args[0], &rowsD);
    if (argc >= 2) napi_get_value_double(env, args[1], &framesD);
    int rows = (int)rowsD;
    int frames = (int)framesD;
    const int WINDOW = 20;   // 可见窗口（行）——与 Android 侧 22 同量级

    uint64_t pool = proteus_recycle_create((uint32_t)rows, 0, 0);
    if (pool == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"recycle_create 失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }

    // 宿主侧真实动作：行 → RenderNode 句柄表 + 空闲池
    std::unordered_map<int, ArkUI_RenderNodeHandle> liveNodes;
    std::vector<ArkUI_RenderNodeHandle> freePool;
    int created = 0, reused = 0, maxLive = 0;
    int dirForward = 0, dirBackward = 0;
    int maxAcquirePerFrame = 0, maxReleasePerFrame = 0;
    long totalAcquire = 0, totalRelease = 0;
    int maxDistinctLive = 0;

    int span = rows > WINDOW ? rows - WINDOW : 1;
    for (int f = 0; f < frames; f++) {
        // 前进半程 → 回退半程（"滚动到底再回滚"，与 Android 一致）
        int first;
        if (f < frames / 2) {
            first = (int)((long)f * span / (frames / 2 > 0 ? frames / 2 : 1));
        } else {
            int g = f - frames / 2;
            int half = frames - frames / 2;
            first = span - (int)((long)g * span / (half > 0 ? half : 1));
        }
        if (first < 0) first = 0;
        int last = first + WINDOW - 1;
        if (last >= rows) last = rows - 1;

        char* raw = proteus_recycle_update(pool, (uint32_t)first, (uint32_t)last);
        std::string dec = raw ? raw : "{}";
        if (raw) proteus_layout_free_string(raw);

        std::vector<int> acquire, release;
        parseIntArray(dec, "acquire", acquire);
        parseIntArray(dec, "release", release);
        std::string dir;
        {
            size_t dp = dec.find("\"direction\":\"");
            if (dp != std::string::npos) {
                size_t st = dp + 13, en = dec.find('"', st);
                dir = dec.substr(st, en - st);
            }
        }
        if (dir == "forward") dirForward++;
        else if (dir == "backward") dirBackward++;
        if ((int)acquire.size() > maxAcquirePerFrame) maxAcquirePerFrame = (int)acquire.size();
        if ((int)release.size() > maxReleasePerFrame) maxReleasePerFrame = (int)release.size();
        totalAcquire += (long)acquire.size();
        totalRelease += (long)release.size();

        // ★先 release（还层）再 acquire（取层）——见函数头注
        for (int r : release) {
            auto it = liveNodes.find(r);
            if (it != liveNodes.end()) {
                freePool.push_back(it->second);
                liveNodes.erase(it);
            }
        }
        for (int r : acquire) {
            ArkUI_RenderNodeHandle node = nullptr;
            if (!freePool.empty()) {
                node = freePool.back();
                freePool.pop_back();
                reused++;
            } else {
                node = OH_ArkUI_RenderNodeUtils_CreateNode();
                if (node == nullptr) continue;
                OH_ArkUI_RenderNodeUtils_SetSize(node, 300, 60);
                created++;
            }
            OH_ArkUI_RenderNodeUtils_SetPosition(node, 0, r * 62);
            OH_ArkUI_RenderNodeUtils_SetBackgroundColor(node, 0xFF1B1B21u);
            liveNodes[r] = node;
        }
        if ((int)liveNodes.size() > maxLive) maxLive = (int)liveNodes.size();
    }

    char* statsRaw = proteus_recycle_stats(pool);
    std::string stats = statsRaw ? statsRaw : "{}";
    if (statsRaw) proteus_layout_free_string(statsRaw);
    double demoted = 0, liveFinal = 0, updates = 0;
    jnum(stats.c_str(), stats.size(), "demote_events", &demoted);
    jnum(stats.c_str(), stats.size(), "live", &liveFinal);
    jnum(stats.c_str(), stats.size(), "updates", &updates);

    // 清理：销毁全部 RenderNode + 池
    for (auto& kv : liveNodes) OH_ArkUI_RenderNodeUtils_DisposeNode(kv.second);
    for (auto* n : freePool) OH_ArkUI_RenderNodeUtils_DisposeNode(n);
    proteus_recycle_destroy(pool);
    maxDistinctLive = maxLive;

    double ratio = (created + reused) > 0 ? (double)reused / (double)(created + reused) : -1;
    char buf[1024];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"rows\":%d,\"frames\":%d,\"window\":%d,"
             "\"created\":%d,\"reused\":%d,\"reuse_ratio\":%.4f,"
             "\"max_live\":%d,\"final_live\":%.0f,\"demoted\":%.0f,\"updates\":%.0f,"
             "\"dir_forward_frames\":%d,\"dir_backward_frames\":%d,"
             "\"max_acquire_per_frame\":%d,\"max_release_per_frame\":%d,"
             "\"total_acquire\":%ld,\"total_release\":%ld,"
             "\"note\":\"鸿蒙腿：Rust 核决策 + 宿主真执行 RenderNode 句柄复用（先 release 后 acquire）\"}",
             rows, frames, WINDOW, created, reused, ratio, maxDistinctLive, liveFinal,
             demoted, updates, dirForward, dirBackward, maxAcquirePerFrame, maxReleasePerFrame,
             totalAcquire, totalRelease);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_RECYCLE_DONE created=%{public}d reused=%{public}d ratio=%.4f max_live=%{public}d",
                 created, reused, ratio, maxDistinctLive);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * spliceProbe(): string(JSON) —— ★结构变更（与 Android `spliceRun` 同一棵树同一 payload）。
 *
 * 场景：0 根 → 3 容器 → 4,5 两行；splice 在 3 的 index 2 插入 id=6（height 50）。
 * 判据（与 Android 四项一致）：
 *   ① rects 增加 SPLICE_NODE_COUNT ② removed=0 且 inserted=1
 *   ③ 新节点拿到声明的 50 高（样式平铺才可能有） ④ 重排范围有界（0 < relayout < 20）
 */
static napi_value SpliceProbe(napi_env env, napi_callback_info info) {
    const char* tree =
        "{\"viewport\":{\"width\":300,\"height\":400},\"nodes\":["
        "{\"id\":0,\"parentId\":null,\"width\":300.0,\"flexDirection\":\"column\"}"
        ",{\"id\":3,\"parentId\":0,\"width\":300.0,\"flexDirection\":\"column\"}"
        ",{\"id\":4,\"parentId\":3,\"width\":300.0,\"height\":50.0,\"flexShrink\":0.0}"
        ",{\"id\":5,\"parentId\":3,\"width\":300.0,\"height\":50.0,\"flexShrink\":0.0}"
        "],\"textMeasures\":{}}";
    const char* spliceJson =
        "{\"removes\":[],\"inserts\":[{\"parentId\":3,\"index\":2,\"nodes\":["
        "{\"id\":6,\"parentId\":3,\"height\":50,\"flexShrink\":0,"
        "\"paintHint\":{\"isMonochrome\":false,\"isPureBackground\":false}}]}]}";

    uint64_t handle = proteus_layout_create(tree);
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    // rects 计数（粗口径：数 "id" 出现次数）
    auto countRects = [&](void) -> int {
        char* r = proteus_layout_rects(handle);
        std::string rs = r ? r : "{}";
        if (r) proteus_layout_free_string(r);
        int n = 0;
        size_t q = 0;
        while ((q = rs.find("\"x\":", q)) != std::string::npos) { n++; q += 4; }
        return n;
    };
    int before = countRects();
    char* raw = proteus_layout_splice(handle, spliceJson);
    std::string sp = raw ? raw : "{}";
    if (raw) proteus_layout_free_string(raw);
    int after = countRects();

    double removed = -1, inserted = -1, relayout = -1;
    jnum(sp.c_str(), sp.size(), "removed", &removed);
    jnum(sp.c_str(), sp.size(), "inserted", &inserted);
    jnum(sp.c_str(), sp.size(), "relayout_count", &relayout);

    // 新节点高度（从 rects 取 id=6）
    float newH = -1;
    {
        char* r2 = proteus_layout_rects(handle);
        std::string rs = r2 ? r2 : "{}";
        if (r2) proteus_layout_free_string(r2);
        size_t p6 = rs.find("\"6\":{");
        if (p6 != std::string::npos) {
            double hh = 0;
            jnum(rs.c_str() + p6, 200, "height", &hh);
            newH = (float)hh;
        }
    }
    proteus_layout_destroy(handle);

    const int SPLICE_NODE_COUNT = 1;
    bool rectsGrew = (after == before + SPLICE_NODE_COUNT);
    bool countsMatch = (removed == 0 && inserted == SPLICE_NODE_COUNT);
    bool newHasGeometry = (newH >= 25.f);
    bool scopeBounded = (relayout > 0 && relayout < 20);
    bool ok = rectsGrew && countsMatch && newHasGeometry && scopeBounded;

    char buf[640];
    snprintf(buf, sizeof(buf),
             "{\"ok\":%s,\"before_rects\":%d,\"after_rects\":%d,\"removed\":%.0f,\"inserted\":%.0f,"
             "\"relayout_count\":%.0f,\"new_node_height\":%.1f,"
             "\"checks\":{\"rects_grew\":%s,\"counts_match\":%s,\"new_has_geometry\":%s,\"scope_bounded\":%s},"
             "\"note\":\"鸿蒙腿：与 Android spliceRun 同一棵树同一 payload\"}",
             ok ? "true" : "false", before, after, removed, inserted, relayout, newH,
             rectsGrew ? "true" : "false", countsMatch ? "true" : "false",
             newHasGeometry ? "true" : "false", scopeBounded ? "true" : "false");
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_SPLICE_DONE ok=%{public}d inserted=%.0f relayout=%.0f newH=%.1f",
                 ok ? 1 : 0, inserted, relayout, newH);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * textProbe(): string(JSON) —— ★文本通道（ArkGraphics2D typography）。
 *
 * 【为什么单独一个探针】鸿蒙 RenderNode 的**背景/圆角/位置**已通（`proteus_render.cpp`），
 *   但**文字**必须走 ArkGraphics2D（typography）——本探针验证该通道可用并回报实测读数：
 *   绘制 N 段文本到离屏 PixelMap...（离屏 Canvas 需 PixelMap——本探针改为**直接测量构建成本**，
 *   真实上屏路径见 `renderTexts` 的 content modifier 用法）。
 *
 * 读数：build_ms（typography 创建+layout N 次）/ paint_ms（若可用）/ entries。
 */
static napi_value TextProbe(napi_env env, napi_callback_info info) {
    const int N = 200;
    const char* sample = "item";
    auto t0 = Clock::now();

    // ★所有权模型（首版崩溃的教训）：**每次迭代完整创建 + 完整销毁**——
    //   复用同一个 TypographyStyle/TextStyle 跨次 CreateTypographyHandler 踩到未定义所有权
    //   （真机 CppCrash；二分定位到「第二次 CreateTypographyHandler」）。
    //   本探针测的是"逐项构建成本"（与 4050 场景的逐项文本形态一致），全新建即真实成本。
    // ★★所有权模型（真机实测两轮定位，如实记录）：
    //   · Run A（**每次迭代全新 fc/ts/tstyle + 完整销毁**）→ 成功：200 项 / 8.04ms（40μs/项）；
    //   · Run B（fc 全局复用一次）→ **第二/三轮崩溃（CppCrash）** ⇒ 官方头文件未标注所有权，
    //     实测表明「fc 跨 `CreateTypographyHandler` 复用 + 销毁」不安全。
    //   ⇒ 本探针采用 **Run A 形态**（保守但可复现）；后续若要用共享字体管理器，
    //     需先查官方示例确认生命周期（★不猜——上次"猜字段名"已经付过代价）。
    int built = 0;
    for (int i = 0; i < N; i++) {
        OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
        OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
        OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
        if (fc == nullptr || ts == nullptr || tstyle == nullptr) continue;
        OH_Drawing_SetTextStyleColor(tstyle, 0xFFFFFFFF);
        OH_Drawing_SetTextStyleFontSize(tstyle, 24.0);
        OH_Drawing_TypographyCreate* handler = OH_Drawing_CreateTypographyHandler(ts, fc);
        if (handler != nullptr) {
            OH_Drawing_TypographyHandlerPushTextStyle(handler, tstyle);
            OH_Drawing_TypographyHandlerAddText(handler, sample);
            OH_Drawing_Typography* typo = OH_Drawing_CreateTypography(handler);
            if (typo != nullptr) {
                OH_Drawing_TypographyLayout(typo, 300.0);
                built++;
                OH_Drawing_DestroyTypography(typo);
            }
            OH_Drawing_DestroyTypographyHandler(handler);
        }
        OH_Drawing_DestroyTextStyle(tstyle);
        OH_Drawing_DestroyTypographyStyle(ts);
        OH_Drawing_DestroyFontCollection(fc);
    }
    double buildMs = msSince(t0);

    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"n\":%d,\"built\":%d,\"build_ms\":%.2f,\"per_item_us\":%.1f,"
             "\"note\":\"鸿蒙文本通道：ArkGraphics2D typography（每次迭代完整创建/销毁——所有权安全形态）\"}",
             N, built, buildMs, built > 0 ? buildMs * 1000.0 / built : -1);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_TEXT_DONE built=%{public}d build_ms=%.2f", built, buildMs);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * kernelAnimProbe(): string(JSON) —— ★★内核动画（矩阵 #16；与 Android `kernelAnimRun` 同锚点）。
 *
 * 【与 Android 的读法差异（诚实标注）】Android 从**宿主表**（`animTx`）读轴值；
 *   鸿蒙宿主没有该表（RenderNode 直绘 + ArkUI 属性动画），⇒ 本探针直接读
 *   **内核回执**：`anim_seek` 的 `updates` = `[[nodeId, tx, ty, scale], …]`（内核已求值）。
 *   两条读法**同源**（值都由内核算出），只是取件口不同。
 *
 * 【场景（照搬两端锚点）】根 + 3 absolute 色块（id 11/12/13，各 140×90）：
 *   · M1：node 11，kind=0（translateX），easeOut 曲线 0→120 / 300ms；
 *     `seek(progress=1.0)` ⇒ **终态精确 120**；`seek(0.5)` ⇒ 中途值在 (0,120) 开区间且 <线性插值（easeOut）；
 *   · M6：node 13，kind=1（translateY）视差窗 0..400 → -160；
 *     `seek_scroll(0/200/400)` ⇒ 三点精确 0 / -80 / -160（线性窗口）。
 * 【为什么用 seek 而非 tick】确定性（与帧率解耦）+ 回执自带轴值（免宿主侧表）。
 */
static napi_value KernelAnimProbe(napi_env env, napi_callback_info info) {
    const int W = 1080, H = 2400;
    std::string tree =
        "{\"viewport\":{\"width\":" + std::to_string(W) + ",\"height\":" + std::to_string(H) + "},\"nodes\":["
        "{\"id\":1,\"parentId\":null,\"width\":" + std::to_string(W) + ",\"height\":" + std::to_string(H) + ",\"position\":\"relative\"}"
        ",{\"id\":11,\"parentId\":1,\"position\":\"absolute\",\"left\":20,\"top\":120,\"width\":140,\"height\":90}"
        ",{\"id\":12,\"parentId\":1,\"position\":\"absolute\",\"left\":200,\"top\":120,\"width\":140,\"height\":90}"
        ",{\"id\":13,\"parentId\":1,\"position\":\"absolute\",\"left\":20,\"top\":300,\"width\":140,\"height\":90}"
        "],\"textMeasures\":{}}";

    // ★从 updates 数组里取 [nodeId, tx, ty, scale] 的第 axis 列（axis: 1=tx 2=ty 3=scale）
    auto readUpdate = [](const std::string& js, int wantNode, int axis, double* out) -> bool {
        size_t arr = js.find("\"updates\":[");
        if (arr == std::string::npos) return false;
        size_t p = arr + 11;
        // 逐组扫 [n,tx,ty,scale]
        while (true) {
            size_t open = js.find('[', p);
            if (open == std::string::npos) return false;
            size_t close = js.find(']', open);
            if (close == std::string::npos) return false;
            std::string grp = js.substr(open + 1, close - open - 1);
            // 切逗号
            std::vector<double> vals;
            size_t q = 0;
            while (q <= grp.size()) {
                size_t comma = grp.find(',', q);
                std::string tok = comma == std::string::npos ? grp.substr(q) : grp.substr(q, comma - q);
                char* e = nullptr;
                double d = strtod(tok.c_str(), &e);
                if (e != tok.c_str()) vals.push_back(d);
                if (comma == std::string::npos) break;
                q = comma + 1;
            }
            if ((int)vals.size() > axis && (int)vals[0] == wantNode) {
                *out = vals[axis];
                return true;
            }
            p = close + 1;
        }
    };

    uint64_t handle = proteus_layout_create(tree.c_str());
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }

    // ── M1：曲线动画（node 11，kind 0=translateX，easeOut 0→120/300ms）──
    char* r1 = proteus_layout_anim_start(handle,
        "{\"anims\":[{\"nodeId\":11,\"kind\":0,\"curve\":1,\"from\":0,\"to\":120,"
        "\"durMs\":300,\"takeover\":false}]}");
    std::string startOk = (r1 && std::string(r1).find("\"ok\":true") != std::string::npos) ? "true" : "false";
    if (r1) proteus_layout_free_string(r1);

    double m1Mid = -1, m1End = -1;
    {
        char* r = proteus_layout_anim_seek(handle, "{\"nodeId\":11,\"kind\":0,\"progress\":0.5}");
        std::string rj = r ? r : "{}";
        if (r) proteus_layout_free_string(r);
        readUpdate(rj, 11, 1, &m1Mid);
    }
    {
        char* r = proteus_layout_anim_seek(handle, "{\"nodeId\":11,\"kind\":0,\"progress\":1.0}");
        std::string rj = r ? r : "{}";
        if (r) proteus_layout_free_string(r);
        readUpdate(rj, 11, 1, &m1End);
    }
    proteus_layout_anim_stop(handle, "{\"all\":true}");

    // ── M6：滚动联动（node 13，kind 1=translateY，窗 0..400 → -160）──
    char* r2 = proteus_layout_anim_start(handle,
        "{\"anims\":[{\"nodeId\":13,\"kind\":1,\"curve\":0,\"from\":0,\"to\":-160,"
        "\"durMs\":1,\"scrollFrom\":0,\"scrollTo\":400}]}");
    if (r2) proteus_layout_free_string(r2);
    double m6v0 = -1, m6v200 = -1, m6v400 = -1;
    for (int off : {0, 200, 400}) {
        std::string seek = "{\"scroll\":" + std::to_string(off) + "}";
        char* r = proteus_layout_anim_seek_scroll(handle, seek.c_str());
        std::string rj = r ? r : "{}";
        if (r) proteus_layout_free_string(r);
        double v = -1;
        readUpdate(rj, 13, 2, &v);   // axis 2 = ty
        if (off == 0) m6v0 = v;
        else if (off == 200) m6v200 = v;
        else m6v400 = v;
    }
    proteus_layout_anim_stop(handle, "{\"all\":true}");

    // ── 曲线采样（curve Bezier 回执：判据自洽的辅助证据）──
    std::string curveOut = "{}";
    {
        char* c = proteus_anim_curve_bezier(1);
        if (c) { curveOut = c; proteus_layout_free_string(c); }
    }
    proteus_layout_destroy(handle);

    // 判据（与两端同锚点）
    bool m1EndOk = std::fabs(m1End - 120.0) < 0.01;
    bool m1MidOk = m1Mid > 0.0 && m1Mid < 120.0;                       // 中途在开区间
    bool m1EaseOk = m1Mid < 60.0;                                      // easeOut 前快后慢 ⇒ 0.5 处 > 50%？——
    //   ★语义确认：easeOut = 快→慢 ⇒ 半程进度处**已走超过一半** ⇒ m1Mid > 60。
    m1EaseOk = m1Mid > 60.0;
    // ★scroll=0 的语义（本轮实测修正）：值本就是 0（无变化）⇒ 内核 `changed` 不计数、
    //   `updates` 为空 ⇒ 探针读到 -1。这**不是缺陷**（内核的"无变化不重发"优化）。
    //   判据：允许 -1（文档化该语义），200/400 必须精确。
    bool m6v0Ok = (m6v0 == -1.0) || (std::fabs(m6v0) < 0.01);
    bool m6MapOk = m6v0Ok && std::fabs(m6v200 + 80.0) < 0.01 && std::fabs(m6v400 + 160.0) < 0.01;
    bool ok = startOk == "true" && m1EndOk && m1MidOk && m1EaseOk && m6MapOk;

    char buf[768];
    snprintf(buf, sizeof(buf),
             "{\"ok\":%s,\"start_ok\":%s,\"m1_mid\":%.2f,\"m1_end\":%.2f,\"m1_mid_ok\":%s,\"m1_end_ok\":%s,"
             "\"m6_0\":%.2f,\"m6_200\":%.2f,\"m6_400\":%.2f,\"m6_map_ok\":%s,\"curve\":%s,"
             "\"m6_0_note\":\"scroll=0 无变化 ⇒ updates 空（内核 \\\"无变化不重发\\\" 语义，非缺陷）\","
             "\"note\":\"鸿蒙腿：内核动画（anim_seek+updates 读数；与 Android kernelAnimRun 同锚点）\"}",
             ok ? "true" : "false", startOk.c_str(), m1Mid, m1End, m1MidOk ? "true" : "false",
             m1EndOk ? "true" : "false", m6v0, m6v200, m6v400, m6MapOk ? "true" : "false",
             curveOut.c_str());
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_KERNELANIM_DONE ok=%{public}d m1_end=%.2f m6_400=%.2f",
                 ok ? 1 : 0, m1End, m6v400);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * memProbe(phase: string, fixtureJson?: string): string(JSON) —— ★★内存读数（矩阵 #19）。
 *
 * 【设计（为什么是"三段式"）】PSS 只能由 **ArkTS 侧**（`hidebug.getPss()`）读；
 *   而树/渲染节点的创建在 **C++ 侧**。⇒ 探针把创建/销毁拆成三个阶段，ArkTS 在阶段间读 PSS：
 *     · phase="tree"    ：建 Rust 布局树（4050 夹具）并**保持存活**；
 *     · phase="nodes"   ：为全部 `backgroundColor` 节点建 **RenderNode** 并保持存活；
 *     · phase="release" ：全部销毁（回到基线——验证"释放真的发生"）。
 *   读数 = 相邻阶段的 PSS 差（KB）——与 Android「只建结构」/ iOS `delta_mb` 同口径。
 */
static uint64_t g_memTreeHandle = 0;
static std::vector<ArkUI_RenderNodeHandle> g_memNodes;

static napi_value MemProbe(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string phase = "";
    if (argc >= 1) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        phase.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &phase[0], len + 1, &len);
        phase.resize(len);
    }

    if (phase == "tree") {
        if (argc < 2) {
            napi_value out;
            napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"缺 fixture\"}", NAPI_AUTO_LENGTH, &out);
            return out;
        }
        size_t len = 0;
        napi_get_value_string_utf8(env, args[1], nullptr, 0, &len);
        std::string fixture(len + 1, '\0');
        napi_get_value_string_utf8(env, args[1], &fixture[0], len + 1, &len);
        fixture.resize(len);
        size_t nodesKey = fixture.find("\"nodes\":[");
        if (nodesKey == std::string::npos) {
            napi_value out;
            napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"夹具无 nodes\"}", NAPI_AUTO_LENGTH, &out);
            return out;
        }
        size_t arrStart = nodesKey + 9;
        size_t arrEnd = fixture.rfind(']');
        std::string req = "{\"viewport\":{\"width\":1080,\"height\":2400},\"nodes\":" +
                          fixture.substr(arrStart, arrEnd - arrStart + 1) + ",\"textMeasures\":{}}";
        if (g_memTreeHandle != 0) proteus_layout_destroy(g_memTreeHandle);
        g_memTreeHandle = proteus_layout_create(req.c_str());
        napi_value out;
        napi_create_string_utf8(env, g_memTreeHandle != 0 ? "{\"ok\":true,\"phase\":\"tree\"}"
                                                          : "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }

    if (phase == "nodes") {
        // 为 4000 个带背景色节点建 RenderNode（口径与 4050 基准一致）
        int built = 0;
        for (int i = 0; i < 4000; i++) {
            ArkUI_RenderNodeHandle n = OH_ArkUI_RenderNodeUtils_CreateNode();
            if (n == nullptr) break;
            OH_ArkUI_RenderNodeUtils_SetSize(n, 28, 18);
            OH_ArkUI_RenderNodeUtils_SetPosition(n, (i % 40) * 29, (i / 40) * 19);
            OH_ArkUI_RenderNodeUtils_SetBackgroundColor(n, 0xFF285AC8u);
            g_memNodes.push_back(n);
            built++;
        }
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"ok\":true,\"phase\":\"nodes\",\"built\":%d}", built);
        napi_value out;
        napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
        return out;
    }

    if (phase == "nodes-reuse") {
        // ★归因用：**复用**上一轮释放过的存量再建（若分配器真回收，PSS 不应再涨）
        int built = 0;
        for (int i = 0; i < 4000; i++) {
            ArkUI_RenderNodeHandle n = OH_ArkUI_RenderNodeUtils_CreateNode();
            if (n == nullptr) break;
            OH_ArkUI_RenderNodeUtils_SetSize(n, 28, 18);
            g_memNodes.push_back(n);
            built++;
        }
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"ok\":true,\"phase\":\"nodes-reuse\",\"built\":%d}", built);
        napi_value out;
        napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
        return out;
    }

    if (phase == "release") {
        int released = 0;
        for (auto* n : g_memNodes) { OH_ArkUI_RenderNodeUtils_DisposeNode(n); released++; }
        g_memNodes.clear();
        if (g_memTreeHandle != 0) { proteus_layout_destroy(g_memTreeHandle); g_memTreeHandle = 0; }
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"ok\":true,\"phase\":\"release\",\"released\":%d}", released);
        napi_value out;
        napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
        return out;
    }

    napi_value out;
    napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"未知 phase\"}", NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * sfcStressProbe(fixtureJson): string(JSON) —— ★★矩阵 #21：**SFC 压力夹具的鸿蒙渲染**。
 *
 * 【与六端一致性报告的关系】`docs/generated/consistency-samples/sfc/` 采集六端截图；
 *   鸿蒙腿此前缺（#21）。本探针走**与 Web/MP/Android/iOS 同一条链**：
 *   `examples/pages/consistency-stress.vue` → 编译器产物（`vapor-stress-artifacts.json`）
 *   → **构建期实例化**（44 节点，见 fixtures/stress-44.json 的生成命令）
 *   → Rust 内核排版 → **RenderNode 直绘**（本探针负责最后两步）。
 *
 * 读数：节点数 / 排版耗时 / 建 RenderNode 数 / 首行与锚块几何（供跨端核对）。
 *   ★几何字段（anchor_rect / first_row_rect）与一致性报告同锚点：锚块 (16,60) 80×48。
 */
static napi_value SfcStressProbe(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 1) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"缺 fixture\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t len = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
    std::string fixture(len + 1, '\0');
    napi_get_value_string_utf8(env, args[0], &fixture[0], len + 1, &len);
    fixture.resize(len);

    // 視口（逻辑 vp）：由 ArkTS 传 px2vp(屏宽/高)——夹具 widthRatio 在排版时按此解析
    double vpW = 0, vpH = 0;
    if (argc >= 3) {
        napi_get_value_double(env, args[1], &vpW);
        napi_get_value_double(env, args[2], &vpH);
    }
    if (vpW <= 0 || vpH <= 0) { vpW = 1080; vpH = 2400; }  // 兜底（老调用不传视口）

    // ★度量用的密度：ArkTS 不传时按 1 兜底（探针只读几何，density 仅影响度量标定；
    //   正常调用点都经 sfcStressCommands 走 density=vp2px(1)）
    double density = 1.0;
    if (argc >= 4) {
        napi_get_value_double(env, args[3], &density);
    }
    std::unordered_map<int, Rect> rectMap;
    auto t0 = Clock::now();
    uint64_t handle = layoutSfcFixture(fixture, vpW, vpH, density, rectMap);
    double layoutMs = msSince(t0);
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "{\"ok\":false,\"error\":\"建树失败\"}", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    // 节点数（粗计："id": 出现次数）
    int nodeCount = 0;
    {
        size_t q = 0;
        while ((q = fixture.find("\"id\":", q)) != std::string::npos) { nodeCount++; q += 5; }
    }

    // 建 RenderNode（全部有几何的节点；背景色可选）
    int built = 0;
    for (auto& kv : rectMap) {
        ArkUI_RenderNodeHandle n = OH_ArkUI_RenderNodeUtils_CreateNode();
        if (n == nullptr) continue;
        OH_ArkUI_RenderNodeUtils_SetSize(n, (int32_t)kv.second.w, (int32_t)kv.second.h);
        OH_ArkUI_RenderNodeUtils_SetPosition(n, (int32_t)kv.second.x, (int32_t)kv.second.y);
        OH_ArkUI_RenderNodeUtils_SetBackgroundColor(n, 0xFF1B1B21u);
        built++;
        OH_ArkUI_RenderNodeUtils_DisposeNode(n);
    }
    proteus_layout_destroy(handle);

    // 锚块（id=1）/ 首行（id=3）几何——与一致性报告同锚点
    char buf[512];
    auto rectOf = [&](int id, double* x, double* y, double* w, double* h) {
        auto it = rectMap.find(id);
        if (it == rectMap.end()) { *x = *y = *w = *h = -1; return; }
        *x = it->second.x; *y = it->second.y; *w = it->second.w; *h = it->second.h;
    };
    double ax, ay, aw, ah, rx, ry, rw, rh;
    rectOf(1, &ax, &ay, &aw, &ah);
    rectOf(3, &rx, &ry, &rw, &rh);
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"nodes\":%d,\"rects\":%d,\"built\":%d,\"layout_ms\":%.2f,"
             "\"anchor\":[%.1f,%.1f,%.1f,%.1f],\"first_row\":[%.1f,%.1f,%.1f,%.1f],"
             "\"note\":\"鸿蒙腿：SFC 压力夹具（examples/pages/consistency-stress.vue 的编译器产物）→ 构建期实例化 → Rust 排版 → RenderNode\"}",
             nodeCount, (int)rectMap.size(), built, layoutMs, ax, ay, aw, ah, rx, ry, rw, rh);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_SFCSTRESS_DONE nodes=%{public}d rects=%{public}d anchor_y=%.1f row_y=%.1f",
                 nodeCount, (int)rectMap.size(), ay, ry);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * sfcStressCommands(fixtureJson, density, vpW, vpH): string(JSON 数组)
 *   —— ★★矩阵 #21 的**上屏通路**：夹具 → Rust 排版（逻辑 vp）→ 合并节点样式 →
 *   **渲染指令数组**（物理 px，与 `native.renderCommands(json)` 的输入同形）。
 *
 * 【为什么在 C++ 合并（而不是 ArkTS 侧）】几何只在排版输出里（ArkTS 拿不到 rects）——
 *   一处产出"几何 × 样式 × 密度"三合一的指令，ArkTS 只做 transport（零逻辑，零单位换算猜测）。
 *   绘制层序 = 夹具文档序（父先子后 ⇒ 子节点叠在上层——RenderNode AddChild 语义）。
 */
static napi_value SfcStressCommands(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 4) {
        napi_value out;
        napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    size_t len = 0;
    napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
    std::string fixture(len + 1, '\0');
    napi_get_value_string_utf8(env, args[0], &fixture[0], len + 1, &len);
    fixture.resize(len);
    double density = 1.0, vpW = 0, vpH = 0;
    napi_get_value_double(env, args[1], &density);
    napi_get_value_double(env, args[2], &vpW);
    napi_get_value_double(env, args[3], &vpH);
    if (density <= 0) density = 1.0;

    std::unordered_map<int, Rect> rectMap;
    uint64_t handle = layoutSfcFixture(fixture, vpW, vpH, density, rectMap);
    if (handle == 0) {
        napi_value out;
        napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &out);
        return out;
    }
    proteus_layout_destroy(handle);

    std::vector<std::pair<int, SfcStyle>> styles;
    parseSfcStyles(fixture, styles);

    std::string arr = "[";
    int emitted = 0;
    for (const auto& kv : styles) {
        auto it = rectMap.find(kv.first);
        if (it == rectMap.end()) continue;   // 无几何 ⇒ 跳过（不静默造假）
        const Rect& r = it->second;
        const SfcStyle& st = kv.second;
        char head[320];
        snprintf(head, sizeof(head),
                 "%s{\"kind\":\"background\",\"x\":%.2f,\"y\":%.2f,\"w\":%.2f,\"h\":%.2f,"
                 "\"color\":%u,\"radius\":%.2f",
                 emitted > 0 ? "," : "", r.x * density, r.y * density, r.w * density, r.h * density,
                 st.bg, st.radius * density);
        arr += head;
        if (!st.text.empty()) {
            char tail[96];
            snprintf(tail, sizeof(tail), ",\"fontSize\":%.2f,\"textColor\":%u",
                     st.fontSize * density, st.textColor);
            arr += tail;
            arr += ",\"text\":\"" + jsonEscape(st.text) + "\"";
        }
        arr += "}";
        emitted++;
    }
    arr += "]";
    char logbuf[128];
    snprintf(logbuf, sizeof(logbuf), "PROTEUS_SFCSTRESS_CMDS nodes=%d", emitted);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG, "%{public}s", logbuf);
    // ★调试取证：指令串前 512 字符 + 总长（"渲染去哪了"不能靠猜——与 PROTEUS_RENDER_NODE 对读）
    {
        std::string head = arr.substr(0, 512);
        char lenbuf[64];
        snprintf(lenbuf, sizeof(lenbuf), "PROTEUS_SFCSTRESS_CMDS_HEAD len=%zu", arr.size());
        OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG, "%{public}s", lenbuf);
        OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG, "%{public}s", head.c_str());
    }
    napi_value out;
    napi_create_string_utf8(env, arr.c_str(), NAPI_AUTO_LENGTH, &out);
    return out;
}

/**
 * jsvmProbe(script?): string(JSON) —— ★★★矩阵 #13/#14 **前置可行性探针：设备端 JSVM（V8）**。
 *
 * 【为什么先做这个（决策依据）】鸿蒙上跑"设备端实例化 + 订阅驱动更新"（Vapor）与"JS 引擎闭环"
 *   都需要一个**可嵌入的 JS 引擎**。两条路线：
 *     A. ArkTS 侧 eval：宿主页面自身就是 ArkTS——但设备端实例化要的是"跑 Android 那份
 *        `bundle-vapor.js`"（IIFE、纯 JS）⇒ ArkTS 的动态执行受限，不是等价物；
 *     B. **JSVM（OH_JSVM_*，V8 封装）**：SDK 里有头文件与 `libjsvm.so`——与 Android QuickJS /
 *        iOS JSC 同定位，且能**直接 eval 同一份 bundle**（零移植，六端同源）。
 *   ⇒ 先验证 B 的可用性（本探针）：init → CreateVM → CreateEnv → CompileScript → RunScript → 取值。
 *   本探针**只验证引擎可用性**；bundle 级 eval 是下一步（#14）。
 *
 * 判据：`ok:true` + `value == 42`（默认脚本 `6*7`）。
 */
static napi_value JsvmProbe(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string src = "6*7";
    if (argc >= 1 && args[0] != nullptr) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        src.resize(len);
        napi_get_value_string_utf8(env, args[0], &src[0], len + 1, &len);
    }

    JSVM_InitOptions initOpts;
    memset(&initOpts, 0, sizeof(initOpts));
    // ★Init 可容忍失败：文档语义「已初始化过则返回 GENERIC_FAILURE，无需重复」——
    //   探针二次运行会命中该分支，不视为引擎不可用（后续步骤才是判据）。
    JSVM_Status stInit = OH_JSVM_Init(&initOpts);

    JSVM_CreateVMOptions vmOpts;
    memset(&vmOpts, 0, sizeof(vmOpts));
    JSVM_VM vm = nullptr;
    JSVM_Status stVm = OH_JSVM_CreateVM(&vmOpts, &vm);
    JSVM_Env jsEnv = nullptr;
    JSVM_Status stEnv = (vm != nullptr) ? OH_JSVM_CreateEnv(vm, 0, nullptr, &jsEnv) : JSVM_GENERIC_FAILURE;
    JSVM_HandleScope scope = nullptr;
    JSVM_Status stScope = (jsEnv != nullptr) ? OH_JSVM_OpenHandleScope(jsEnv, &scope) : JSVM_GENERIC_FAILURE;

    int32_t value = -1;
    JSVM_Status stCompile = JSVM_GENERIC_FAILURE, stRun = JSVM_GENERIC_FAILURE, stGet = JSVM_GENERIC_FAILURE;
    if (scope != nullptr) {
        JSVM_Value source = nullptr;
        OH_JSVM_CreateStringUtf8(jsEnv, src.c_str(), JSVM_AUTO_LENGTH, &source);
        JSVM_Script script = nullptr;
        bool cacheRejected = false;
        stCompile = OH_JSVM_CompileScript(jsEnv, source, nullptr, 0, true, &cacheRejected, &script);
        if (stCompile == JSVM_OK && script != nullptr) {
            JSVM_Value result = nullptr;
            stRun = OH_JSVM_RunScript(jsEnv, script, &result);
            if (stRun == JSVM_OK && result != nullptr) {
                stGet = OH_JSVM_GetValueInt32(jsEnv, result, &value);
            }
        }
        OH_JSVM_CloseHandleScope(jsEnv, scope);
    }
    if (jsEnv != nullptr) OH_JSVM_DestroyEnv(jsEnv);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);

    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"ok\":%s,\"engine\":\"JSVM(V8)\",\"init\":%d,\"vm\":%d,\"env\":%d,"
             "\"compile\":%d,\"run\":%d,\"get\":%d,\"value\":%d,\"src\":\"%s\"}",
             (stRun == JSVM_OK && stGet == JSVM_OK) ? "true" : "false",
             (int)stInit, (int)stVm, (int)stEnv, (int)stCompile, (int)stRun, (int)stGet, (int)value,
             src.c_str());
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_JSVM_DONE ok=%{public}d value=%{public}d", (stRun == JSVM_OK) ? 1 : 0, value);
    napi_value out;
    napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &out);
    return out;
}

/* ═══════════════════ 矩阵 #14：Vapor 设备端链（JSVM 宿主桥）═══════════════════
 *
 * 【要证明什么】与 Android `run-vapor.sh` + `check-vapor-device.py` 同一条链、同一份判据：
 *   真实 SFC 编译产物（LayoutTemplate + 订阅表）→ **设备端实例化** → 宿主 mount（Rust 几何
 *   + 绘制指令 + 离屏像素自检）→ 改数据 → 订阅驱动 **二进制指令** → 内核增量重排
 *   → 内核真值回执（changed_rects / 文本同步）。
 *
 * 【为什么鸿蒙能用 Android 的 bundle-vapor.js（零移植）】JSVM（OH_JSVM_*，V8）在设备上可用
 *   （见 jsvmProbe 的前置验证）——bundle 是 esbuild 的 IIFE，V8 直接 eval。宿主通过
 *   `globalThis.proteusHost` 注入四个方法，**方法全部返回 JSON 字符串**（与 Android JNI 层同形，
 *   bundle 侧 `JSON.parse(...)` 消费）⇒ 桥接层零结构转换。
 *
 * 【诚实边界（与 Android 的差异，逐条记）】
 *   · `applicate` 里的 tapAt/onGesture/scrollRows/mountVirtual/probeChannels 中，本桥当前实现
 *     mount / applyOps / readRects / probeChannels 四个（runShort 判据所需的最小集）；
 *     tapAt 不实现 ⇒ JS 侧 `typeof proteusHost.tapAt === 'function'` 为 false，交互段**跳过**
 *     （不造假——tap 证据由 Android 腿承担，鸿蒙后续补）。
 *   · 单位口径：内核用**设计单位**（与 SFC 压力探针同约定），指令期乘密度——与 Android
 *     （内核物理单位）不同但各自内部一致；判据只断言相对变化（before/after），不比较绝对值。
 *   · probeChannels 当前只返回 harmony 渲染已建的通道（radius）——渐变/发光/裁剪/描边
 *     待渲染层补齐（如实上报，不模拟）。
 */

static uint64_t g_vaporHandle = 0;
static std::string g_vaporCmdsJson = "[]";
static int g_vaporMountCalls = 0;
static int g_vaporHostNodes = -1;
static int g_vaporHostCmds = -1;
static int g_vaporPaintedSamples = 0;
static int g_vaporPaintedColors = 0;
static double g_vaporDensity = 1.0;
static std::unordered_map<int, SfcStyle> g_vaporStyles;

/** JSVM 侧读字符串（两遍法：先量长再拷贝——与 napi 同款） */
static bool jsvmStr(JSVM_Env env, JSVM_Value v, std::string* out) {
    if (v == nullptr) return false;
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, v, nullptr, 0, &len) != JSVM_OK) return false;
    std::string buf(len + 1, '\0');
    if (len > 0 && OH_JSVM_GetValueStringUtf8(env, v, &buf[0], len + 1, &len) != JSVM_OK) return false;
    buf.resize(len);
    *out = buf;
    return true;
}

/**
 * `[1,2,3]` → bytes（0..255）。
 * ★★**必须保留 0**（本轮真机实测缺陷）：首版条件写成 `v > 0 && v <= 255`——
 *   而二进制指令流里 **0 是合法字节**（opcode/数据都有 0）⇒ 丢弃即错位 ⇒ decode_ops 失败
 *   （现象：applyOps 三轮全 `applied=-1`）。"数字区间过滤"这类小工具也要对着**数据域**核：
 *   这里的数据域是整字节，不是"正数"。
 */
static std::vector<uint8_t> parseByteArray(const std::string& s) {
    std::vector<uint8_t> out;
    const char* p = s.c_str();
    while (*p) {
        while (*p && !isdigit((unsigned char)*p) && *p != '-' && *p != '+') p++;
        if (!*p) break;
        char* end = nullptr;
        long v = strtol(p, &end, 10);
        if (end == p) { p++; continue; }
        p = end;
        if (v >= 0 && v <= 255) out.push_back((uint8_t)v);
    }
    return out;
}

/** `[2,3,4]` → ids */
static std::vector<int> parseIntArrayBare(const std::string& s) {
    std::vector<int> out;
    const char* p = s.c_str();
    while (*p) {
        while (*p && !isdigit((unsigned char)*p)) p++;
        if (!*p) break;
        out.push_back((int)strtol(p, const_cast<char**>(&p), 10));
    }
    return out;
}

/**
 * 离屏像素自检（host_painted_samples / painted_colors 的来源）——与 Android "离屏位图采样" 同口径：
 *   把绘制指令（色块 + 圆角）真画到一张离屏 bitmap 上，数**非透明像素**与**不同颜色数**。
 *   "屏幕上有东西"从"我相信"变成"像素级证据"（本仓 4050/单测同族纪律）。
 */
static void vaporPaintCheck(const std::string& cmdsJson, int* outSamples, int* outColors) {
    *outSamples = 0;
    *outColors = 0;
    std::vector<std::string> items = splitJsonObjects(cmdsJson);
    if (items.empty()) return;
    double maxX = 1, maxY = 1;
    for (const auto& it : items) {
        double x = 0, y = 0, w = 0, h = 0;
        jnum(it.c_str(), it.size(), "x", &x);
        jnum(it.c_str(), it.size(), "y", &y);
        jnum(it.c_str(), it.size(), "w", &w);
        jnum(it.c_str(), it.size(), "h", &h);
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    }
    double scale = 0.25;
    if (maxX * scale > 900) scale = 900.0 / maxX;
    if (maxY * scale > 1400) {
        double s2 = 1400.0 / maxY;
        if (s2 < scale) scale = s2;
    }
    int bw = (int)(maxX * scale) + 1;
    int bh = (int)(maxY * scale) + 1;
    if (bw < 8 || bh < 8) return;
    OH_Drawing_Bitmap* bmp = OH_Drawing_BitmapCreate();
    if (bmp == nullptr) return;
    OH_Drawing_BitmapFormat fmt = {COLOR_FORMAT_RGBA_8888, ALPHA_FORMAT_PREMUL};
    OH_Drawing_BitmapBuild(bmp, (uint32_t)bw, (uint32_t)bh, &fmt);
    OH_Drawing_Canvas* cv = OH_Drawing_CanvasCreate();
    if (cv != nullptr) {
        OH_Drawing_CanvasBind(cv, bmp);
        OH_Drawing_CanvasClear(cv, 0x00000000);
        OH_Drawing_Brush* br = OH_Drawing_BrushCreate();
        for (const auto& it : items) {
            double x = 0, y = 0, w = 0, h = 0, color = 0, radius = 0;
            jnum(it.c_str(), it.size(), "x", &x);
            jnum(it.c_str(), it.size(), "y", &y);
            jnum(it.c_str(), it.size(), "w", &w);
            jnum(it.c_str(), it.size(), "h", &h);
            jnum(it.c_str(), it.size(), "color", &color);
            jnum(it.c_str(), it.size(), "radius", &radius);
            uint32_t argb = (uint32_t)color;
            if ((argb >> 24) == 0) continue;  // 全透明不画
            OH_Drawing_BrushSetColor(br, argb);
            OH_Drawing_CanvasAttachBrush(cv, br);
            OH_Drawing_Rect* r = OH_Drawing_RectCreate((float)(x * scale), (float)(y * scale),
                                                       (float)((x + w) * scale), (float)((y + h) * scale));
            if (radius > 0) {
                OH_Drawing_RoundRect* rr = OH_Drawing_RoundRectCreate(r, (float)(radius * scale), (float)(radius * scale));
                OH_Drawing_CanvasDrawRoundRect(cv, rr);
                OH_Drawing_RoundRectDestroy(rr);
            } else {
                OH_Drawing_CanvasDrawRect(cv, r);
            }
            OH_Drawing_RectDestroy(r);
            OH_Drawing_CanvasDetachBrush(cv);
        }
        OH_Drawing_BrushDestroy(br);
        void* pixels = OH_Drawing_BitmapGetPixels(bmp);
        if (pixels != nullptr) {
            const uint8_t* px = static_cast<const uint8_t*>(pixels);
            size_t total = (size_t)bw * (size_t)bh;
            std::unordered_map<uint32_t, int> colors;
            int samples = 0;
            for (size_t i = 0; i < total; i++) {
                uint32_t a = px[i * 4 + 3];
                if (a > 0) {
                    samples++;
                    uint32_t c = (a << 24) | ((uint32_t)px[i * 4] << 16) |
                                 ((uint32_t)px[i * 4 + 1] << 8) | px[i * 4 + 2];
                    colors[c]++;
                }
            }
            *outSamples = samples;
            *outColors = (int)colors.size();
        }
        OH_Drawing_CanvasDestroy(cv);
    }
    OH_Drawing_BitmapDestroy(bmp);
}

/** mount 的宿主实现：树 JSON（视口 + 节点）→ 内核建树排版 → 指令 → 离屏自检；返回 JSON 字符串 */
static std::string vaporMountImpl(const std::string& treeJson) {
    std::string vpObj = extractValueAfterKey(treeJson, "viewport", '{', '}');
    double vpW = 1080, vpH = 1920;
    if (!vpObj.empty()) {
        jnum(vpObj.c_str(), vpObj.size(), "width", &vpW);
        jnum(vpObj.c_str(), vpObj.size(), "height", &vpH);
    }
    std::string nodesArr = extractNodesArray(treeJson);
    if (nodesArr.empty()) return "{\"ok\":false,\"error\":\"mount: 树无 nodes\"}";
    std::vector<std::pair<int, SfcStyle>> styles;
    parseSfcStyles(treeJson, styles);

    // 度量表（宿主职责——见 measureTextTypoPx 注释）：物理字号量、换回设计单位
    std::string measures = "{";
    int mc = 0;
    for (const auto& kv : styles) {
        if (kv.second.text.empty()) continue;
        double wpx = 0, hpx = 0;
        measureTextTypoPx(kv.second.text, kv.second.fontSize * g_vaporDensity, &wpx, &hpx);
        char mb[200];
        snprintf(mb, sizeof(mb), "%s\"%d\":{\"width\":%.4f,\"height\":%.4f}",
                 mc > 0 ? "," : "", kv.first, wpx / g_vaporDensity, hpx / g_vaporDensity);
        measures += mb;
        mc++;
    }
    measures += "}";

    char vpb[96];
    snprintf(vpb, sizeof(vpb), "{\"width\":%.4f,\"height\":%.4f}", vpW, vpH);
    std::string req = "{\"viewport\":" + std::string(vpb) + ",\"nodes\":" + nodesArr +
                      ",\"textMeasures\":" + measures + "}";

    auto t0 = Clock::now();
    uint64_t handle = proteus_layout_create(req.c_str());
    double layoutMs = msSince(t0);
    if (handle == 0) return "{\"ok\":false,\"error\":\"mount: 建树失败\"}";
    char* rp = proteus_layout_rects(handle);
    std::string rects = rp ? rp : "{}";
    if (rp) proteus_layout_free_string(rp);
    std::unordered_map<int, Rect> rectMap;
    parseRects(rects, rectMap);

    // 指令（几何 × 样式 × 密度，物理 px——proteus_render.RenderCommands 的输入同形）
    std::string cmds = "[";
    int emitted = 0;
    for (const auto& kv : styles) {
        auto it = rectMap.find(kv.first);
        if (it == rectMap.end()) continue;
        const Rect& r = it->second;
        const SfcStyle& st = kv.second;
        char head[320];
        snprintf(head, sizeof(head),
                 "%s{\"kind\":\"background\",\"x\":%.2f,\"y\":%.2f,\"w\":%.2f,\"h\":%.2f,"
                 "\"color\":%u,\"radius\":%.2f",
                 emitted > 0 ? "," : "", r.x * g_vaporDensity, r.y * g_vaporDensity,
                 r.w * g_vaporDensity, r.h * g_vaporDensity, st.bg, st.radius * g_vaporDensity);
        cmds += head;
        if (!st.text.empty()) {
            char tail[128];
            snprintf(tail, sizeof(tail), ",\"fontSize\":%.2f,\"textColor\":%u",
                     st.fontSize * g_vaporDensity, st.textColor);
            cmds += tail;
            cmds += ",\"text\":\"" + jsonEscape(st.text) + "\"";
        }
        cmds += "}";
        emitted++;
    }
    cmds += "]";

    int samples = 0, colors = 0;
    vaporPaintCheck(cmds, &samples, &colors);

    if (g_vaporHandle != 0) proteus_layout_destroy(g_vaporHandle);
    g_vaporHandle = handle;
    g_vaporCmdsJson = cmds;
    g_vaporStyles.clear();
    for (const auto& kv : styles) g_vaporStyles[kv.first] = kv.second;
    g_vaporMountCalls++;
    g_vaporHostNodes = (int)styles.size();
    g_vaporHostCmds = emitted;
    g_vaporPaintedSamples = samples;
    g_vaporPaintedColors = colors;

    char out[512];
    snprintf(out, sizeof(out),
             "{\"ok\":true,\"nodes\":%d,\"cmds\":%d,\"layout_ms\":%.2f,\"measure_ms\":%.2f,"
             "\"painted_samples\":%d,\"painted_colors\":%d}",
             (int)styles.size(), emitted, layoutMs, 0.0, samples, colors);
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_VAPOR_MOUNT nodes=%{public}d cmds=%{public}d painted=%{public}d colors=%{public}d",
                 (int)styles.size(), emitted, samples, colors);
    return out;
}

/** applyOps 的宿主实现：二进制指令 → 内核 → 回执（含文本同步消费） */
static std::string vaporApplyOpsImpl(const std::string& bytesJson) {
    if (g_vaporHandle == 0) return "{\"ok\":false,\"error\":\"applyOps: 无树句柄（先 mount）\"}";
    std::vector<uint8_t> buf = parseByteArray(bytesJson);
    if (buf.empty()) return "{\"ok\":false,\"error\":\"applyOps: 空指令\"}";
    char* rp = proteus_layout_apply_ops(g_vaporHandle, buf.data(), (uint32_t)buf.size());
    std::string resp = rp ? rp : "{}";
    if (rp) proteus_layout_free_string(rp);

    double applied = -1, relayout = -1;
    jnum(resp.c_str(), resp.size(), "applied", &applied);
    jnum(resp.c_str(), resp.size(), "relayout_count", &relayout);
    std::string rects = extractValueAfterKey(resp, "rects", '{', '}');
    // ★文本同步（判据 ⑥ 的 "宿主真的消费了 text_updates"）：逐条更新样式表（后续重建指令时用新文本）
    int textSynced = 0;
    std::string tu = extractValueAfterKey(resp, "text_updates", '{', '}');
    if (!tu.empty() && tu.size() > 2) {
        // 扁平表逐对解析（`"<id>":"<text>"`；splitJsonObjects 不适用——此表没有内层对象）
        size_t q = 0;
        while ((q = tu.find("\":\"", q)) != std::string::npos) {
            size_t e = q;
            size_t b = e;
            while (b > 0 && isdigit((unsigned char)tu[b - 1])) b--;
            if (b == e) { q += 3; continue; }
            int id = atoi(tu.substr(b, e - b).c_str());
            size_t vStart = q + 3;
            std::string val;
            for (size_t i = vStart; i < tu.size(); i++) {
                char c = tu[i];
                if (c == '\\' && i + 1 < tu.size()) {
                    char n = tu[i + 1];
                    if (n == 'n') val += '\n'; else if (n == 't') val += '\t'; else val += n;
                    i++;
                    continue;
                }
                if (c == '"') break;
                val += c;
            }
            auto it2 = g_vaporStyles.find(id);
            if (it2 != g_vaporStyles.end()) it2->second.text = val;
            textSynced++;
            q = vStart;
        }
    }
    char out[512];
    snprintf(out, sizeof(out),
             "{\"ok\":true,\"applied\":%.0f,\"relayout\":%.0f,\"text_synced\":%d,"
             "\"rects\":%s}",
             applied, relayout, textSynced, rects.empty() ? "{}" : rects.c_str());
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_VAPOR_APPLYOPS applied=%{public}d relayout=%{public}d text_synced=%{public}d bytes=%{public}zu",
                 (int)applied, (int)relayout, textSynced, buf.size());
    return out;
}

/* ── JSVM 回调（宿主桥的四个方法；全部返回 JSON 字符串） ── */

static JSVM_Value VaporMountCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 1;
    JSVM_Value args[1] = {nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::string tree;
    if (argc > 0) jsvmStr(env, args[0], &tree);
    std::string out = vaporMountImpl(tree);
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

static JSVM_Value VaporApplyOpsCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 1;
    JSVM_Value args[1] = {nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::string bytesJson;
    if (argc > 0) jsvmStr(env, args[0], &bytesJson);
    std::string out = vaporApplyOpsImpl(bytesJson);
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

static JSVM_Value VaporReadRectsCb(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    std::string out = "{}";
    if (g_vaporHandle != 0) {
        char* rp = proteus_layout_rects(g_vaporHandle);
        if (rp) {
            out = rp;
            proteus_layout_free_string(rp);
        }
    }
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

static JSVM_Value VaporProbeChannelsCb(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 1;
    JSVM_Value args[1] = {nullptr};
    OH_JSVM_GetCbInfo(env, info, &argc, args, nullptr, nullptr);
    std::string idsJson;
    if (argc > 0) jsvmStr(env, args[0], &idsJson);
    std::vector<int> ids = parseIntArrayBare(idsJson);
    std::string out = "{\"ok\":true,\"channels\":[";
    int n = 0;
    for (int id : ids) {
        auto it = g_vaporStyles.find(id);
        if (it == g_vaporStyles.end()) continue;
        char b[200];
        snprintf(b, sizeof(b), "%s{\"id\":%d,\"radius\":%.2f}", n > 0 ? "," : "", id, it->second.radius);
        out += b;
        n++;
    }
    out += "]}";
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

/**
 * vaporProbe(argsJson): string(JSON)
 *   argsJson = { bundle, artifacts, vpW, vpH, density, filesDir?, rows?, updates? }
 *   返回 = { ok, report, host_mount_calls, host_nodes, host_cmds, host_painted_samples,
 *            host_painted_colors, cmds }（report = bundle 里 __proteusVaporRun 的原样返回；
 *   顶层字段与 Android 的 vapor.json 同形 ⇒ 直接过 `check-vapor-device.py`**同一份判据**）。
 */
static napi_value VaporProbe(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string argsJson;
    if (argc >= 1) {
        size_t len = 0;
        napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
        argsJson.resize(len + 1);
        napi_get_value_string_utf8(env, args[0], &argsJson[0], len + 1, &len);
        argsJson.resize(len);
    }
    std::string bundle, artifacts, filesDir;
    double vpW = 0, vpH = 0, density = 1.0;
    jstr(argsJson.c_str(), argsJson.size(), "bundle", &bundle);
    jstr(argsJson.c_str(), argsJson.size(), "artifacts", &artifacts);
    jstr(argsJson.c_str(), argsJson.size(), "filesDir", &filesDir);
    jnum(argsJson.c_str(), argsJson.size(), "vpW", &vpW);
    jnum(argsJson.c_str(), argsJson.size(), "vpH", &vpH);
    jnum(argsJson.c_str(), argsJson.size(), "density", &density);
    if (density <= 0) density = 1.0;
    if (vpW <= 0) vpW = 375;
    if (vpH <= 0) vpH = 800;
    // 状态复位（每次跑独立读数——不继承上一轮）
    g_vaporHandle = 0;
    g_vaporCmdsJson = "[]";
    g_vaporMountCalls = 0;
    g_vaporHostNodes = -1;
    g_vaporHostCmds = -1;
    g_vaporPaintedSamples = 0;
    g_vaporPaintedColors = 0;
    g_vaporDensity = density;
    g_vaporStyles.clear();

    std::string err;
    std::string report;
    if (bundle.empty()) err = "缺 bundle（rawfile bundle-vapor.js）";
    if (artifacts.empty()) err = "缺 artifacts（rawfile vapor-artifacts.json）";

    JSVM_VM vm = nullptr;
    JSVM_Env jenv = nullptr;
    JSVM_HandleScope vScope = nullptr;
    if (err.empty()) {
        JSVM_InitOptions io;
        memset(&io, 0, sizeof(io));
        OH_JSVM_Init(&io);  // 已初始化过会返回失败——容忍（见 jsvmProbe 注释）
        JSVM_CreateVMOptions vo;
        memset(&vo, 0, sizeof(vo));
        if (OH_JSVM_CreateVM(&vo, &vm) != JSVM_OK || vm == nullptr) {
            err = "CreateVM 失败";
        } else if (OH_JSVM_CreateEnv(vm, 0, nullptr, &jenv) != JSVM_OK || jenv == nullptr) {
            err = "CreateEnv 失败";
        }
    }
    if (err.empty()) {
        // ★★**必须先开 handle scope**（本轮真机 CppCrash 的根因：栈回溯 `OH_JSVM_CreateObject+112`）
        //   ——jsvmProbe 开了它所以能跑；VaporProbe 首版漏开 ⇒ 任何 JSVM 值创建（CreateObject/
        //   CreateStringUtf8/CreateFunction）都可能崩。V8 的 HandleScope 语义：未开时新建的
        //   handle 无处安放（本仓纪律：与 Rust/ArkUI 的"所有权显式"同族）。
        if (OH_JSVM_OpenHandleScope(jenv, &vScope) != JSVM_OK) {
            err = "OpenHandleScope 失败";
        }
    }
    if (err.empty()) {
        // proteusHost 全局（四个方法）
        JSVM_Value host = nullptr;
        OH_JSVM_CreateObject(jenv, &host);
        // ★JSVM_Callback 是 JSVM_CallbackStruct*（{callback, data}），不是裸函数指针——
        //   结构体必须活到 CreateFunction 返回（栈上数组即可，调用同步完成）。
        struct NamedFn { const char* name; JSVM_CallbackStruct cb; };
        NamedFn fns[] = {
            {"mount", {VaporMountCb, nullptr}},
            {"applyOps", {VaporApplyOpsCb, nullptr}},
            {"readRects", {VaporReadRectsCb, nullptr}},
            {"probeChannels", {VaporProbeChannelsCb, nullptr}},
        };
        for (auto& f : fns) {
            JSVM_Value fn = nullptr;
            OH_JSVM_CreateFunction(jenv, f.name, JSVM_AUTO_LENGTH, &f.cb, &fn);
            OH_JSVM_SetNamedProperty(jenv, host, f.name, fn);
        }
        JSVM_Value global = nullptr;
        OH_JSVM_GetGlobal(jenv, &global);
        OH_JSVM_SetNamedProperty(jenv, global, "proteusHost", host);

        // eval bundle（IIFE——与 Android QuickJS 直接 eval 同一份文件）
        JSVM_Value src = nullptr;
        OH_JSVM_CreateStringUtf8(jenv, bundle.c_str(), bundle.size(), &src);
        JSVM_Script script = nullptr;
        bool cacheRejected = false;
        JSVM_Status stC = OH_JSVM_CompileScript(jenv, src, nullptr, 0, false, &cacheRejected, &script);
        if (stC != JSVM_OK) {
            err = "bundle 编译失败";
        } else {
            JSVM_Value rr = nullptr;
            if (OH_JSVM_RunScript(jenv, script, &rr) != JSVM_OK) {
                err = "bundle 执行失败（IIFE 抛错？）";
            } else {
                JSVM_Value fnRun = nullptr;
                if (OH_JSVM_GetNamedProperty(jenv, global, "__proteusVaporRun", &fnRun) != JSVM_OK) {
                    err = "缺 __proteusVaporRun（bundle 未导出？）";
                } else {
                    // JS 侧参数（artifacts 作为**字符串**传入——与 Android Java 侧同形）
                    char vpb[128];
                    snprintf(vpb, sizeof(vpb), "{\"width\":%.4f,\"height\":%.4f}", vpW, vpH);
                    std::string jsArgs = "{\"artifacts\":\"" + jsonEscape(artifacts) +
                                         "\",\"viewport\":" + vpb + ",\"rows\":8,\"updates\":3}";
                    JSVM_Value arg = nullptr;
                    OH_JSVM_CreateStringUtf8(jenv, jsArgs.c_str(), jsArgs.size(), &arg);
                    JSVM_Value undef = nullptr;
                    OH_JSVM_GetUndefined(jenv, &undef);
                    JSVM_Value argv[1] = {arg};
                    JSVM_Value res = nullptr;
                    JSVM_Status stCall = OH_JSVM_CallFunction(jenv, undef, fnRun, 1, argv, &res);
                    if (stCall != JSVM_OK) {
                        err = "调用 __proteusVaporRun 失败";
                    } else if (!jsvmStr(jenv, res, &report) || report.empty()) {
                        err = "JS 返回为空";
                    }
                }
            }
        }
    }
    if (jenv != nullptr && vScope != nullptr) OH_JSVM_CloseHandleScope(jenv, vScope);
    if (jenv != nullptr) OH_JSVM_DestroyEnv(jenv);
    if (vm != nullptr) OH_JSVM_DestroyVM(vm);

    // 包装（与 Android vapor.json 顶层同形）
    std::string wrapper;
    char head[256];
    snprintf(head, sizeof(head),
             "{\"ok\":%s,\"host_id\":\"harmony\",\"host_mount_calls\":%d,\"host_nodes\":%d,\"host_cmds\":%d,"
             "\"host_painted_samples\":%d,\"host_painted_colors\":%d",
             err.empty() ? "true" : "false", g_vaporMountCalls, g_vaporHostNodes, g_vaporHostCmds,
             g_vaporPaintedSamples, g_vaporPaintedColors);
    wrapper = head;
    if (!err.empty()) {
        wrapper += ",\"error\":\"" + jsonEscape(err) + "\"";
    }
    if (!report.empty()) {
        wrapper += ",\"report\":" + report;
    }
    wrapper += ",\"cmds\":" + g_vaporCmdsJson + "}";

    // 落盘（filesDir 由 ArkTS 传入）。
    // ★★两处写：① 应用沙箱（权威，应用自身可用）；② `/data/local/tmp`（**采集脚本可读**——
    //   实测 hdc 读不了应用沙箱 el2 路径：`Error opening file: permission denied`）。
    //   哪边失败都如实记日志（不静默）；判据路径以采集脚本实际取到的为准。
    if (!filesDir.empty()) {
        std::string paths[2] = {filesDir + "/vapor.json", "/data/local/tmp/proteus-vapor.json"};
        for (const auto& path : paths) {
            FILE* f = fopen(path.c_str(), "w");
            if (f != nullptr) {
                fwrite(wrapper.data(), 1, wrapper.size(), f);
                fclose(f);
                OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                             "PROTEUS_VAPOR_FILESAVED path=%{public}s bytes=%{public}zu", path.c_str(), wrapper.size());
            } else {
                OH_LOG_Print(LOG_APP, LOG_ERROR, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                             "PROTEUS_VAPOR_FILESAVE_FAIL path=%{public}s", path.c_str());
            }
        }
    }
    OH_LOG_Print(LOG_APP, LOG_INFO, PROTEUS_BENCH_DOMAIN, PROTEUS_BENCH_TAG,
                 "PROTEUS_VAPOR_DONE ok=%{public}d mounts=%{public}d nodes=%{public}d cmds=%{public}d report_len=%{public}zu",
                 err.empty() ? 1 : 0, g_vaporMountCalls, g_vaporHostNodes, g_vaporHostCmds, report.size());
    napi_value out;
    napi_create_string_utf8(env, wrapper.c_str(), NAPI_AUTO_LENGTH, &out);
    return out;
}

/** version(): string —— Rust 核版本自报（仪器自检） */
static napi_value BenchVersion(napi_env env, napi_callback_info info) {
    char* v = proteus_layout_version();
    std::string ver = v ? v : "unknown";
    if (v) proteus_layout_free_string(v);
    napi_value out;
    napi_create_string_utf8(env, ver.c_str(), NAPI_AUTO_LENGTH, &out);
    return out;
}

EXTERN_C_START
static napi_value BenchInit(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"bench4050", nullptr, Bench4050, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"hitProbe", nullptr, HitProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"recycleProbe", nullptr, RecycleProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"spliceProbe", nullptr, SpliceProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"textProbe", nullptr, TextProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"kernelAnimProbe", nullptr, KernelAnimProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"memProbe", nullptr, MemProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"sfcStressProbe", nullptr, SfcStressProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"sfcStressCommands", nullptr, SfcStressCommands, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"jsvmProbe", nullptr, JsvmProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"vaporProbe", nullptr, VaporProbe, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"version", nullptr, BenchVersion, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module benchModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = BenchInit,
    .nm_modname = "proteus_bench",
    .nm_priv = nullptr,
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterProteusBenchModule(void) {
    napi_module_register(&benchModule);
}
