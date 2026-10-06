// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host_helpers.h
// ★★关注点分层（见 hosts/README-LAYERS.md）：HAR runtime 与 dev 装置**共用的纯 helper**。
//   以 `static inline` 提供 ⇒ 各 TU 各取一份，无链接耦合、**单一来源**。
//   由 proteus_host.cpp（HAR runtime 桥）与 proteus_bench.cpp（dev 探针）共同 include。
#pragma once
#include <string>
#include <vector>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cstdlib>
#include <unordered_map>
#include <hilog/log.h>
#include <napi/native_api.h>
#include <native_drawing/drawing_font_collection.h>
#include <native_drawing/drawing_text_typography.h>
#include <native_drawing/drawing_text_declaration.h>
#include <native_drawing/drawing_types.h>
#include <ark_runtime/jsvm.h>

// 内核 C ABI（与 iOS/Android 同一组；helper 与调用方共用）
extern "C" {
uint64_t proteus_layout_create(const char* request_json);
char* proteus_layout_rects(uint64_t handle);
char* proteus_layout_hit_test(uint64_t handle, float x, float y);
// ★★二进制指令流（矩阵 #14）：SFC 订阅驱动更新 → 内核增量重排（与 Android JNI 同一 ABI）
char* proteus_layout_apply_ops(uint64_t handle, const uint8_t* ptr, uint32_t len);
// ★A/B 的 B 路（Vue patch 路径）：样式补丁更新 + 文本度量注入（与 iOS/Android 同一 ABI）
char* proteus_layout_update(uint64_t handle, const char* patches_json);
// ★★★P3-3（2026-10-03 · 三端同步）：内核动画（`<Transition>` 的驱动端）——
//   与 Android/iOS 同一套 `anim.rs` 入口（跨语言契约，见 anim.rs 头注）
char* proteus_layout_anim_start(uint64_t handle, const char* json);
char* proteus_layout_anim_tick(uint64_t handle, float dt_ms);
char* proteus_layout_anim_active(uint64_t handle);
char* proteus_layout_anim_stop(uint64_t handle, const char* json);
char* proteus_layout_set_text_measures(uint64_t handle, const char* measures_json);
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



struct Rect { float x, y, w, h;
    // ★★★overflow-x 项（2026-10-06）：**有效裁剪矩形**（祖先链交集；内核 rects 的 clipX/clipY/clipW/clipH）。
    //   hasClip=false ⇒ 不裁剪（宿主端零行为变化）。
    bool hasClip = false; float cx = 0, cy = 0, cw = 0, ch = 0; };

static inline bool jnum(const char* s, size_t segLen, const char* key, double* out) {
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

static inline std::string extractNodesArray(const std::string& json) {
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

static inline bool jstr(const char* s, size_t segLen, const char* key, std::string* out) {
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

static inline uint32_t hexToArgb(const std::string& css) {
    std::string h = css;
    if (!h.empty() && h[0] == '#') h = h.substr(1);
    if (h.size() != 6 && h.size() != 8) return 0;
    uint32_t v = (uint32_t)strtoul(h.c_str(), nullptr, 16);
    // ★★★批次 48 修复（与 iOS 同源的字节序错位，独立子代理视觉验收抓出）：8 位 hex 是
    //   **CSS4 序 `#RRGGBBAA`**（低 8 位 = alpha；与编译器产物 / 内核 ffi.rs / Web 一致）。
    //   此前直接当 ARGB 用 ⇒ `#5b5bd61a` 读成 A=0x5b R=0x5b G=0xd6 B=0x1a ⇒ 混白底渲染出**绿色**
    //   （同源编译三端异色）。现与 Android `VaporRenderHost` 同式转换。
    if (h.size() == 6) return v | 0xFF000000u;
    return ((v & 0xFFu) << 24) | (v >> 8);   // #RRGGBBAA → AARRGGBB
}

static inline std::vector<std::string> splitJsonObjects(const std::string& json) {
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

static inline std::string jsonEscape(const std::string& s) {
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

static inline double lineHeightDesignPx(const std::string& token, double fontSizeDesign) {
    if (token.empty()) return 0.0;
    try {
        if (token.size() > 2 && token.substr(token.size() - 2) == "px") {
            return std::stod(token.substr(0, token.size() - 2));
        }
        return std::stod(token) * fontSizeDesign;
    } catch (...) {
        return 0.0;
    }
}

static inline void measureTextTypoPx(const std::string& text, double fontPx, double* outW, double* outH, double letterSpacingPx = 0) {
    *outW = 0;
    *outH = 0;
    if (text.empty() || fontPx <= 0) return;
    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleFontSize(tstyle, fontPx);
    // ★批次 20：字距（物理 px）——影响文本宽度，必须进度量
    if (letterSpacingPx != 0) OH_Drawing_SetTextStyleLetterSpacing(tstyle, letterSpacingPx);
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

static inline void measureTextWrappedTypoPx(const std::string& text, double fontPx, double lineWidthPx,
                                     double* outW, double* outH, double letterSpacingPx = 0,
                                     const std::string& wordBreak = "") {
    *outW = 0; *outH = 0;
    if (text.empty() || fontPx <= 0 || lineWidthPx <= 1.0) return;
    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    // ★★★word-break 项（2026-10-06）：测量须与绘制同断词策略（否则折行数不一致 ⇒ 盒高错）。
    // ★★★修（2026-10-08 · 用户抓出「鸿蒙案例C文字换行/不垂直居中」）：**绘制已显式 NORMAL，测量也必须 NORMAL**——
    //   否则测量按鸿蒙默认断词在**数字/字母边界**（"1fr"→"1"/"fr"）断开 ⇒ 文本节点被算成 2 行高（98px）
    //   ⇒ 与绘制（1 行）不一致 ⇒ 节点虚高 + 顶对齐（不垂直居中）。两处断词策略必须一致。
    if (wordBreak == "break-all") OH_Drawing_SetTypographyTextWordBreakType(ts, 1);
    else OH_Drawing_SetTypographyTextWordBreakType(ts, 0); // WORD_BREAK_TYPE_NORMAL
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleFontSize(tstyle, fontPx);
    if (letterSpacingPx != 0) OH_Drawing_SetTextStyleLetterSpacing(tstyle, letterSpacingPx);
    OH_Drawing_TypographyCreate* handler = OH_Drawing_CreateTypographyHandler(ts, fc);
    if (handler != nullptr) {
        OH_Drawing_TypographyHandlerPushTextStyle(handler, tstyle);
        OH_Drawing_TypographyHandlerAddText(handler, text.c_str());
        OH_Drawing_Typography* typo = OH_Drawing_CreateTypography(handler);
        if (typo != nullptr) {
            OH_Drawing_TypographyLayout(typo, lineWidthPx);
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

static inline std::string extractValueAfterKey(const std::string& json, const char* key, char openCh, char closeCh) {
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

static inline void parseRects(const std::string& s, std::unordered_map<int, Rect>& out) {
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
        Rect r{(float)x, (float)y, (float)w, (float)h};
        // ★★★overflow-x 项（2026-10-06）：有效裁剪矩形（**扁平键**——内核刻意不用嵌套对象：
        //   嵌套会把本函数的"找 '}' 当段尾"截断 ⇒ 几何全 0）
        double cxx = 0, cyy = 0, cww = 0, chh = 0;
        if (jnum(s.c_str() + q, segEnd - q, "clipX", &cxx)) {
            jnum(s.c_str() + q, segEnd - q, "clipY", &cyy);
            jnum(s.c_str() + q, segEnd - q, "clipW", &cww);
            jnum(s.c_str() + q, segEnd - q, "clipH", &chh);
            r.hasClip = true; r.cx = (float)cxx; r.cy = (float)cyy; r.cw = (float)cww; r.ch = (float)chh;
        }
        out[id] = r;
        p = segEnd + 1;
    }
}

static inline bool jsvmStr(JSVM_Env env, JSVM_Value v, std::string* out) {
    if (v == nullptr) return false;
    size_t len = 0;
    if (OH_JSVM_GetValueStringUtf8(env, v, nullptr, 0, &len) != JSVM_OK) return false;
    std::string buf(len + 1, '\0');
    if (len > 0 && OH_JSVM_GetValueStringUtf8(env, v, &buf[0], len + 1, &len) != JSVM_OK) return false;
    buf.resize(len);
    *out = buf;
    return true;
}

static inline bool jsvmEvalStr(JSVM_Env jenv, const char* expr, std::string* out) {
    JSVM_Value src = nullptr;
    OH_JSVM_CreateStringUtf8(jenv, expr, JSVM_AUTO_LENGTH, &src);
    JSVM_Script script = nullptr;
    bool cr = false;
    if (OH_JSVM_CompileScript(jenv, src, nullptr, 0, false, &cr, &script) != JSVM_OK) return false;
    JSVM_Value res = nullptr;
    if (OH_JSVM_RunScript(jenv, script, &res) != JSVM_OK) return false;
    if (out != nullptr) return jsvmStr(jenv, res, out);
    return true;
}

static inline std::string hostMemUsageJson(JSVM_VM vm) {
    JSVM_HeapStatistics hs;
    memset(&hs, 0, sizeof(hs));
    OH_JSVM_GetHeapStatistics(vm, &hs);
    char buf[220];
    snprintf(buf, sizeof(buf),
             "{\"memory_used_size\":%zu,\"obj_count\":%zu,\"scope\":\"engine\","
             "\"total_heap_size\":%zu,\"peak_malloced\":%zu}",
             hs.usedHeapSize, hs.numberOfNativeContexts, hs.totalHeapSize, hs.peakMallocedMemory);
    return buf;
}

static inline JSVM_Value HostMemUsageCb(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_VM vm = nullptr;
    OH_JSVM_GetVM(env, &vm);
    std::string out = vm != nullptr ? hostMemUsageJson(vm) : "{\"memory_used_size\":0,\"obj_count\":0,\"scope\":\"engine\"}";
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, out.c_str(), out.size(), &r);
    return r;
}

static inline JSVM_Value HostGcCb(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    OH_JSVM_MemoryPressureNotification(env, JSVM_MEMORY_PRESSURE_LEVEL_CRITICAL);
    JSVM_Value r = nullptr;
    OH_JSVM_CreateStringUtf8(env, "\"ok\"", 4, &r);
    return r;
}
