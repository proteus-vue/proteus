// platform/harmony/proteus-platform/src/main/cpp/proteus_text_platform.h
// ★★**鸿蒙平台适配层：文本度量与字体**（HA0.5 从 `hosts/harmony/.../proteus_host_helpers.h` 抽出）
//
// 【这一层是什么（Host ABI 方案 §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · 文本度量（ArkGraphics2D Typography）—— **不用改** ⇒ **平台适配**（各端各写是**正确设计**）
//   · 字体角色映射（monospace/serif/… → 鸿蒙字体族 + 字重）—— 同平台内通用 ⇒ 同属本层
//   ⇒ 因此它属于 `platform/`；而**宿主集成**（RenderNode 挂载 / 生命周期 / 输入 / 调度 / napi 桥）留在 `hosts/`。
//
// 【与 iOS/Android 的对称】**三端同一份契约**：`measureText*`（给定文本 + 字体参数 → {w,h}）+
//   字体角色映射。iOS = `ProteusTextAdapter`（CoreText）；Android = `ProteusTextPlatform`（Typeface/TextPaint）；
//   鸿蒙 = 本头文件（OH_Drawing Typography）。三端**都只度量**——**绘制执行**各在宿主（载体是平台 View/Canvas）。
//
// 【依赖方向（硬性，`scripts/check-platform-layering.mjs` 机器化）】
//   platform/* ──→ **禁止**引用 hosts/* 与 Host ABI（平台层不感知宿主契约）
//   本文件只依赖 `native_drawing/*`（ArkGraphics2D NDK）⇒ 任何鸿蒙宿主都能复用它。
//
// 【诚实边界】本头文件是**机械抽取**（逐行搬移，零语义改动）——由鸿蒙真机构建 + 渲染守住"行为未变"。
#pragma once

#include <string>

#include <native_drawing/drawing_font_collection.h>
#include <native_drawing/drawing_text_typography.h>
#include <native_drawing/drawing_text_declaration.h>
#include <native_drawing/drawing_types.h>

/// `line-height` token → **行盒高（设计像素）**（无单位倍数×fontSize / 绝对 px；解析失败 ⇒ 0）。
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

/// ★★★共享字体属性（**测量与绘制必须同源**——否则测得窄、画得宽 ⇒ fit-content 盒误折行）。
///   用户抓出：鸿蒙列表项右侧文字换行（"空间明显充足"）——根因 = 测量只设 fontSize（normal 字重），
///   而绘制设了 fontWeight（bold）⇒ 绘制文本更宽 > 盒宽 ⇒ 折行。Android/iOS 测量**带字重**故无此问题。
static inline void applyTextFont(OH_Drawing_TextStyle* tstyle, int fontWeight, const std::string& fontFamily) {
    int wi = fontWeight / 100 - 1;
    if (wi < 0) wi = 0; else if (wi > 8) wi = 8;
    OH_Drawing_SetTextStyleFontWeight(tstyle, wi);
    if (fontFamily == "monospace") {
        const char* fams[] = {"HarmonyOS Sans Digit", "monospace"};
        OH_Drawing_SetTextStyleFontFamilies(tstyle, 2, fams);
    } else if (fontFamily == "serif") {
        const char* fams[] = {"serif"};
        OH_Drawing_SetTextStyleFontFamilies(tstyle, 1, fams);
    }
}

/// 单行度量（物理 px）：`*outW/*outH` = 最长行宽 / 行盒高（同 iOS `measureText` / Android `measureSingle`）。
static inline void measureTextTypoPx(const std::string& text, double fontPx, double* outW, double* outH, double letterSpacingPx = 0,
                                     int fontWeight = 400, const std::string& fontFamily = "") {
    *outW = 0;
    *outH = 0;
    if (text.empty() || fontPx <= 0) return;
    OH_Drawing_FontCollection* fc = OH_Drawing_CreateFontCollection();
    if (fc == nullptr) return;
    OH_Drawing_TypographyStyle* ts = OH_Drawing_CreateTypographyStyle();
    OH_Drawing_TextStyle* tstyle = OH_Drawing_CreateTextStyle();
    OH_Drawing_SetTextStyleFontSize(tstyle, fontPx);
    applyTextFont(tstyle, fontWeight, fontFamily);   // ★字重/字族（与绘制同源——否则误折行）
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

/// 折行度量（物理 px）——`lineWidthPx` 为盒宽；`wordBreak` 与绘制同策略（否则折行数不一致 ⇒ 盒高错）。
static inline void measureTextWrappedTypoPx(const std::string& text, double fontPx, double lineWidthPx,
                                     double* outW, double* outH, double letterSpacingPx = 0,
                                     const std::string& wordBreak = "",
                                     int fontWeight = 400, const std::string& fontFamily = "") {
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
    applyTextFont(tstyle, fontWeight, fontFamily);   // ★字重/字族（与绘制同源）
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
