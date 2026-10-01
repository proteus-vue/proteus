// packages/layout-core-rust/src/ffi.rs
// ★★L1 排版核心的 **C ABI 边界**（三端共享的同一份接口）：
//   · iOS：Swift/ObjC++ 直接链接静态库调用（本文件即宿主入口）
//   · Android：JNI 包装层调用同名函数（`extern "C"` 可直接被 JNI 引用）
//   · 鸿蒙：NAPI 包装层同样调用
//
// ★设计原则（方案 §5.1「引擎原生 API 不得泄漏」的延伸）：
//   跨界只传**字符串（JSON）**，不传结构体——理由：
//     ① 结构体 ABI 依赖编译器/对齐/字段顺序，跨语言极易踩坑；字符串无此问题
//     ② 便于真机侧直接打印/存档（本仓的真机验证就是靠它把报告带回来的）
//     ③ 生产路径（M2+）再按「二进制 flat buffer + 零拷贝」优化；**先保证正确与可观测**
//
// ★内存契约（C 侧必须遵守）：
//   本文件返回的每个 `*mut c_char` 都是**堆分配、调用方负责释放**的 C 字符串，
//   释放必须用 `proteus_layout_free_string`（不能直接 free——分配器可能不同）。
use std::ffi::{c_char, CStr, CString};

use crate::engine::{AvailableSpace, LayoutEngine, RootConstraint, TableTextMeasurer};
use crate::node::{LNode, LayoutTree, NodeIndex, NO_PARENT};
use crate::style::{Edges, FlexDirection, LStyle, Overflow, Position, Size};
use crate::taffy_engine::TaffyEngine;

/// 把 Rust 字符串交给 C 侧（调用方负责用 `proteus_layout_free_string` 释放）
fn into_c_string(s: String) -> *mut c_char {
    // ★字符串内部不应含 NUL；含则替换（避免 CString::new 失败导致 panic 跨 FFI——跨 FFI panic 是 UB）
    match CString::new(s) {
        Ok(c) => c.into_raw(),
        Err(e) => {
            let sanitized = e.into_vec();
            let filtered: Vec<u8> = sanitized.into_iter().filter(|b| *b != 0).collect();
            CString::new(filtered).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
        }
    }
}

/// 释放本模块返回的字符串（**必须**用它而非 free）
///
/// # Safety
/// `ptr` 必须是本模块返回且尚未释放的指针（或 null）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(unsafe { CString::from_raw(ptr) });
}

/// 库版本（宿主可打印以确认加载的是哪一版）
#[no_mangle]
pub extern "C" fn proteus_layout_version() -> *mut c_char {
    into_c_string(format!(
        "proteus-layout-core {} · engine={} · taffy 锁定 0.14（0.13 有 measure 指数退化）",
        env!("CARGO_PKG_VERSION"),
        TaffyEngine::new().name()
    ))
}

/* ────────────────────────── 引擎就绪输入（JSON DTO） ────────────────────────── */

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeDto {
    pub(crate) id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) width_ratio: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) height_ratio: Option<f32>,
    // ★min/max 四轴：golden 里有，DTO 必须一一对应（漏一个字段 = 该约束被静默忽略，
    //   本仓实测：漏 max_width 导致「max-width 夹取」用例偏差 35dp）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) margin: Option<EdgesDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) padding: Option<EdgesDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) justify_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) align_items: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) align_self: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_grow: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_shrink: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_basis: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) gap: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) top: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) left: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) overflow: Option<String>,
    /// ★★**背景色**（2026-10-01，颜色动画的**底色**来源）——接受 CSS 形态：
    ///   `#RGB` / `#RRGGBB` / `#AARRGGBB` / `#RRGGBBAA`（后两者靠长度区分）。
    ///
    /// 【为什么在这里解析】`bg_base` 是**内核状态**（复位目标 + 颜色动画的起点基准），
    ///   必须在建树时从请求里取得。宿主侧的 `style["backgroundColor"]` 文本形态是历史路径
    ///   （iOS 建层用）；内核这一份是**动画轨道**用的（打包 u32）。
    /// 【未声明 ⇒ `None`】该节点不进颜色轨道（`start` 会明确拒绝给它的颜色动画，见 `AnimEngine::start`）。
    ///
    /// ★注意：`NodeDto` 是 `rename_all = "camelCase"` ⇒ 线上键名是 **`backgroundColor`**
    ///   （与适配器/宿主既有键名一致——不需要新的字段名）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) background_color: Option<String>,
    /// ★★**文字色**（2026-10-01）：CSS 十六进制（`#RGB`/`#RRGGBB`/`#RRGGBBAA`，与底色同一解析器）。
    ///
    /// 【为什么用键名 `color`】它与既有语义一致：适配器（`renderer-app` 的 PAINT_KEYS）与
    ///   两端宿主的历史路径都用 `color` 表示**文字色**（底色是 `backgroundColor`）——
    ///   内核采用同名字段，避免"同一语义两个键名"（本仓纪律：一处实现一套命名）。
    /// 【谁在阻止它进内核（本轮修）】iOS 宿主组装请求时把 `color` 当"纯绘制字段"**删掉**
    ///   （见其 `render/fullRequest` 注释）；它现在是内核字段 ⇒ 必须放行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) color: Option<String>,
    /// ★★**透视距离**（2026-10-01 · B 批 3D；CSS `perspective` 语义，px）——
    ///   静态样式（非动画属性）：宿主建层时读取用于组 3D 矩阵。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) perspective: Option<f32>,
    /// ★★**SVG 路径声明**（2026-10-01 · C2）：`{d, stroke, strokeWidth}`——
    ///   `d` 由**内核解析**（单一实现，见 `svg_path` 模块）；`stroke` 是描边色（CSS hex）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) svg_path: Option<serde_json::Value>,
    /// ★★**渐变填充 A 态**（2026-10-01 · 渐变 v2）：与 TS `GradientFill` 同形——
    ///   `{kind:'linear'|'radial', angle|cx/cy/r, stops:[{offset,color,alpha?}]}`。
    ///   【为什么 v1 在宿主、v2 迁内核】v2 要逐帧混合色标 ⇒ 求值进了内核 ⇒ 数学必须一处实现
    ///   （v1 文件头写好的迁移条件被打破即迁——见 `style::GradState` 注释）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) fill_gradient: Option<serde_json::Value>,
    /// ★★**渐变填充 B 态**（可选）：与 A 同 kind、同色标个数——两态之间由 `gradientMix` 通道混合。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) fill_gradient_to: Option<serde_json::Value>,
    /// ★★**发光声明**（2026-10-01 · glow v1）：`{color, radius, alpha}`——分层描边实现
    ///   （见 `style::GlowSpec` 的"为什么不用平台原生"论证）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) glow: Option<serde_json::Value>,
    /// ★★**路径变形的 B 态**（2026-10-01 · 路径变形 v1）：与 `svg_path` 同形
    ///   （`{d, stroke, strokeWidth}`）；两态必须**同构**（同命令序列）才能逐点插值。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) svg_path_to: Option<serde_json::Value>,
    /// ★★**裁剪形状**（2026-10-01 · C1）：CSS `clip-path` 的**结构化形态**——
    ///   `{kind: 'inset'|'circle'|'polygon', params: number[]}`（params 按形状类型解释，
    ///   分数/px 混合见 `clip_params_from_decl`）。类型静态、参数可动画（CSS 同规）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) clip_path: Option<serde_json::Value>,
    /// 文本字面量（有此字段即为文本叶子，走宿主注入的度量）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text: Option<String>,
    /// ★golden 用 `isText` 标记文本叶子（**不含字面量**——度量按 id 查表，见 TS 侧 golden 注释）。
    ///   故两个来源都要认：宿主直传用 `text`，golden 用 `isText`。
    // ★必须可省略：调用方（含本仓自己的请求构造器）不会为「非文本节点」写 isText:false
    #[serde(default)]
    pub(crate) is_text: bool,
    /// ★原生宿主节点（L3：webview/map/广告/相机）——布局无影响，但宿主据此创建原生 View
    #[serde(default)]
    pub(crate) native_host: bool,
    /// 语义标签（诊断用；如 `shell.webview`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) semantic: Option<String>,
    /// **字体签名**（编译器/平台算出的稳定哈希）——进度量缓存键，见 Profile §5.3
    /// （键 = 文本 hash + 字体 + 宽度约束；Rust 侧不解析字体属性，只透传签名）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text_style_key: Option<u32>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Default)]
pub(crate) struct EdgesDto {
    #[serde(default)]
    pub(crate) top: f32,
    #[serde(default)]
    pub(crate) right: f32,
    #[serde(default)]
    pub(crate) bottom: f32,
    #[serde(default)]
    pub(crate) left: f32,
}

impl From<EdgesDto> for Edges {
    fn from(e: EdgesDto) -> Self {
        Edges { top: e.top, right: e.right, bottom: e.bottom, left: e.left }
    }
}

impl NodeDto {
    /// 全 `None` 的默认节点（blob 解码时按位图逐字段填充）
    pub(crate) fn default_blob() -> Self {
        Self {
            id: 0,
            parent_id: None,
            width: None,
            height: None,
            width_ratio: None,
            height_ratio: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            margin: None,
            padding: None,
            flex_direction: None,
            justify_content: None,
            align_items: None,
            align_self: None,
            flex_grow: None,
            flex_shrink: None,
            flex_basis: None,
            gap: None,
            display: None,
            position: None,
            top: None,
            left: None,
            overflow: None,
            // ★颜色：blob 形态暂无这两个字段（按位图解码；未提供 ⇒ 该节点不进颜色轨道）
            background_color: None,
            color: None,
            perspective: None,
            clip_path: None,
            svg_path: None,
            fill_gradient: None,
            fill_gradient_to: None,
            svg_path_to: None,
            glow: None,
            text: None,
            is_text: false,
            native_host: false,
            semantic: None,
            text_style_key: None,
        }
    }
}

/// 一棵树的布局请求（★字段名与 TS 侧 golden 同为 camelCase——两边靠字符串契约对齐）
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayoutRequest {
    #[serde(default = "default_viewport")]
    pub(crate) viewport: ViewportDto,
    pub(crate) nodes: Vec<NodeDto>,
    /// 文本度量（`节点id → 尺寸`）：由宿主提供——iOS 走 CoreText、Android 走 StaticLayout。
    /// ★这一项不可省：核心**不自研文本**（Profile §L4），故必须由平台注入。
    #[serde(default)]
    pub(crate) text_measures: std::collections::HashMap<String, SizeDto>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Default)]
pub(crate) struct ViewportDto {
    #[serde(default)]
    pub(crate) width: f32,
    #[serde(default)]
    pub(crate) height: f32,
}

fn default_viewport() -> ViewportDto {
    ViewportDto { width: 375.0, height: 812.0 }
}

/// ★★**CSS 颜色 → `0xAARRGGBB`**（2026-10-01，颜色动画的底色解析唯一实现）
///
/// 支持（够用的封闭集；未知形态**明确报错**——不静默落黑）：
///   `#RGB`（简写，各通道重复一位）· `#RRGGBB`（不透明）· `#RRGGBBAA`（CSS4 序）·
///   `#AARRGGBB`（Android 惯例序；与前者**同为 8 位**，按调用方场景区分——
///   本函数取 **CSS4 序**（`#RRGGBBAA`，与 Web 一致），因为底色的来源是 CSS 风格声明）。
///
/// 【为什么放内核（而不是让宿主各解析一份）】颜色动画的**起点/复位**需要这个值在**内核状态**里
///   ⇒ 解析必须发生在建树时（内核侧）。宿主已有的 `parseHexColor`（iOS）/`Cmd.color`（Android）
///   是**绘制**用途的另一条路（不受本函数影响）。
///
/// 【与 TS 侧的分工】TS 侧的 `parseColorToChannels`（`@proteus-vue/animation`）是**跨语言契约的
///   编译期半边**：它把用户声明的颜色拆成 4 个通道值（下发 4 条指令）。两者不重复——
///   内核这一份只解析**底色**（树 DTO 的字符串），TS 那一份解析**动画的 from/to**。
///   判据 `tests/anim-color-golden.test.ts` 以内核实测值为期望比对 TS 半边（防分叉）。
/// `NodeVisual` → JSON 数组（**唯一序列化点**——2026-10-01）
///
/// 形状：`[id, tx, ty, scale, rotate, opacity, bg, textColor]`（8 项）。
///
/// 【为什么收敛成一处（本仓「同一语义一处实现」的又一次应用）】此前**5 个 JSON 入口**
///   （tick / flip / seek / seek_scroll / shared_element）各自内联写了同一段 6 值 map ⇒
///   颜色落地时若要逐个改，就是"改 5 处、漏 1 处"的经典形态（二进制通道已经因为漏改
///   出过错位解析）。⇒ 抽出本函数，5 个入口共用；`u32::MAX` = 该基色不存在。
fn visual_to_json(v: &crate::anim::NodeVisual) -> serde_json::Value {
    // ★★B 批（2026-10-01）：末尾追加 rotateX/rotateY（第 9/10 项）——**既有索引全不变**
    //   （旧消费端读前 8 项照常工作；新消费端读 9/10——向后兼容的线格式演进）。
    // ★★C1（2026-10-01）：末尾再追加 clip 段——第 11 项 = 形状类型（0 = 无），
    //   第 12..28 项 = 16 个形状参数。**既有索引全不变**（向后兼容的线格式演进）。
    let (ck, cp) = v.clip.map(|(k, p)| (k as u32, p)).unwrap_or((0, [0.0; 16]));
    // ★★C2：末尾再追加描边进度（第 28 项；`u32::MAX` = 无描边路径——与颜色的哨兵同约定）
    let stroke = v
        .stroke_progress
        .map(|p| p.to_bits() as u64)
        .unwrap_or(u32::MAX as u64);
    serde_json::json!([
        v.id,
        v.tx,
        v.ty,
        v.scale,
        v.rotate,
        v.opacity,
        v.bg.unwrap_or(u32::MAX),
        v.text_color.unwrap_or(u32::MAX),
        v.rotate_x,
        v.rotate_y,
        ck,
        cp[0], cp[1], cp[2], cp[3], cp[4], cp[5], cp[6], cp[7],
        cp[8], cp[9], cp[10], cp[11], cp[12], cp[13], cp[14], cp[15],
        stroke
    ])
}

pub(crate) fn parse_css_color(raw: &str) -> Result<u32, String> {
    let s = raw.trim();
    let hex = s.strip_prefix('#').ok_or_else(|| {
        format!("颜色 \"{s}\" 不支持：本引擎只接受 #RGB / #RRGGBB / #RRGGBBAA 十六进制形态")
    })?;
    let bad = || format!("颜色 \"{s}\" 不是合法十六进制（应为 #RGB / #RRGGBB / #RRGGBBAA）");
    let v = u32::from_str_radix(hex, 16).map_err(|_| bad())?;
    Ok(match hex.len() {
        3 => {
            // #RGB：各通道重复一位（#f0a → #ff00aa，alpha = FF）
            let r = ((v >> 8) & 0xF) as u32;
            let g = ((v >> 4) & 0xF) as u32;
            let b = (v & 0xF) as u32;
            (0xFF00_0000) | ((r * 17) << 16) | ((g * 17) << 8) | (b * 17)
        }
        6 => 0xFF00_0000 | v,
        // ★8 位取 **CSS4 序** `#RRGGBBAA`（与 Web 一致）：低 8 位是 alpha
        8 => ((v & 0xFF) << 24) | ((v >> 8) & 0x00FF_FFFF),
        _ => return Err(bad()),
    })
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy)]
pub(crate) struct SizeDto {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

/// 把 DTO 转成引擎就绪的扁平树
/// ★★`NodeDto → LStyle` 的**唯一实现**（本仓纪律：同一语义一处实现）
///
/// 【为什么抽出来（本仓实测的动机）】`build_tree`（建树）与 `proteus_layout_splice`
///   （结构变更插子树）都要做这件事；两份实现必然分叉——**样式字段漏一个 = 静默丢样式**。
pub(crate) fn style_from_dto(dto: &NodeDto) -> Result<LStyle, String> {
    let mut style = LStyle::default();
    // ★★底色（2026-10-01）：颜色动画的复位目标 + 起点基准（见 `LStyle.bg_base`）
    if let Some(raw) = dto.background_color.as_deref() {
        let packed = parse_css_color(raw)?;
        style.bg = Some(packed);
        style.bg_base = Some(packed);
    }
    // ★★文字色（2026-10-01）：与底色同一条链（同一解析器、同一四通道数学），只是另一个槽
    if let Some(raw) = dto.color.as_deref() {
        let packed = parse_css_color(raw)?;
        style.text_color = Some(packed);
        style.text_color_base = Some(packed);
    }
    // ★★透视（B 批 3D）：静态样式——正值有效；非正/非有限 ⇒ 明确拒绝（不静默当无透视）
    if let Some(p) = dto.perspective {
        if !p.is_finite() || p <= 0.0 {
            return Err(format!("perspective 非法：{p}（应为正数 px——越大越弱，如 1200）"));
        }
        style.perspective = Some(p);
    }
    // ★★SVG 路径（C2）：`d` **内核解析**（单一实现；宿主不做第二份解析器）——
    //   段列表进样式（宿主建平台 path 用）；写线进度是独立通道（`StrokeProgress`）。
    if let Some(sp) = dto.svg_path.as_ref() {
        let d = sp
            .get("d")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "svgPath 缺少 `d`（路径数据字符串，如 'M0 0 L10 10 Z'）".to_string())?;
        let parsed = crate::svg_path::parse_svg_path(d)?;
        style.svg_path = Some(parsed);
        if let Some(col) = sp.get("stroke").and_then(|x| x.as_str()) {
            style.stroke_color = parse_css_color(col)?;
        }
        if let Some(w) = sp.get("strokeWidth").and_then(|x| x.as_f64()) {
            let w = w as f32;
            if !w.is_finite() || w <= 0.0 {
                return Err(format!("svgPath.strokeWidth 非法：{w}（应为正数 px）"));
            }
            style.stroke_width = w;
        }
    }
    // ★★路径变形的 B 态（在 A 态**之后**解析——同构校验要拿 A 的签名比对）。
    //   校验失败 ⇒ **明确拒绝**（异型之间插值无定义；本引擎不做"猜测对齐"这类静默行为）。
    if let Some(sp2) = dto.svg_path_to.as_ref() {
        let d2 = sp2
            .get("d")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "svgPathTo 缺少 `d`（路径数据字符串）".to_string())?;
        let parsed2 = crate::svg_path::parse_svg_path(d2)?;
        let Some(a) = style.svg_path.as_ref() else {
            return Err(
                "只声明了 `svgPathTo`（B 态）而没有 `svgPath`（A 态）——路径变形需要起点与终点                 两态；请补 A 态或删掉 B 态"
                    .to_string(),
            );
        };
        let sa = a.structure_signature();
        let sb = parsed2.structure_signature();
        let (final_a, final_b, resampled) = if sa == sb {
            // 同构：直接用（零重采样开销——常见路径的最优路径）
            (a.clone(), parsed2, false)
        } else {
            // ★★**异构 ⇒ 自动重采样**（2026-10-01 · 路径变形 v2）：把两态都重采样到
            //   相同的 `n` 段三次贝塞尔（均匀弧长 + Catmull-Rom 平滑）——
            //   这是 MorphSVG / flubber 的核心手法，本引擎的实现在内核**一处**
            //   （`SvgPath::resample_uniform`）。
            //   段数取两边段数的较大者（并夹到 12..48：太少的"圆"不圆、太多的每帧插值变重）。
            let n = a.segs.len().max(parsed2.segs.len()).clamp(12, 48);
            // 闭合语义统一：两边都闭合才闭合（否则签名仍会差一个 Z）
            let a_closed = matches!(a.segs.last(), Some(crate::svg_path::PathSeg::Close));
            let b_closed = matches!(parsed2.segs.last(), Some(crate::svg_path::PathSeg::Close));
            let closed = a_closed && b_closed;
            let ra = a.resample_uniform(n, closed).ok_or_else(|| {
                format!(
                    "svgPath 与 svgPathTo 结构不同（{sa} vs {sb}）需要**自动重采样**，                     但 A 态无法重采样——路径退化（总长≈0）或多子路径。                     请让 A 态是单子路径且非零长，或把两条路径改成同构"
                )
            })?;
            let rb = parsed2.resample_uniform(n, closed).ok_or_else(|| {
                format!(
                    "svgPath 与 svgPathTo 结构不同（{sa} vs {sb}）需要**自动重采样**，                     但 B 态无法重采样——路径退化（总长≈0）或多子路径。                     请让 B 态是单子路径且非零长，或把两条路径改成同构"
                )
            })?;
            (ra, rb, true)
        };
        // ★A 态**替换**为重采样版（`morphed` 以 `style.svg_path` 为 A——不替换会 zip 错结构）
        style.svg_path = Some(final_a);
        style.svg_path_to = Some(final_b);
        style.svg_morph_resampled = resampled;
    }
    // ★★发光（glow v1）：`{color, radius, alpha}` —— 全部字段必填且各自校验（不静默用默认值：
    //   "写了 glow 但少了 radius" 应该报错而不是渲染一个半径为 0 的隐形发光）。
    if let Some(g) = dto.glow.as_ref() {
        let color_s = g
            .get("color")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "glow 缺少 `color`（发光色，如 '#ffcc66'）".to_string())?;
        let color = parse_css_color(color_s)?;
        let radius = g
            .get("radius")
            .and_then(|x| x.as_f64())
            .ok_or_else(|| "glow 缺少 `radius`（发光半径 px——分层描边的最外圈超出量）".to_string())?
            as f32;
        if !radius.is_finite() || radius <= 0.0 {
            return Err(format!("glow.radius 非法：{radius}（应为正数 px）"));
        }
        let alpha = g
            .get("alpha")
            .and_then(|x| x.as_f64())
            .ok_or_else(|| "glow 缺少 `alpha`（强度 0..1——每层 alpha 由它按平方衰减）".to_string())?
            as f32;
        if !alpha.is_finite() || !(0.0..=1.0).contains(&alpha) {
            return Err(format!("glow.alpha 非法：{alpha}（应为 0..1）"));
        }
        style.glow = Some(crate::style::GlowSpec { color, radius, alpha });
    }
    // ★★裁剪形状（C1）：结构形态 → (kind, [f32; 16])。类型静态、参数进基态（复位目标）。
    // ★★渐变（v2）：A 态必需配套 B 态才有"混合"——两态都在时校验结构一致（kind/色标数）。
    if let Some(fg) = dto.fill_gradient.as_ref() {
        let a = parse_gradient(fg, "fillGradient")?;
        let state = match dto.fill_gradient_to.as_ref() {
            None => crate::style::GradState { has_b: false, ..a },
            Some(b_raw) => {
                let b = parse_gradient(b_raw, "fillGradientTo")?;
                if a.kind != b.kind {
                    return Err(format!(
                        "fillGradient 与 fillGradientTo 的类型不同（{} vs {}）——两态必须同 kind                         （异型渐变之间没有'逐标混合'的定义）",
                        if a.kind == 1 { "linear" } else { "radial" },
                        if b.kind == 1 { "linear" } else { "radial" },
                    ));
                }
                if a.n != b.n {
                    return Err(format!(
                        "fillGradient 与 fillGradientTo 的色标个数不同（{} vs {}）——逐标混合要求一一对应                         （本引擎不做'补齐/截断'这类静默猜测）",
                        a.n, b.n
                    ));
                }
                crate::style::GradState {
                    colors_b: b.colors_a,
                    offsets_b: b.offsets_a,
                    has_b: true,
                    ..a
                }
            }
        };
        style.grad = Some(state);
    } else if dto.fill_gradient_to.is_some() {
        return Err("只声明了 `fillGradientTo`（B 态）而没有 `fillGradient`（A 态）——                    混合需要起点与终点两态；请补 A 态或删掉 B 态"
            .to_string());
    }
    if let Some(cp) = dto.clip_path.as_ref() {
        let (kind, params) = parse_clip_path(cp)?;
        style.clip_kind = kind;
        style.clip = params;
        style.clip_base = params;
    }
    style.width = dto.width;
    style.height = dto.height;
    style.width_ratio = dto.width_ratio;
    style.height_ratio = dto.height_ratio;
    style.min_width = dto.min_width;
    style.max_width = dto.max_width;
    style.min_height = dto.min_height;
    style.max_height = dto.max_height;
    if let Some(m) = dto.margin {
        style.margin = m.into();
    }
    if let Some(p) = dto.padding {
        style.padding = p.into();
    }
    if let Some(fd) = dto.flex_direction.as_deref() {
        style.flex_direction = match fd {
            "row" => FlexDirection::Row,
            "column" => FlexDirection::Column,
            "row-reverse" => FlexDirection::RowReverse,
            "column-reverse" => FlexDirection::ColumnReverse,
            other => return Err(format!("未知 flexDirection：{other}")),
        };
    }
    if let Some(j) = dto.justify_content.clone() {
        style.justify_content = j;
    }
    if let Some(a) = dto.align_items.clone() {
        style.align_items = a;
    }
    style.align_self = dto.align_self.clone();
    if let Some(g) = dto.flex_grow {
        style.flex_grow = g;
    }
    if let Some(s) = dto.flex_shrink {
        style.flex_shrink = s;
    }
    style.flex_basis = dto.flex_basis;
    if let Some(gap) = dto.gap {
        style.gap = gap;
    }
    if let Some(d) = dto.display.as_deref() {
        style.display = match d {
            "flex" => crate::style::Display::Flex,
            "none" => crate::style::Display::None,
            other => return Err(format!("未知 display：{other}")),
        };
    }
    if let Some(p) = dto.position.as_deref() {
        style.position = match p {
            "static" => Position::Static,
            "relative" => Position::Relative,
            "absolute" => Position::Absolute,
            other => return Err(format!("未知 position：{other}")),
        };
    }
    style.top = dto.top;
    style.left = dto.left;
    if let Some(o) = dto.overflow.as_deref() {
        style.overflow = match o {
            "visible" => Overflow::Visible,
            "hidden" => Overflow::Hidden,
            "scroll" => Overflow::Scroll,
            "auto" => Overflow::Auto,
            other => return Err(format!("未知 overflow：{other}")),
        };
    }
    Ok(style)
}

/// ★★从 `NodeDto` 造节点（建树与结构变更共用——同上理由）
pub(crate) fn node_from_dto(dto: &NodeDto) -> Result<LNode, String> {
    let style = style_from_dto(dto)?;
    let mut node = LNode::new(dto.id, style);
    // 文本叶子：金标用 `isText`，宿主可直传 `text`；两者都视为「需要度量」
    if dto.is_text || dto.text.is_some() {
        node.text = Some(crate::node::TextMeasureRequest {
            text: dto.text.clone().unwrap_or_default(),
            style_key: dto.text_style_key.unwrap_or(0),
        });
    }
    // ★原生宿主标记（L3）：布局无影响，但会**回传**给宿主，供其创建原生 View
    node.native_host = dto.native_host;
    if let Some(sem) = &dto.semantic {
        node.tag = sem.clone();
    }
    Ok(node)
}

fn build_tree(req: &LayoutRequest) -> Result<(LayoutTree, Vec<u32>), String> {
    let mut tree = LayoutTree::new();
    let mut index_of: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();

    for dto in &req.nodes {
        let mut node = node_from_dto(dto)?;
        // 文本叶子：金标用 `isText`，宿主可直传 `text`；两者都视为「需要度量」
        if dto.is_text || dto.text.is_some() {
            node.text = Some(crate::node::TextMeasureRequest {
                text: dto.text.clone().unwrap_or_default(),
                style_key: dto.text_style_key.unwrap_or(0),
            });
        }
        // ★原生宿主标记（L3）：布局无影响，但会**回传**给宿主，供其创建原生 View
        node.native_host = dto.native_host;
        if let Some(sem) = &dto.semantic {
            node.tag = sem.clone();
        }
        let idx = tree.push(node);
        index_of.insert(dto.id, idx);
    }

    for dto in &req.nodes {
        if let Some(pid) = dto.parent_id {
            let parent = *index_of.get(&pid).ok_or_else(|| format!("parentId {pid} 不在 nodes 中"))?;
            let child = *index_of.get(&dto.id).ok_or_else(|| format!("id {} 不在 nodes 中", dto.id))?;
            tree.add_child(parent, child);
        }
    }

    let root_ids: Vec<u32> = req.nodes.iter().filter(|n| n.parent_id.is_none()).map(|n| n.id).collect();
    if root_ids.is_empty() {
        return Err("没有根节点（所有节点都有 parentId）".into());
    }
    for r in &root_ids {
        tree.roots.push(index_of[r]);
    }
    // ★★输入图完整性校验（本仓实测血的教训：坏输入曾把真机应用打崩）
    //
    // 【为什么必须有】宿主传来的节点表是**它自己拼的**，一个 id 冲突或自环就会被
    //   taffy 的 `compute_preliminary` 变成**无限递归 → 爆栈 → signal 11（应用闪退）**。
    //   实测案例：适配器里两个 id 分配器各自从 1 开始 ⇒ 请求里出现 `parentId === id`
    //   （自环）⇒ 真机闪退。**布局核心是库，不能因为调用方给错数据就崩掉宿主进程。**
    //
    // 校验三件事（都是 O(n)）：
    //   ① id 唯一（重复 id 会让 index_of 指向错误的节点 ⇒ 树结构错乱）
    //   ② 无自环（`parentId == id`）
    //   ③ 父子图是**森林**（每个节点只有一个父；沿 parent 上溯必然终止）
    //   —— ③ 用「上溯步数不超过节点数」判定，等价于「无环」。
    {
        let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::with_capacity(tree.len());
        for n in &tree.nodes {
            if !seen.insert(n.id) {
                return Err(format!("节点 id 重复：{}（宿主传入了冲突的 id）", n.id));
            }
            if n.parent != crate::node::NO_PARENT && n.parent == (index_of[&n.id]) {
                return Err(format!("节点 {} 的 parent 指向自己（自环）", n.id));
            }
        }
        // ★★④ parent 与 children **双向一致**（本仓新增：`build_taffy` 改按 `children` 顺序连父子）
        //
        // 【为什么必须校验】`build_taffy` 现在**只信 `children`**（那是布局/绘制顺序的单一事实来源，
        //   见其注释）。若某节点的 `parent` 有值但**不在**父的 `children` 里 ⇒ 它会被**静默漏掉**
        //   （不参与布局 ⇒ 几何为零/缺失，且无报错）。⇒ 在校验层把两种表示钉成一致。
        for i in 0..tree.len() {
            let n = &tree.nodes[i];
            if n.parent != crate::node::NO_PARENT {
                let p = n.parent as usize;
                if p >= tree.len() {
                    return Err(format!("节点 {} 的 parent 越界", n.id));
                }
                if !tree.nodes[p].children.iter().any(|&c| c == i as u32) {
                    return Err(format!(
                        "节点 {} 的 parent={} 但不在其 children 里（两种父子表示不一致）",
                        n.id, tree.nodes[p].id
                    ));
                }
            }
            for &c in &n.children {
                let ci = c as usize;
                if ci >= tree.len() {
                    return Err(format!("节点 {} 的 children 含越界索引 {c}", n.id));
                }
                if tree.nodes[ci].parent != i as u32 {
                    return Err(format!(
                        "节点 {} 的 children 含 {}，但后者的 parent 不是它（两种父子表示不一致）",
                        n.id, tree.nodes[ci].id
                    ));
                }
            }
        }

        // 无环性：逐节点上溯，步数不得超过节点总数
        for i in 0..tree.len() {
            let mut cur = tree.nodes[i].parent;
            let mut steps = 0usize;
            while cur != crate::node::NO_PARENT {
                if (cur as usize) >= tree.len() {
                    return Err(format!("节点 {} 的 parent={cur} 越界", tree.nodes[i].id));
                }
                steps += 1;
                if steps > tree.len() {
                    return Err(format!("父子关系存在**环**（从节点 {} 上溯超过 {} 步）——请检查 id 分配是否冲突", tree.nodes[i].id, tree.len()));
                }
                cur = tree.nodes[cur as usize].parent;
            }
        }
    }

    Ok((tree, root_ids))
}

/* ────────────────────────── 对 C 暴露的两个入口 ────────────────────────── */

/// **真机一致性入口**：传入 golden JSON（`tests/golden/browser-layout.json` 的结构），
/// 用本引擎重算并**逐节点与浏览器基准比对**，返回报告 JSON。
///
/// ★为什么这个入口值得存在：它让「浏览器基准真值」这套判据**跟着核心一起上真机**——
///   于是「真机算出的结果与浏览器一致」不再靠推断，而是设备上直接量出来的事实。
///
/// # Safety
/// `golden_json` 必须是有效的 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_conformance(golden_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        if golden_json.is_null() {
            return Err("golden_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(golden_json) }
            .to_str()
            .map_err(|e| format!("golden 非 UTF-8：{e}"))?;
        run_conformance(raw)
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获，避免跨 FFI UB）\"}".to_string()),
    }
}

/// **长列表验收入口**（§9.3）：模拟 4000 行列表的滚动（含**回滚**）过程，
/// 用 Rust 侧复用池 + 状态机跑一遍，返回「复用率 / 内存收敛读数」JSON。
///
/// ★为何在 Rust 侧跑：复用池是**平台无关逻辑**（方案 §1）——它决定「滚动时是否发生堆分配」，
///   而该行为与平台无关、可用纯逻辑精确验证（比在平台侧数 layer 更直接）。
///   平台侧只需按本模块给出的 `to_acquire` / `to_release` 执行动作。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_bench(rows: u32, frames: u32) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        crate::recycle::run_recycle_bench(rows.max(1) as usize, frames.max(1) as usize)
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/* ─────────────── ★★列表复用池（§12.6）：窗口 + 状态机 —— 宿主只执行动作 ─────────────── */
//
// 【为什么必须有这组 FFI（而不是让平台侧自己写一遍）】
//   `recycle.rs` 里的「方向敏感预加载区」与「三档生命周期」是**平台无关逻辑**（方案 §1），
//   且其中「回滚时方向反转要交换前后预加载区」的语义在 Rust 侧已有单测与踩坑记录
//   （初版两分支写成同一组参数 ⇒ 回滚要重建）。
//   平台侧（iOS/Android/鸿蒙）若各写一份 ⇒ 必然分叉，且**分叉是静默的**（只是多建几个对象）。
//   ⇒ 核心只给**决策**（本帧要 acquire 哪些行 / release 哪些行 / 方向是什么），
//     平台侧执行**动作**（取/还实际的 layer 对象）。这正是方案 §12.6「平台侧只需按状态机执行动作」。

/// 复用池句柄的状态：窗口（方向敏感预加载）+ 状态机（三档生命周期）+ 累计读数
struct RecycleEntry {
    window: crate::recycle::ListWindow,
    sm: crate::recycle::ListStateMachine,
    /// 累计 acquire/release 行数（**判据用**：滚动的"搬运量"是否与滚动距离无关）
    acquire_events: usize,
    release_events: usize,
    demote_events: usize,
    updates: usize,
}

static RECYCLE_REGISTRY: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<u64, RecycleEntry>>,
> = std::sync::OnceLock::new();
static NEXT_RECYCLE_HANDLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn recycle_registry() -> &'static std::sync::Mutex<std::collections::HashMap<u64, RecycleEntry>> {
    RECYCLE_REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 创建复用池窗口。`leading_rows`/`following_rows` 传 0 ⇒ 用默认（8 / 2）。
///
/// 返回句柄（0 = 失败：`item_count == 0`）。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_create(
    item_count: u32,
    leading_rows: u32,
    following_rows: u32,
) -> u64 {
    if item_count == 0 {
        return 0;
    }
    let mut cfg = crate::recycle::RecycleConfig::default();
    if leading_rows > 0 {
        cfg.leading_rows = leading_rows as usize;
    }
    if following_rows > 0 {
        cfg.following_rows = following_rows as usize;
    }
    let entry = RecycleEntry {
        window: crate::recycle::ListWindow::new(cfg, item_count as usize),
        sm: crate::recycle::ListStateMachine::new(),
        acquire_events: 0,
        release_events: 0,
        demote_events: 0,
        updates: 0,
    };
    let h = NEXT_RECYCLE_HANDLE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    recycle_registry()
        .lock()
        .map_err(|_| "recycle 注册表锁失败".to_string())
        .and_then(|mut reg| {
            reg.insert(h, entry);
            Ok(h)
        })
        .unwrap_or(0)
}

/// 更新可见区（平台侧每次滚动/布局变化时调用）→ 返回本帧的**动作清单**。
///
/// 出参：`{ok, direction, first_visible, last_visible, first_preload, last_preload,
///        acquire:[行号], release:[行号], demoted, live, acquire_events, release_events}`
///
/// ★★宿主执行顺序（本仓纪律）：**先 release 再 acquire**。
///   反过来的话，本帧要新建的层无法复用**刚释放**的层 ⇒ `created` 虚高、
///   复用率虚低（池的效果被自己吃掉）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_update(
    handle: u64,
    first_visible: u32,
    last_visible: u32,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        let f = first_visible as usize;
        let l = (last_visible as usize).max(f);
        let mut reg = recycle_registry().lock().map_err(|_| "recycle 注册表锁失败".to_string())?;
        let e = reg.get_mut(&handle).ok_or_else(|| format!("recycle 句柄 {handle} 不存在"))?;
        e.window.update_visible(f, l);
        let r = e.window.range();
        // ★顺序：先降级（离开可见区 ⇒ 释放高质量资源），再 diff（谁去谁留）
        let demoted = e.sm.demote_outside_visible(&r);
        let (acquire, release) = e.window.diff(&e.sm.states);
        for &row in &acquire {
            e.sm.on_acquire(row);
        }
        for row in r.first_visible..=r.last_visible {
            e.sm.on_visible(row);
        }
        for &row in &release {
            e.sm.on_release(row);
        }
        e.acquire_events += acquire.len();
        e.release_events += release.len();
        e.demote_events += demoted;
        e.updates += 1;
        let dir = match e.window.direction() {
            crate::recycle::ScrollDirection::Forward => "forward",
            crate::recycle::ScrollDirection::Backward => "backward",
            crate::recycle::ScrollDirection::Idle => "idle",
        };
        Ok(serde_json::json!({
            "ok": true,
            "direction": dir,
            "first_visible": r.first_visible,
            "last_visible": r.last_visible,
            "first_preload": r.first_preload,
            "last_preload": r.last_preload,
            "acquire": acquire,
            "release": release,
            "demoted": demoted,
            "live": e.sm.len(),
            "acquire_events": e.acquire_events,
            "release_events": e.release_events,
            "updates": e.updates,
        })
        .to_string())
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// 读复用池累计读数（诊断/判据用，不改变状态）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_stats(handle: u64) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = recycle_registry().lock().map_err(|_| "recycle 注册表锁失败".to_string())?;
        let e = reg.get(&handle).ok_or_else(|| format!("recycle 句柄 {handle} 不存在"))?;
        let r = e.window.range();
        Ok(serde_json::json!({
            "ok": true,
            "live": e.sm.len(),
            "acquire_events": e.acquire_events,
            "release_events": e.release_events,
            "demote_events": e.demote_events,
            "updates": e.updates,
            "first_preload": r.first_preload,
            "last_preload": r.last_preload,
        })
        .to_string())
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// 销毁复用池句柄。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_destroy(handle: u64) {
    if let Ok(mut reg) = recycle_registry().lock() {
        reg.remove(&handle);
    }
}

/// **真机性能入口**：构建 `node_count` 个节点的列式列表并重复布局，返回耗时统计 JSON。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_bench(node_count: u32, iterations: u32) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> { run_bench(node_count, iterations) });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **通用布局入口**（宿主用）：传入请求 JSON（含 viewport / nodes / textMeasures），返回绝对矩形。
///
/// ★为什么必须有它（本仓实测暴露）：初版只有 `conformance` 与 `bench` 两个入口，
///   而 conformance 内部**内联**了布局逻辑且使用 golden 的 viewport ——
///   结果是 `LayoutRequest.viewport` 字段被构造却从未读取（编译器警告直接指出）。
///   宿主若要跑**自己的**树（真实业务页面）就无处可去。
///   现统一为本函数：conformance / 宿主调用 / 未来平台入口都走它。
///
/// # Safety
/// `request_json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_run(request_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        if request_json.is_null() {
            return Err("request_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(request_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("请求解析失败：{e}"))?;
        let (_tree, abs) = layout_request(&req)?;
        let mut rects = serde_json::Map::new();
        for (i, r) in abs.iter().enumerate() {
            if let Some(r) = r {
                let id = req.nodes[i].id;
                // ★卡 I2：导出边界吸附（宿主可见几何 = 整数逻辑像素；内部保持亚像素）
                let s = crate::snap::snap_rect(*r);
                rects.insert(
                    id.to_string(),
                    serde_json::json!({"x": s.x, "y": s.y, "width": s.width, "height": s.height}),
                );
            }
        }
        Ok(serde_json::json!({"ok": true, "node_count": req.nodes.len(), "rects": rects}).to_string())
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/* ────────────────────────── ★句柄式生命周期 API（树常驻，符合 §5.1 节点树语义） ────────────────────────── */

/// 全局树注册表：handle → LayoutTree
///
/// ★★为什么必须有它（本仓实测暴露的两件事）：
///   ① **架构缺口**：方案 §5.1 的节点树语义是「页面存活期间常驻」，而此前的 FFI
///      （`conformance` / `bench`）都是**用完即弃**——真实 App 无法持有一棵页面树。
///   ② **测量不对等**：内存对比时，原生侧 4051 个 View **持续存活**，
///      而 Proteus 侧的 Rust 树在 `bench()` 返回时就释放了 →
///      相当于拿「渲染完即销毁」对「一直持有」，得到的 0.096 比值是**假象**。
///
///   句柄式 API 让宿主能：`create`（建树并保留）→ 多次 `rects`（读几何）→ `destroy`（释放），
///   与原生 View 树的生命周期**同构**，measurement 才可比。
/// 注册表条目：树 + **id → 索引**缓存
///
/// ★★为什么必须缓存（本机 release 实测）：`proteus_layout_update` 每次都要把补丁的
///   **节点 id** 解析成**数组索引**。初版每次更新都重建这张表（O(n)）——
///   实测 20501 节点要 **3.14ms**，而同一更新的**真正重排只要 0.15ms** ⇒
///   即 **95% 的更新时间花在「查表准备」而非布局**。
///   且这个开销随**整树规模**增长（与增量「只随范围增长」的目标直接矛盾）。
///   树结构在 update 路径上**不变**（本入口只改样式）⇒ 表可缓存、建树时一次性建好。
pub(crate) struct TreeEntry {
    pub(crate) tree: LayoutTree,
    /// 节点 id → 索引（建树时构建一次；update 直接复用）
    pub(crate) id_to_idx: std::collections::HashMap<u32, u32>,
    /// ★★最近一次增量更新**重排过的范围**（V4 二进制返回通道用它限定范围）
    ///
    /// 【为什么必须记（本仓实测的回退）】首版 `proteus_layout_rects_bin` 返回**整棵树**的矩形，
    ///   而 JSON 路径返回的是**变化范围的子树**。于是类A（只改 1 个圆点）也拿到 4003 条
    ///   ⇒ 宿主对 4003 条做排序/可见性过滤 ⇒ `layers` 从 0.06ms **涨到 4.38ms**。
    ///   ⇒ 语义必须与 JSON 路径一致：**只返回重排范围内**的矩形。
    pub(crate) last_scopes: Vec<u32>,
    /// ★★**文本度量表**（节点 id → 尺寸）——由宿主在 `create` 时注入
    ///
    /// 【为什么必须随句柄保存（本仓实测的**静默错几何**缺陷）】文本尺寸不在 style 里，
    ///   而增量重排会**重新度量**范围内的文本叶子（新引擎 ⇒ 度量缓存是空的）。
    ///   此前增量路径用 `NullTextMeasurer`（恒零尺寸）⇒ **任何范围含文本的增量更新
    ///   都会把文本塌成 0 高**（现象：文字消失；首帧正确、更新后错，静态用例发现不了）。
    ///   实测：`增量重排后文本高 0.0（应 19）`。
    ///   ⇒ 度量表必须**随句柄持久化**，并供所有重排引擎使用（update / splice / apply_ops）。
    ///   ★注入新文本的度量走 `proteus_layout_set_text_measures`（或 splice 的 textMeasures）。
    pub(crate) measures: std::collections::HashMap<u32, Size>,
    /// ★★**孤点数**（被摘除但仍在数组里的节点）——内存回收的触发依据
    ///
    /// 【为什么需要它（本仓实测的设计余项）】摘除只**断开父子链**（不搬数组）：
    ///   布局引擎从 `roots` 遍历 ⇒ 孤点自然被跳过 ⇒ **功能正确**。
    ///   但节点体（含 style / String 字段）**留在数组里** ⇒ 长列表反复增删会持续积压。
    ///   本字段累计孤点数，超过阈值时触发 `compact()`（可达性重建，见其注释）。
    pub(crate) orphans: usize,
    /// ★★**指令驱动动画引擎**（RT0，2026-09-30）
    ///
    /// 【为什么随句柄持久化】动画是**跨帧**状态（起始 → 每帧推进 → 结束）。
    ///   若每次 `tick` 重建引擎，动画状态就丢了 ⇒ 必须与树同生命周期。
    ///   ★它与树是**两个对象**（不是树的一部分）：动画只写 style 的绘制字段、不触发布局，
    ///   语义上更接近"宿主侧每帧驱动"，故独立持有。
    pub(crate) anim: crate::anim::AnimEngine,
}

impl TreeEntry {
    fn new(tree: LayoutTree, measures: std::collections::HashMap<u32, Size>) -> Self {
        let mut id_to_idx = std::collections::HashMap::with_capacity(tree.len());
        for (i, n) in tree.nodes.iter().enumerate() {
            id_to_idx.insert(n.id, i as u32);
        }
        Self {
            last_scopes: Vec::new(), measures, tree, id_to_idx, orphans: 0,
            anim: crate::anim::AnimEngine::new() }
    }

    /// ★★**压实**：把可达节点重建进新数组，回收孤点内存（O(存活节点数)）
    ///
    /// 【为什么可以安全重排数组下标（本仓实测的依赖梳理）】本仓**所有外部引用都走稳定 id**：
    ///   · 指令流用 `nodeId`（稳定 id）而**不是**数组下标
    ///   · `last_scopes` / `changed_roots` 存稳定 id
    ///   · `id_to_idx` 是 id→下标的**映射**（下面重建）
    ///   · 引擎的 `taffy_ids` 是"下标→taffy 节点"平行数组 ⇒ 压实后**必须失效重建**
    ///     （长度判据 `taffy_id_len() != tree.len()` 自然覆盖）
    ///   ⇒ 压实只改**内部下标**，对外语义不变。
    ///
    /// 【触发策略（amortized）】由调用方按"孤点 ≥ 下限且 > 存活的一半"触发
    ///   ⇒ 每次压实至少回收一半 ⇒ 均摊 O(1)/次摘除，不会退化成"每次 splice 都 O(n)"。
    ///
    /// - Returns: `(before, after)` 节点数（回收读数）
    pub(crate) fn compact(&mut self) -> (usize, usize) {
        let before = self.tree.len();
        let (mut new_tree, _remap) = crate::node::compact_reachable(&self.tree);
        // 重建 id→下标
        self.id_to_idx = std::collections::HashMap::with_capacity(new_tree.len());
        for (i, n) in new_tree.nodes.iter().enumerate() {
            self.id_to_idx.insert(n.id, i as u32);
        }
        // ★度量表按**稳定 id** 存 ⇒ 与下标无关；顺手清掉已不可达 id 的条目（避免泄漏）
        let idx = self.id_to_idx.clone();
        self.measures.retain(|id, _| idx.contains_key(id));
        std::mem::swap(&mut self.tree, &mut new_tree);
        self.orphans = 0;
        (before, self.tree.len())
    }
}

static TREE_REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<u64, TreeEntry>>> =
    std::sync::OnceLock::new();
static NEXT_HANDLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn registry() -> &'static std::sync::Mutex<std::collections::HashMap<u64, TreeEntry>> {
    TREE_REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// ★★**按句柄的持久布局引擎**（线程局部）
///
/// 【为什么不能放进注册表（编译期即拒）】`TaffyEngine` 含 `taffy::Style`，其中的
///   `CompactLengthInner` 有裸指针 ⇒ **非 `Send`** ⇒ 不能作 `Mutex<HashMap<..>>` 的载荷。
///
/// 【为什么必须"持久"（本仓实测的量化依据）】同形状 2001 节点树的基准
///   （`examples/taffy-floor-bench.rs`）：
///   · 每轮**新建**引擎（= 重建整棵 taffy 树）后求解：**2.96ms**
///   · 复用引擎 + 只同步变更节点：**0.065ms**（**45×**）
///   FFI 三入口（update / apply_ops / splice）此前都 `TaffyEngine::new()`
///   ⇒ **每帧白付一次整树重建**——这是 S4 真机 `relayout` 9–11ms 的主因。
///
/// 【线程约定】本仓 FFI 约定"同一句柄在**同一线程**连续使用"（宿主主线程驱动）；
///   跨线程同时用同一句柄本就不受支持（与 taffy 的限制无关，是既有约定）。
thread_local! {
    static ENGINES: std::cell::RefCell<std::collections::HashMap<u64, TaffyEngine>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

thread_local! {
    /// 侧信道诊断（最近一次 `with_engine` 的引擎状态）——供 update 返回体读出
    static ENGINE_DIAG: std::cell::RefCell<serde_json::Value> =
        std::cell::RefCell::new(serde_json::Value::Null);
}

fn engine_diag() -> serde_json::Value {
    ENGINE_DIAG.with(|d| d.borrow().clone())
}

/// 释放某句柄的引擎（句柄销毁时调用——本仓纪律：句柄销毁必须带走其全部资源）
fn drop_engine(handle: u64) {
    ENGINES.with(|m| {
        m.borrow_mut().remove(&handle);
    });
}

/// ★取/建某句柄的引擎并**同步度量器**（结构变化时重建 taffy 树）
///
/// 两个不变量：
///   · `taffy_id_len() == tree_len`（不等 ⇒ 结构变更 ⇒ 重建，否则求解会与树脱节）
///   · 引擎度量器 == 句柄当前度量表（引擎里的是**快照**；不同步 ⇒ 新文本按旧尺寸算）
fn with_engine<R>(
    handle: u64,
    tree_len: usize,
    measures: &std::collections::HashMap<u32, Size>,
    f: impl FnOnce(&mut TaffyEngine) -> R,
) -> R {
    ENGINES.with(|cell| {
        let mut map = cell.borrow_mut();
        let eng = map.entry(handle).or_insert_with(|| {
            TaffyEngine::new().with_measurer(Box::new(TableTextMeasurer::new(measures.clone())))
        });
        let rebuilt = eng.taffy_id_len() != tree_len;
        let len_before = eng.taffy_id_len();
        if rebuilt {
            *eng = TaffyEngine::new().with_measurer(Box::new(TableTextMeasurer::new(measures.clone())));
        } else {
            eng.set_measurer(Box::new(TableTextMeasurer::new(measures.clone())));
        }
        // ★侧信道诊断（判定"持久引擎是否真的被复用"——归因靠读数，不靠推理）
        let cache_len = eng.measure_cache_len();
        let has_persistent = eng.has_persistent();
        ENGINE_DIAG.with(|d| {
            *d.borrow_mut() = serde_json::json!({
                "rebuilt": rebuilt,
                "taffy_len_before": len_before,
                "tree_len": tree_len,
                "cache_len": cache_len,
                "has_persistent": has_persistent,
            });
        });
        f(eng)
    })
}

/// **建树并保留**（返回句柄；0 = 失败）。
///
/// # Safety
/// `request_json` 须为有效 NUL 结尾 C 字符串。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_create(request_json: *const c_char) -> u64 {
    let r = std::panic::catch_unwind(|| -> Result<u64, String> {
        if request_json.is_null() {
            return Err("request_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(request_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("请求解析失败：{e}"))?;
        let (mut tree, _) = build_tree(&req)?;
        // ★首帧布局**延到下面**用"将成为持久引擎"的那台引擎做（见预建持久树的注释）——
        //   这样只需一次整树求解，且它的 taffy 树与度量缓存都能被后续增量复用。
        let constraint = match (req.viewport.width, req.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        let handle = NEXT_HANDLE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let measures = measure_map(&req);
        // ★★**预建持久树**（本仓实测：消除"首轮更新"的整树重建成本）
        //
        // 【为什么在这里做（真机读数）】首轮增量更新时持久树为空 ⇒ 必须 `build_taffy` 整棵树
        //   + 度量缓存从零积累（真机 V0：**首轮 relayout 18.7ms / measures=6003**，
        //   后续轮 **1.6ms / measures=0** —— 13× 差距全在首轮）。而 `create` 路径
        //   **本来就要建一棵 taffy 树做首帧布局**（上面那句 `engine.layout(...)`）——
        //   把那份树留给后续复用，等于"首帧白送一棵持久树"，首轮更新即刻享到复用收益。
        {
            let mut eng = TaffyEngine::new()
                .with_measurer(Box::new(TableTextMeasurer::new(measures.clone())));
            // `layout` 内部会 `build_taffy` 并把 taffy 树**留在这个引擎里**（persistent_taffy）
            // —— 用与首帧相同的约束再跑一次，代价 = 一次整树求解（本来就是首帧成本）
            let constraint = match (req.viewport.width, req.viewport.height) {
                (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
                (w, _) if w > 0.0 => RootConstraint::loose_width(w),
                _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
            };
            // ★直接在**真树**上跑（不 clone）：几何与本方法上方那次 `engine.layout` **等价**
            //   （同树同约束 ⇒ 确定性结果）⇒ 顺带把正确的几何留在 `tree` 里，无需额外内存
            eng.layout(&mut tree, constraint);   // ← 建 taffy 进引擎 + 首帧几何
            ENGINES.with(|cell| { cell.borrow_mut().insert(handle, eng); });
        }
        registry().lock().map_err(|_| "注册表锁失败".to_string())?
            .insert(handle, TreeEntry::new(tree, measures));
        Ok(handle)
    });
    match r {
        Ok(Ok(h)) => h,
        _ => 0,
    }
}

/// 读句柄对应的绝对矩形（JSON）
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_rects(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let tree = &reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?.tree;
        let abs = tree.absolute_rects();
        let mut rects = serde_json::Map::new();
        for (i, r) in abs.iter().enumerate() {
            if let Some(r) = r {
                rects.insert(
                    tree.nodes[i].id.to_string(),
                    serde_json::json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}),
                );
            }
        }
        // ★回传 native-host 节点清单：宿主据此决定「哪些节点创建原生 View」
        //   （而不是让宿主自己维护一份场景表——那会导致 IR 与宿主不同步）
        let native_hosts: Vec<u32> = tree.nodes.iter().filter(|n| n.native_host).map(|n| n.id).collect();
        Ok(serde_json::json!({
            "ok": true,
            "node_count": tree.len(),
            "native_hosts": native_hosts,
            "rects": rects
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★★**更新节点样式并增量重排**（生产路径的增量入口）。
///
/// 【为什么必须有它（本仓实测定位的瓶颈）】
///   此前宿主每次更新只能 `destroy + create`（**整树重建**）——
///   实测：改 10 个列表项要重发 561KB、重建 1407 个节点的整棵层树。
///   而核心侧**早已实现** `layout_incremental`（带布局边界收敛），只是**没有 FFI 出口**。
///   本条把那个能力接到宿主可用。
///
/// 【入参】`patches` 是 JSON 数组，每项 `{ "id": <节点id>, "style": {<LStyle 字段>} }`。
///   样式字段与 `proteus_layout_create` 的 `nodes[].` 同名字段一致（camelCase）。
///
/// 【返回】`{ ok, applied, relayout_count, measure_calls, measure_hits }`
///   `relayout_count` 是**增量效果的直接读数**（对齐 M1 的 T1/T4 口径）。
///
/// 【★度量语义（2026-09-28 修）】本入口的重排引擎**使用句柄持有的度量表**
///   （建树时注入 + `proteus_layout_set_text_measures` / splice 的 `textMeasures` 追加）。
///   ⇒ 范围内**既有**文本的尺寸保持正确（此前用 `NullTextMeasurer` ⇒ 文本塌成 0 高，
///      属**静默错几何**：本仓实测「增量重排后文本高 0.0（应 19）」，见 `TreeEntry::measures`）。
///   ⚠ 仍存的边界：**改了文本字面量**时，度量表里是该节点**旧文本**的尺寸 ⇒
///     宿主须在该次 update 前调 `proteus_layout_set_text_measures` 注入新尺寸
///     （否则用旧尺寸算：不崩、不塌，但几何偏）。这是**显式接口**，不是隐式猜测。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_update(handle: u64, patches_json: *const c_char) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if patches_json.is_null() {
            return Err("patches_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(patches_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let patches: Vec<StylePatch> = serde_json::from_str(raw).map_err(|e| format!("patch 解析失败：{e}"))?;

        let t_start = std::time::Instant::now();
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let t_lock = t_start.elapsed().as_secs_f64() * 1000.0;
        // ★度量表**先取出来**：下面 `tree` 要可变借用 `entry`，届时不能再借它的字段
        //   （见 TreeEntry::measures——无它则文本在增量重排后塌成 0 高）
        let measures = entry.measures.clone();
        let t_idmap0 = std::time::Instant::now();
        // ★直接借用**缓存的** id→索引表（建树时已建好）
        //   初版每次重建（O(n)）—— 实测 20501 节点 3.14ms，而真正重排仅 0.15ms ⇒ 95% 白花
        let id_to_idx = &entry.id_to_idx;

        // ★先按 id → 索引解析（一次 O(n) 建表，而非每个 patch 都线性扫）
        let t_idmap = t_idmap0.elapsed().as_secs_f64() * 1000.0;

        // ★先把要改的索引算出来（只读 id 表），再取 tree 的可变借用
        let mut targets: Vec<(u32, usize)> = Vec::with_capacity(patches.len());
        for p in &patches {
            if let Some(&idx) = entry.id_to_idx.get(&p.id) {
                targets.push((p.id, idx as usize));
            }
        }
        let tree = &mut entry.tree;
        let mut applied = 0usize;
        // ★**全部**脏节点的索引（不是只有最后一个）——本仓实测的缺陷：多补丁只重排最后一个
        //   ⇒ 其余节点的几何**静默过期**（单补丁用例发现不了；文本批量改 300 行会暴露）
        let mut dirty_ids: Vec<u32> = Vec::with_capacity(targets.len());
        let mut text_updates: Vec<(u32, String)> = Vec::new();
        for (id, idx) in targets {
            // ★按 id 在补丁里找（targets 跳过了未知 id，故不能按下标对齐）
            let Some(p) = patches.iter().find(|q| q.id == id) else { continue };
            // ★★文本更新明细（本仓实测的静默错显示缺陷）：PatchStyle.text 会改
            //   `node.text.text`，而**屏幕上的字在宿主的 CATextLayer.string 上** ⇒
            //   不回报它，改文案后核心几何已变、屏幕还是旧字（几何断言全绿）。
            //   这里用前后比对取"真的变了"（与 ops 路径同口径）。
            let before_text = tree.nodes[idx].text.as_ref().map(|r| r.text.clone());
            p.apply_to(&mut tree.nodes[idx])?;
            let after_text = tree.nodes[idx].text.as_ref().map(|r| r.text.clone());
            if after_text != before_text {
                if let Some(t) = after_text {
                    text_updates.push((id, t));
                }
            }
            tree.nodes[idx].dirty = true;
            applied += 1;
            dirty_ids.push(idx as u32);
        }
        if std::env::var_os("PROTEUS_DEBUG").is_some() {
            eprintln!("[proteus] update handle={handle} patches={} applied={applied}", patches.len());
        }

        // 无有效补丁 → 不重排（避免白跑一次）
        if applied == 0 {
            return Ok(serde_json::json!({
                "ok": true, "applied": 0, "relayout_count": 0,
                "measure_calls": 0, "measure_hits": 0
            }).to_string());
        }

        // ★★多范围增量重排（**每个脏节点各自的重排范围**，不是只重排最后一个）
        //
        // 【为什么改用 relayout_multi（本仓实测的缺陷）】此前只把 `last_dirty` 传给
        //   `layout_incremental` ⇒ 一次 update 带 N 个补丁时，**只有最后一个节点所在范围**
        //   被重排，其余节点的几何**静默过期**（画面与核心不一致，且无任何报错）。
        //   单补丁用例（S2/S4 旧版）恰好发现不了；批量改文本/多补丁更新必然踩到。
        //   relayout_multi 会去除互相嵌套的范围、逐个重排，并回报**变化根**
        //   （平移传播时它含被平移的兄弟 ⇒ 必须用它收集，否则兄弟不被更新）。
        let t_eng0 = std::time::Instant::now();
        // ★★复用**按句柄的持久引擎**（本仓实测：每帧新建 = 重建整棵 taffy 树；
        //   同形状 2001 节点基准 2.96ms → 复用 0.065ms，**45×**）
        // ★统一经 `with_engine`（本仓纪律：同一语义一处实现——此处曾有一份**内联副本**，
        //   它绕过了侧信道诊断 ⇒ 我连续三轮拿不到 `engine_diag`，白查）
        let multi = with_engine(handle, tree.len(), &measures, |eng| {
            crate::ops_apply::relayout_multi_in(eng, tree, &dirty_ids)
        });
        let t_engine_new = t_eng0.elapsed().as_secs_f64() * 1000.0;
        let roots: &[u32] = if multi.changed_roots.is_empty() { &multi.scopes } else { &multi.changed_roots };

        // ★★只返回**变化节点**的绝对矩形（宿主据此只更新那几个 layer，而不是重建整棵层树）
        //
        // 【为什么能只算这几个（正确性依据）】重排范围由**布局边界**决定，
        //   而边界的定义是「对外尺寸与内容无关」⇒ 边界自身及其外部的绝对位置**不变**。
        //   故：变化节点的绝对坐标 = 边界父链的原点（不变，可 O(深度) 算出）
        //       + 子树内的相对累加（只遍历范围子树，O(范围)）。
        //   ⇒ 总代价 O(深度 + 范围)，与整树规模无关。
        //
        // 【诚实边界】若范围退化为根（无边界），这里返回的就是**整树**的矩形
        //   —— 与全量等价，宿主仍能正确处理（只是没有收益）。
        let t_collect0 = std::time::Instant::now();
        let mut changed = serde_json::Map::new();
        for &sc in roots {
            let (pox, poy) = parent_origin_of(tree, sc);
            collect_abs_subtree(tree, sc, pox, poy, &mut changed);
        }
        let t_collect = t_collect0.elapsed().as_secs_f64() * 1000.0;
        // 整树矩形仍可经 proteus_layout_rects 取（兼容）；此处只给变化集
        // `scope_id` 保留（既有测试与调用方读它）——取**首个**范围；多范围见 `scopes`
        let text_updates_json: serde_json::Value = serde_json::Value::Object(
            text_updates.iter().map(|(id, t)| (id.to_string(), serde_json::json!(t))).collect(),
        );
        Ok(serde_json::json!({
            "ok": true,
            "applied": applied,
            "relayout_count": multi.relayout_count,
            "measure_calls": multi.measure_calls,
            "measure_hits": multi.measure_hits,
            "scope_id": roots.first().map(|&i| tree.get(i).id),
            "scopes": multi.scopes,
            "changed_roots": multi.changed_roots,
            "text_updates": text_updates_json,
            "changed_count": changed.len(),
            "rects": changed,
            // ★分段计时（诊断用：定位剩下的 cost 在哪一段）
            "_timing": {
                "lock_ms": (t_lock * 100.0).round() / 100.0,
                "idmap_ms": (t_idmap * 100.0).round() / 100.0,
                "engine_and_relayout_ms": (t_engine_new * 100.0).round() / 100.0,
                "collect_changed_ms": (t_collect * 100.0).round() / 100.0,
                "total_ms": (t_start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0,
                // ★引擎内部分段（判定"是否真的走了持久树 / 缓存是否命中"——归因靠读数）
                "engine_diag": engine_diag(),
                "phases": multi.phases.iter()
                    .map(|(k, v)| (k.to_string(), serde_json::json!((*v * 100.0).round() / 100.0)))
                    .collect::<serde_json::Map<String, serde_json::Value>>(),
            },
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// 计算某节点**父链原点之和**（O(深度)）——即「传给它父级的那个原点」
///
/// ★坐标约定回顾（与 `LayoutTree::absolute_rects` 同）：节点的 `rect.x` 是**相对父**的，
///   故绝对 x = 从根到该节点**所有祖先**的 `rect.x` 之和 + 自身的 `rect.x`。
///   本函数返回**不含自身**的那部分（= 父级原点），供子树遍历逐层累加。
pub(crate) fn parent_origin_of(tree: &LayoutTree, idx: u32) -> (f32, f32) {
    let mut chain: Vec<u32> = Vec::with_capacity(8);
    let mut cur = tree.get(idx).parent;
    let mut guard = 0usize;
    while cur != crate::node::NO_PARENT && guard <= tree.len() {
        chain.push(cur);
        cur = tree.get(cur).parent;
        guard += 1;
    }
    let (mut ox, mut oy) = (0.0f32, 0.0f32);
    for &n in chain.iter().rev() {
        let r = tree.get(n).rect;
        ox += r.x;
        oy += r.y;
    }
    (ox, oy)
}

/// 遍历范围子树，产出「**绝对**矩形」表（只覆盖该子树 ⇒ O(范围)）
pub(crate) fn collect_abs_subtree(
    tree: &LayoutTree,
    idx: u32,
    parent_ox: f32,
    parent_oy: f32,
    out: &mut serde_json::Map<String, serde_json::Value>,
) {
    let node = tree.get(idx);
    if node.style.display == crate::style::Display::None {
        return;      // 无盒：不下钻（与 absolute_rects 同规则）
    }
    let r = node.rect;
    let abs_x = parent_ox + r.x;
    let abs_y = parent_oy + r.y;
    // ★卡 I2：导出边界吸附 —— 与 `proteus_layout_rects` **同一把尺子**
    //   （否则「变化集」与「全量集」会在同一条边上差 ≤0.5px ⇒ 宿主更新出 1px 抖）
    //   ★下钻仍用**未吸附**的 abs_x/abs_y 累加：吸附只作用于导出值，不改变遍历语义
    let s = crate::snap::snap_rect(crate::style::Rect { x: abs_x, y: abs_y, width: r.width, height: r.height });
    out.insert(
        node.id.to_string(),
        serde_json::json!({"x": s.x, "y": s.y, "width": s.width, "height": s.height}),
    );
    for &c in &node.children {
        collect_abs_subtree(tree, c, abs_x, abs_y, out);
    }
}

/// 样式补丁（只带要改的字段；缺省 = 不改）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StylePatch {
    id: u32,
    #[serde(default)]
    style: PatchStyle,
}

/// 可增量修改的样式字段子集（★只放**布局相关**字段：绘制属性不影响几何，改它们无需重排）
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct PatchStyle {
    width: Option<Option<f32>>,
    height: Option<Option<f32>>,
    flex_grow: Option<f32>,
    flex_shrink: Option<f32>,
    flex_basis: Option<Option<f32>>,
    gap: Option<f32>,
    display: Option<String>,
    margin: Option<EdgesDto>,
    padding: Option<EdgesDto>,
    #[serde(default)]
    text: Option<String>,
}

impl StylePatch {
    fn apply_to(&self, node: &mut LNode) -> Result<(), String> {
        let s = &self.style;
        // ★`Option<Option<f32>>` 语义：外层 None = 不改；内层 None = 显式置空（回到 auto）
        if let Some(w) = s.width { node.style.width = w; }
        if let Some(h) = s.height { node.style.height = h; }
        if let Some(g) = s.flex_grow { node.style.flex_grow = g; }
        if let Some(sh) = s.flex_shrink { node.style.flex_shrink = sh; }
        if let Some(b) = s.flex_basis { node.style.flex_basis = b; }
        if let Some(g) = s.gap { node.style.gap = g; }
        if let Some(d) = &s.display {
            node.style.display = match d.as_str() {
                "none" => crate::style::Display::None,
                "flex" => crate::style::Display::Flex,
                other => return Err(format!("未知 display：{other}")),
            };
        }
        if let Some(m) = &s.margin {
            node.style.margin = Edges { top: m.top, right: m.right, bottom: m.bottom, left: m.left };
        }
        if let Some(p) = &s.padding {
            node.style.padding = Edges { top: p.top, right: p.right, bottom: p.bottom, left: p.left };
        }
        // 文本字面量变更（内容变了 → 度量缓存按内容寻址会自动区分，无需手动失效）
        if let Some(t) = &s.text {
            if let Some(req) = node.text.as_mut() {
                req.text = t.clone();
            } else {
                node.text = Some(crate::node::TextMeasureRequest { text: t.clone(), style_key: 0 });
            }
        }
        Ok(())
    }
}

/// **命中测试**：屏幕坐标 → 节点（方案 §M3「事件系统 / 手势」的几何地基）。
///
/// 返回 `{ ok, target, path, chain }`（`target = null` 表示未命中）——三端共用同一实现，
/// 保证「同一份 IR 在 Android/iOS/鸿蒙点到的节点一致」。
///
/// 【为什么跨界返回整条链而不是只返回 target】
///   宿主派发事件需要的是**冒泡链**（DOM 语义：事件沿祖先链传播，无论祖先是否在点上）。
///   两个语义必须分开（本仓 `hit.rs` 模块头注释详述）：
///     · `path`  = 几何上被点到的节点（自上层到根）——验证/调试用
///     · `chain` = target + 全部祖先（纯结构）——**事件派发用**
///   子级溢出父盒时二者不同（父不在点上，但仍是冒泡目标）——只返回 target 会让宿主算错。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_hit_test(handle: u64, x: f32, y: f32) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let tree = &reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?.tree;
        // ★★卡 I2：宿主路径用**吸附几何**做命中 —— 与绘制坐标（导出的整数逻辑像素）同源。
        //   若这里用亚像素几何，视觉边界与可点边界会差 ≤0.5px（"看着在这、点下去在那"）。
        //   ★内核测试/conformance（对浏览器 golden）仍直接用 `hit_path`（未吸附）——
        //     那是"与浏览器浮点语义对齐"的判据，与宿主可见几何是两回事（见 hit.rs 注释）。
        let geo = crate::hit::geometry_snapped(tree);
        let res = crate::hit::hit_result_with(tree, x, y, &geo);
        let ids = |v: &Vec<crate::node::NodeIndex>| -> Vec<u32> { v.iter().map(|&i| tree.get(i).id).collect() };
        Ok(serde_json::json!({
            "ok": true,
            "target": res.target.map(|i| tree.get(i).id),
            "path": ids(&res.path),
            "chain": ids(&res.chain),
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **从二进制 blob 建树**（★生产入口：方案 M0 计划「非 JSON，避免运行时解析开销」）。
///
/// 【为什么需要它（本仓实测的量化依据）】
///   iOS 真机 4051 节点：`create`（JSON）= 75.84ms，其中 95%+ 是 serde 解析 + 建树；
///   而**纯布局仅 ~2ms**。⇒ 通道成本必须靠二进制消除。
///
/// # Safety
/// `ptr` 须指向 `len` 字节的有效 buffer（由 `proteus_layout_json_to_blob` 产出，或编译器生成）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_create_blob(ptr: *const u8, len: u32) -> u64 {
    let r = std::panic::catch_unwind(|| -> Result<u64, String> {
        if ptr.is_null() || len == 0 {
            return Err("blob 指针为空或长度为 0".into());
        }
        let buf = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
        let req = crate::blob::decode(buf).map_err(|e| e.to_string())?;
        // ── 与 `proteus_layout_create` 相同的建树路径（保证两条入口语义等价）──
        let (mut tree, _) = build_tree(&req)?;
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(&req)));
        let constraint = match (req.viewport.width, req.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        engine.layout(&mut tree, constraint);
        let handle = NEXT_HANDLE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        registry().lock().map_err(|_| "注册表锁失败".to_string())?
            .insert(handle, TreeEntry::new(tree, measure_map(&req)));
        Ok(handle)
    });
    match r {
        Ok(Ok(h)) => h,
        _ => 0,
    }
}

/// **JSON → blob 编码**（过渡入口：让存量调用方也能享受二进制通道）。
///
/// 生产路径应由**编译器直接产出 blob**（M0 计划），本入口用于验证与迁移期。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_blob_free` 释放。
/// `out_len` 非空时写入 blob 字节数。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_json_to_blob(json: *const c_char, out_len: *mut u32) -> *mut u8 {
    let r = std::panic::catch_unwind(|| -> Result<Vec<u8>, String> {
        if json.is_null() {
            return Err("json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(json) }.to_str().map_err(|e| format!("非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("解析失败：{e}"))?;
        Ok(crate::blob::encode(&req))
    });
    match r {
        Ok(Ok(mut v)) => {
            let len = v.len() as u32;
            if !out_len.is_null() {
                unsafe { *out_len = len };
            }
            let ptr = v.as_mut_ptr();
            std::mem::forget(v);   // ★所有权交给调用方（由 proteus_blob_free 释放）
            ptr
        }
        _ => {
            if !out_len.is_null() {
                unsafe { *out_len = 0 };
            }
            std::ptr::null_mut()
        }
    }
}

/// **释放 blob**（必须用它释放 `proteus_layout_json_to_blob` 的返回值）
///
/// # Safety
/// `ptr`/`len` 必须来自 `proteus_layout_json_to_blob` 且尚未释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_blob_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // ★用与分配时相同的布局重建 Vec（capacity 可能 > len，但 `Vec::from_raw_parts` 要求
    //   capacity 一致；`encode` 返回的 Vec 是精确的（extend 到最后），故 len 即 capacity 的上界。
    //   为安全起见用 `shrink_to_fit` 语义不可用（已 forget），故按 len 重建——
    //   这在 Rust 的 Global allocator 下是 UB 风险点，见下方说明。
    //   ★实际做法：`proteus_layout_json_to_blob` 内部已保证 `v.len() == v.capacity()`（见其实现），
    //     故此处可安全重建。
    unsafe {
        drop(Vec::from_raw_parts(ptr, len as usize, len as usize));
    }
}

/// **分解计时诊断**：分别测量「解码 / 建树 / 布局」三段（供性能归因；生产不用）。
///
/// 存在的理由：iOS 真机 `create` 达 76ms，而本机 release 的 JSON 解析仅 1.45ms
/// → **必须实测分解**才能定位（不能靠推断）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_profile(json: *const c_char, use_blob: bool) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if json.is_null() {
            return Err("json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(json) }.to_str().map_err(|e| format!("非 UTF-8：{e}"))?;

        let t0 = std::time::Instant::now();
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("解析失败：{e}"))?;
        let decode_json_ms = t0.elapsed().as_secs_f64() * 1000.0;

        let t1 = std::time::Instant::now();
        let blob = crate::blob::encode(&req);
        let encode_blob_ms = t1.elapsed().as_secs_f64() * 1000.0;

        let t2 = std::time::Instant::now();
        let req2 = crate::blob::decode(&blob).map_err(|e| e.to_string())?;
        let decode_blob_ms = t2.elapsed().as_secs_f64() * 1000.0;

        let effective = if use_blob { &req2 } else { &req };

        let t3 = std::time::Instant::now();
        let (mut tree, _) = build_tree(effective)?;
        let build_ms = t3.elapsed().as_secs_f64() * 1000.0;

        let t4 = std::time::Instant::now();
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(effective)));
        let constraint = match (effective.viewport.width, effective.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        engine.layout(&mut tree, constraint);
        let layout_ms = t4.elapsed().as_secs_f64() * 1000.0;

        Ok(serde_json::json!({
            "ok": true,
            "nodes": effective.nodes.len(),
            "blob_bytes": blob.len(),
            "json_bytes": raw.len(),
            "decode_json_ms": (decode_json_ms * 100.0).round() / 100.0,
            "encode_blob_ms": (encode_blob_ms * 100.0).round() / 100.0,
            "decode_blob_ms": (decode_blob_ms * 100.0).round() / 100.0,
            "build_tree_ms": (build_ms * 100.0).round() / 100.0,
            "layout_ms": (layout_ms * 100.0).round() / 100.0,
            "measured_with": if use_blob { "blob" } else { "json" }
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **释放句柄**（宿主在页面销毁时调用）
#[no_mangle]
pub extern "C" fn proteus_layout_destroy(handle: u64) -> bool {
    let r = std::panic::catch_unwind(|| -> bool {
        registry().lock().map(|mut m| m.remove(&handle).is_some()).unwrap_or(false)
    });
    r.unwrap_or(false)
}

/// 当前存活的树数量（诊断/验收：确认 destroy 真的释放了）
#[no_mangle]
pub extern "C" fn proteus_layout_handle_count() -> u32 {
    registry().lock().map(|m| m.len() as u32).unwrap_or(0)
}

/* ────────────────────────── 实现（与 FFI 解耦，便于单测） ────────────────────────── */

/// ★唯一的布局执行路径：`LayoutRequest` → （树, 绝对矩形）
///
/// 所有入口（conformance / 宿主 / 未来平台）都必须走这里——
/// 保证「测试验证的路径」与「宿主使用的路径」是同一条。
fn layout_request(req: &LayoutRequest) -> Result<(LayoutTree, Vec<Option<crate::style::Rect>>), String> {
    let (mut tree, _) = build_tree(req)?;
    let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(req)));
    // ★viewport 在这里被真正使用（此前是构造了但没人读）
    let constraint = match (req.viewport.width, req.viewport.height) {
        (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
        (w, _) if w > 0.0 => RootConstraint::loose_width(w),
        _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
    };
    engine.layout(&mut tree, constraint);
    let abs = tree.absolute_rects();
    Ok((tree, abs))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFile {
    viewport: GoldenViewport,
    // 只取用得到的字段；其余由 serde 忽略
    #[serde(default)]
    tolerance: f32,
    cases: Vec<GoldenCase>,
}

#[derive(serde::Deserialize)]
struct GoldenViewport {
    width: f32,
    height: f32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCase {
    name: String,
    nodes: Vec<NodeDto>,
    #[serde(rename = "textMeasures", default)]
    text_measures: std::collections::HashMap<String, SizeDto>,
    rects: std::collections::HashMap<String, RectOutIn>,
}

#[derive(serde::Deserialize, Clone, Copy)]
struct RectOutIn {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(serde::Serialize)]
struct ConformanceReport {
    ok: bool,
    cases: usize,
    compared_nodes: usize,
    max_delta_dp: f32,
    tolerance_dp: f32,
    failures: Vec<String>,
    /// ★★**几何指纹**（2026-10-01 加：跨端一致性的机器判据）
    ///
    /// 【为什么需要它（收"跨端视觉一致性"这条诚实边界的可判定部分）】此前双端各自跑
    ///   `run_conformance` 对**浏览器基准**（`max_delta_dp ≤ 0.375`），但那是**两条独立的
    ///   对基准的距离**——"A 距基准 0.3、B 距基准 0.3"**不能推出"A 与 B 相同"**
    ///   （两者可以朝相反方向偏）。⇒ 加本字段：对**同一份 golden**，双端各自算一个
    ///   覆盖全部 compared 矩形（x/y/w/h 的 **f32 位模式**）的 FNV-1a 哈希；
    ///   两端**指纹相同** ⇔ 它们的几何逐字节一致（比"距基准各自达标"强得多）。
    ///
    /// 【为什么用位模式而不是格式化数值】响应"三端差 1px"的关键在于**没有任何一处再做舍入**；
    ///   位模式比对连 `0.1 + 0.2` 级别的末位差异也能抓到（格式化会掩盖它）。
    ///   ★诚实边界：本指纹只覆盖**布局几何**（rects）——"画出来一样"还取决于光栅化
    ///   （圆角裁剪/阴影/文本基线），那部分靠 conformance + 浏览器真值兜底，不在本字段声称内。
    geometry_digest: String,
}

/// 几何指纹：FNV-1a 64 位，逐值吃 **f32 小端字节**（顺序 = 遍历顺序：case → 节点 → x/y/w/h）
///
/// 【为什么自实现而不引哈希库】内核不引新依赖（体积/审计面）；FNV-1a 十行即可，
///   且这里只要**稳定 + 敏感**（非抗碰撞）——两端跑同一段代码，不需要抗碰撞强度。
fn geometry_digest_update(hash: &mut u64, v: f32) {
    const FNV_PRIME: u64 = 0x100000001b3;
    for b in v.to_le_bytes() {
        *hash ^= b as u64;
        *hash = hash.wrapping_mul(FNV_PRIME);
    }
}

pub fn run_conformance(raw: &str) -> Result<String, String> {
    let golden: GoldenFile = serde_json::from_str(raw).map_err(|e| format!("golden 解析失败：{e}"))?;
    let tolerance = if golden.tolerance > 0.0 { golden.tolerance } else { 0.5 };

    let mut compared = 0usize;
    let mut max_delta = 0f32;
    let mut failures: Vec<String> = Vec::new();
    // ★指纹累积（顺序确定：golden.cases 的顺序 × 每 case 内 tree.nodes 的顺序 × x/y/w/h）
    let mut digest: u64 = 0xcbf29ce484222325; // FNV-1a offset basis

    for case in &golden.cases {
        let req = LayoutRequest { viewport: ViewportDto { width: golden.viewport.width, height: golden.viewport.height }, nodes: case.nodes.clone(), text_measures: case.text_measures.clone() };
        // ★走**通用布局入口**（而不是内联重复一遍）——这样 conformance 与宿主调用共享同一条代码路径，
        //   避免「测试通过但宿主路径不同」的隐患（本仓实测：初版内联时 viewport 字段被构造却从未读取）
        let (tree, abs) = layout_request(&req)?;
        let hidden: Vec<u32> = case.nodes.iter().filter(|n| n.display.as_deref() == Some("none")).map(|n| n.id).collect();
        for (i, node) in tree.nodes.iter().enumerate() {
            if hidden.contains(&node.id) {
                continue;
            }
            let Some(expect) = case.rects.get(&node.id.to_string()) else {
                continue;
            };
            let Some(actual) = abs[i] else {
                failures.push(format!("[{}] #{} 引擎未产出矩形", case.name, node.id));
                continue;
            };
            compared += 1;
            // ★指纹只吃**引擎算出**的值（不含浏览器期望值——那才代表"本端几何"）
            for v in [actual.x, actual.y, actual.width, actual.height] {
                geometry_digest_update(&mut digest, v);
            }
            for (prop, a, e) in [
                ("x", actual.x, expect.x),
                ("y", actual.y, expect.y),
                ("w", actual.width, expect.width),
                ("h", actual.height, expect.height),
            ] {
                let d = (a - e).abs();
                if d > max_delta {
                    max_delta = d;
                }
                if d > tolerance {
                    failures.push(format!("[{}] #{} .{}: 引擎 {:.2} vs 浏览器 {:.2}", case.name, node.id, prop, a, e));
                }
            }
        }
    }

    let report = ConformanceReport {
        ok: failures.is_empty(),
        cases: golden.cases.len(),
        compared_nodes: compared,
        max_delta_dp: max_delta,
        tolerance_dp: tolerance,
        failures: failures.iter().take(20).cloned().collect(),
        geometry_digest: format!("{digest:016x}"),
    };
    serde_json::to_string(&report).map_err(|e| format!("报告序列化失败：{e}"))
}

/// 请求里的 `textMeasures`（字符串 id → 尺寸）→ **id 化的度量表**
///
/// ★为什么要有 id 化的那份：度量表要**随句柄持久化**（见 `TreeEntry::measures`），
///   而 `LayoutRequest` 的形态是字符串键（JSON 天然如此）。
fn measure_map(req: &LayoutRequest) -> std::collections::HashMap<u32, Size> {
    let mut m = std::collections::HashMap::with_capacity(req.text_measures.len());
    for (k, v) in &req.text_measures {
        if let Ok(id) = k.parse::<u32>() {
            m.insert(id, Size { width: v.width, height: v.height });
        }
    }
    m
}

fn to_measurer(req: &LayoutRequest) -> TableTextMeasurer {
    TableTextMeasurer::new(measure_map(req))
}

#[derive(serde::Serialize)]
struct BenchReport {
    ok: bool,
    node_count: usize,
    iterations: usize,
    median_ms: f64,
    min_ms: f64,
    max_ms: f64,
    /// 每次布局的测量调用数（D3 判据的可观测读数）
    measure_calls_first: usize,
}

pub fn run_bench(node_count: u32, iterations: u32) -> Result<String, String> {
    if node_count == 0 {
        return Err("node_count 需 > 0".into());
    }
    let iters = iterations.max(1) as usize;

    // 构造：根(column) → 若干行(row) → 每行若干定尺寸叶子（贴近 M2 的 4050 元素场景）
    let per_row = 50u32;
    let rows = node_count.div_ceil(per_row).max(1);
    let mut tree = LayoutTree::new();

    let root_style = LStyle { width: Some(750.0), flex_direction: FlexDirection::Column, ..Default::default() };
    let root_idx = tree.push(LNode::new(1, root_style));

    let mut next_id = 2u32;
    let mut created = 1usize;
    for _ in 0..rows {
        if created >= node_count as usize {
            break;
        }
        let mut row_style = LStyle { flex_direction: FlexDirection::Row, gap: 4.0, ..Default::default() };
        row_style.flex_shrink = 0.0;
        let row_idx = tree.push(LNode::new(next_id, row_style));
        next_id += 1;
        created += 1;
        tree.add_child(root_idx, row_idx);

        for _ in 0..per_row {
            if created >= node_count as usize {
                break;
            }
            let leaf_style = LStyle { width: Some(40.0), height: Some(16.0), flex_shrink: 0.0, ..Default::default() };
            let leaf_idx = tree.push(LNode::new(next_id, leaf_style));
            next_id += 1;
            created += 1;
            tree.add_child(row_idx, leaf_idx);
        }
    }
    tree.roots.push(root_idx);

    let constraint = RootConstraint::loose_width(750.0);
    let mut engine = TaffyEngine::new();

    // 预热（排除首次分配）
    let first = engine.layout(&mut tree, constraint);

    let mut samples: Vec<f64> = Vec::with_capacity(iters);
    for _ in 0..iters {
        let t0 = std::time::Instant::now();
        engine.layout(&mut tree, constraint);
        samples.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = samples[samples.len() / 2];

    let report = BenchReport {
        ok: true,
        node_count: tree.len(),
        iterations: iters,
        median_ms: (median * 1000.0).round() / 1000.0,
        min_ms: (samples[0] * 1000.0).round() / 1000.0,
        max_ms: (samples[samples.len() - 1] * 1000.0).round() / 1000.0,
        measure_calls_first: first.measure_calls,
    };
    serde_json::to_string(&report).map_err(|e| format!("报告序列化失败：{e}"))
}

/// 极简 JSON 字符串转义（错误信息用；不引入额外依赖）
///
/// ★HA2：由 `pub(crate)` 改 `pub` —— 平台绑定层（`platform/android/proteus-jni`）用它组装
///   错误 JSON。这比原来"靠 `#[cfg(target_os)] pub(crate) use` 转出"更诚实：内核只是**公开**了
///   一个诊断工具，而不再因为"某个平台的绑定层住在自己家里"而带平台分支。
pub fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// ★★Vapor IR V3 —— **应用二进制指令流**（一次调用完成：解码 → 应用 → 多范围增量重排）
///
/// 【与 `proteus_layout_update` 的分工】
///   · `proteus_layout_update`：JSON 补丁（`[{id, style}]`）——兼容路径，需文本解析
///   · 本函数：**二进制指令流**（V1 编码）——顺序读 + 定长字段，无字符扫描
///     本仓实测：4051 节点场景「布局耗时」95%+ 是 JSON 通道成本 ⇒ 每帧走的路径必须免解析。
///
/// 【★为什么需要它（V3 补的真缺口）】既有 update 只对**最后一个**脏节点重排；
///   而批量指令天然涉及多个节点（一帧 N 个槽位直写）⇒ 其余节点几何会**静默过期**。
///   本入口用 `ops_apply::relayout_multi`：多脏节点 → 若干互不嵌套的范围 → 各自重排。
///
/// # Safety
/// `ptr` 须指向 `len` 字节的有效 buffer（由 TS 侧 `encodeOps` 产出）。
/// 返回指针须用 `proteus_layout_free_string` 释放。
/* ────────────────────── ★★V7：结构性变更（插/删子树） ────────────────────── */

/// 结构变更请求（**JSON**——与热路径的二进制指令流**刻意分开**）
///
/// 【为什么结构变更走 JSON 而不复用二进制指令流（本仓的取舍）】
///   指令流的格式是**定长字段**（为免每帧文本解析而设计）；而结构变更要携带
///   **节点描述符**（tag/style/text 等变长内容）⇒ 塞进定长流会破坏其设计目标。
///   而结构变更本身是**偶发**的（用户增删行），不是每帧 ⇒ JSON 的解析成本可接受。
///   ⇒ 热路径（样式/文本更新）用二进制，结构变更用 JSON——**按频率选通道**。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpliceRequest {
    /// 要摘除的**子树根** id（其子孙随之不可达；★不需要逐个列出子孙）
    #[serde(default)]
    pub(crate) removes: Vec<u32>,
    /// 要插入的块（每个块 = 一棵平铺的子树 + 落点）
    #[serde(default)]
    pub(crate) inserts: Vec<SpliceInsert>,
    /// ★**新增文本的度量**（节点 id → 尺寸）——宿主度量后随请求注入
    ///
    /// 【为什么必须在请求里带上（本仓实测的静默错几何缺陷）】插入的行**必然含文本**，
    ///   而文本尺寸只能由宿主度量（CoreText/StaticLayout）。若不带 ⇒ 新文本无度量。
    ///   本字段有两件事要同时做：① 供本次重排度量，② **并入句柄的度量表**——
    ///   之后任何增量重排（update / apply_ops / 再次 splice）才能继续量到它。
    ///   实测症状（不带时）：新插入行的文本高 0 ⇒ 文字不可见，而几何报告里"结构对了"。
    #[serde(default)]
    pub(crate) text_measures: std::collections::HashMap<String, SizeDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpliceInsert {
    /// 落点父节点 id（`null` ⇒ 作为新根）
    pub(crate) parent_id: Option<u32>,
    /// 插入到父的**第几个子位**（缺省 = 追加到末尾）
    pub(crate) index: Option<usize>,
    /// 子树节点（平铺，**父在前**；块内 parentId 指向块内父节点或 `parent_id`）
    pub(crate) nodes: Vec<NodeDto>,
}

/// ★★**结构变更**：插入/摘除子树（App 端自绘路径的「增删行」）
///
/// 【为什么必须有它（本仓实测的功能缺口）】此前核心**完全没有**结构变更入口——
///   增删行只能靠**重发整棵树**（真机实测 S5：500→600 项 **230ms**，几乎全是搬运成本）。
///   而增删行在长列表里是**最常见**的交互（加载更多 / 删除一行）。
///
/// 【设计要点】
///   · **摘除**只断开父子链（不搬数组）——布局引擎从 `tree.roots` 遍历 ⇒ 孤点自然被跳过；
///     节点留在数组里是安全的（若未来要复用其内存，届时再加回收）。
///   · **插入**复用 `node_from_dto`（与建树**同一实现**，避免样式字段漏项）。
///   · 落点用 `(parentId, index)`——与 DOM/`insertBefore` 语义一致，宿主无需算锚点。
///
/// # Safety
/// `splice_json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_splice(handle: u64, splice_json: *const c_char) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if splice_json.is_null() {
            return Err("splice_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(splice_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let req: SpliceRequest = serde_json::from_str(raw).map_err(|e| format!("splice 解析失败：{e}"))?;

        let t0 = std::time::Instant::now();
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let t_lock = t0.elapsed().as_secs_f64() * 1000.0;

        let mut dirty_roots: Vec<u32> = Vec::new();

        // ── ① 摘除（只断链；孤点由 roots 遍历自然跳过）──
        let mut removed = 0usize;
        for &rid in &req.removes {
            let Some(&idx) = entry.id_to_idx.get(&rid) else {
                return Err(format!("removes 里的 id {rid} 不在树上"));
            };
            let parent = entry.tree.get(idx).parent;
            // 从映射里摘掉**整棵子树**（否则后续指令/结构变更还能打到它们）
            let mut stack = vec![idx];
            while let Some(i) = stack.pop() {
                let nid = entry.tree.get(i).id;
                entry.id_to_idx.remove(&nid);
                // ★度量条目一并清（节点已不在树上 ⇒ 留着是纯泄漏；且若未来 id 复用会串味）
                entry.measures.remove(&nid);
                entry.orphans += 1;   // ★计入孤点（节点体仍在数组里，待压实回收）
                for &c in &entry.tree.get(i).children.clone() {
                    stack.push(c);
                }
            }
            if parent != NO_PARENT {
                entry.tree.nodes[parent as usize].children.retain(|&c| c != idx);
                entry.tree.nodes[parent as usize].dirty = true;
                dirty_roots.push(parent);
            } else {
                entry.tree.roots.retain(|&x| x != idx);
            }
            entry.tree.nodes[idx as usize].parent = NO_PARENT;
            removed += 1;
        }

        // ── ② 插入（复用建树同一转换 ⇒ 字段不漏）──
        let mut inserted = 0usize;
        for ins in &req.inserts {
            if ins.nodes.is_empty() {
                continue;
            }
            // 建块内索引（父在前 ⇒ 一遍即可链接）
            let mut local: Vec<NodeIndex> = Vec::with_capacity(ins.nodes.len());
            let mut by_id: std::collections::HashMap<u32, NodeIndex> = std::collections::HashMap::new();
            for dto in &ins.nodes {
                if entry.id_to_idx.contains_key(&dto.id) || by_id.contains_key(&dto.id) {
                    return Err(format!("插入的 id {} 与树上已有节点冲突", dto.id));
                }
                let node = node_from_dto(dto)?;
                let i = entry.tree.push(node);
                entry.id_to_idx.insert(dto.id, i);
                by_id.insert(dto.id, i);
                local.push(i);
            }
            // 链接：块内父优先；parentId 不在块内 ⇒ 视为挂到落点（块根）
            let mut block_roots: Vec<NodeIndex> = Vec::new();
            for &i in &local {
                let dto_pid = ins.nodes.iter().find(|d| by_id.get(&d.id) == Some(&i)).and_then(|d| d.parent_id);
                match dto_pid {
                    Some(pid) if by_id.contains_key(&pid) => {
                        let p = by_id[&pid];
                        entry.tree.add_child(p, i);
                    }
                    _ => block_roots.push(i),
                }
            }
            // 挂到落点
            match ins.parent_id {
                Some(pid) => {
                    let Some(&p) = entry.id_to_idx.get(&pid) else {
                        return Err(format!("落点 parentId {pid} 不在树上"));
                    };
                    // ★★落点 `index`：**支持中间插入**（2026-09-28 解禁；此前显式拒绝）
                    //
                    // 【为什么以前只能追加】`build_taffy` 按 `tree.nodes` 的**数组顺序**连父子
                    //   ⇒ 数组序即布局序 ⇒ 插中间要搬数组（O(n) 且 `taffy_ids` 索引对齐会乱）。
                    // 【现在为什么可以】`build_taffy` 已改为**只信 `children` 顺序**
                    //   （单一事实来源；`parent`↔`children` 一致性由输入图校验强制）
                    //   ⇒ 插入 = 在父的 `children` 里 `insert(at, r)`（**O(块大小)**，不搬数组）。
                    //   ★与 DOM/`insertBefore` 语义一致：`index` 是该父的**子位序号**（0-based）。
                    let cur_len = entry.tree.get(p).children.len();
                    let at = ins.index.unwrap_or(cur_len);
                    if at > cur_len {
                        return Err(format!(
                            "index={at} 越界（父 {} 当前 {cur_len} 个子节点）",
                            entry.tree.get(p).id
                        ));
                    }
                    // 块内顺序保持（`block_roots` 已按 dto 出现顺序）——逐个插在同一位之后
                    for (k, &r) in block_roots.iter().enumerate() {
                        entry.tree.nodes[r as usize].parent = p;
                        entry.tree.nodes[p as usize].children.insert(at + k, r);
                    }
                    entry.tree.nodes[p as usize].dirty = true;
                    dirty_roots.push(p);
                }
                None => {
                    for &r in &block_roots {
                        entry.tree.roots.push(r);
                    }
                }
            }
            inserted += block_roots.len();
        }

        // ── ★★内部一致性自检（本仓实测：splice 后核心的 children/parent 曾分叉）──
        //
        // 【为什么必须有】输入图校验只覆盖**create 时**的输入；而 splice **改的是核心内部状态**
        //   （在父的 children 里 insert / 断链摘除）⇒ 若某处漏改一侧，就会出现
        //   "children 里有它但 parent 不是它"或反之 ⇒ 后续 build_taffy / 收集 / 命中测试
        //   全都在**不一致的树**上工作（症状：层序/几何与预期不符，且无报错）。
        //   真机实测：宿主对账报 `首个差异@51`（宿主按 parentId 归类 vs 核心 children 序）。
        {
            let len = entry.tree.len();
            for i in 0..len {
                let n = entry.tree.get(i as u32);
                for &c in &n.children {
                    let ci = c as usize;
                    if ci >= len || entry.tree.get(c).parent != i as u32 {
                        return Err(format!(
                            "★splice 后内部不一致：节点 {} 的 children 含 {}，但其 parent={}",
                            n.id,
                            entry.tree.get(c).id,
                            entry.tree.get(c).parent
                        ));
                    }
                }
                if n.parent != crate::node::NO_PARENT {
                    let p = n.parent as usize;
                    if p >= len || !entry.tree.get(n.parent).children.iter().any(|&c| c == i as u32) {
                        return Err(format!(
                            "★splice 后内部不一致：节点 {} 的 parent={} 但不在其 children 里",
                            n.id,
                            entry.tree.get(n.parent).id
                        ));
                    }
                }
            }
        }

        // ── ★★内存回收：孤点超阈值则压实（本仓实测的设计余项）──
        //
        // 【触发策略（amortized，本轮按真机读数调优）】孤点 ≥ 下限（256）**且** > 存活的 1/8 ⇒ 压实。
        //   ★为什么从"一半"改为"1/8"（真机实测）：`S5_churn_cycles` 10 轮插删后
        //     孤点 1050 / 存活 3159 ⇒ `1050*2 < 3159` ⇒ **不触发**，末轮仍积 1050 孤点。
        //     真实长列表（4000 行）删 50 行/轮时，孤点相对存活更小 ⇒ "一半"几乎永不触发。
        //   ★为什么仍不会退化成 O(n)/次（均摊论证）：设阈值为 `orphans*8 > live`，
        //     触发时 `orphans > live/8` ⇒ 存活 ≥ 8×孤点 ⇒ 压实后总空间 ≤ (live+orphans) 的
        //     ~1.125 倍，而**回收量 ≥ 孤点 > live/8** ⇒ 每次压实的 O(live+orphans) 成本
        //     由"至少 live/8 次摘除"分摊 ⇒ 均摊仍是 **O(1)/次摘除**（常数约 9×）。
        //   ★压实的正确性依据见 `TreeEntry::compact`（所有外部引用走稳定 id）。
        let mut compact_info: Option<(usize, usize)> = None;
        {
            let live = entry.tree.len().saturating_sub(entry.orphans);
            if entry.orphans >= 256 && entry.orphans * 8 > live {
                let before = entry.tree.len();
                let (_, after) = entry.compact();
                compact_info = Some((before, after));
                // ★压实重排了下标 ⇒ 引擎的 taffy 树（按下标对齐）必须失效重建
                ENGINES.with(|cell| {
                    if let Some(e) = cell.borrow_mut().get_mut(&handle) {
                        e.invalidate_persistent();
                    }
                });
            }
        }

        // ── ③ 重排（复用多范围增量；无脏节点则跳过）──
        //
        // ★★度量表：① 先并入请求带来的新文本度量（插入的行必然含文本——
        //   见 SpliceRequest::text_measures 的实测记录），② 再交给重排引擎，
        //   否则新文本与本范围里的既有文本都会被塌成 0 高。
        for (k, v) in &req.text_measures {
            if let Ok(id) = k.parse::<u32>() {
                entry.measures.insert(id, Size { width: v.width, height: v.height });
            }
        }
        // ★★**splice 必须显式使持久 taffy 树失效**（本仓测试抓到的真缺陷）
        //
        // 【为什么长度判据在这里失效】摘除**只断链、不删节点**（见本函数顶部设计说明：
        //   孤点留在数组里由 `roots` 遍历自然跳过）⇒ `tree.len()` **不变**
        //   ⇒ `with_engine` 的 `taffy_id_len() != tree.len()` 判据**抓不到拓扑变化**
        //   ⇒ 引擎会用**还连着被摘子树**的旧 taffy ⇒ 几何错（测试 `splice_remove_detaches_subtree` 抓到）。
        //   ⇒ 结构变更由**知道结构变了的调用方**显式失效（比"猜长度"可靠）。
        ENGINES.with(|cell| {
            if let Some(e) = cell.borrow_mut().get_mut(&handle) {
                e.invalidate_persistent();
            }
        });
        let t_rel0 = std::time::Instant::now();
        let multi = if dirty_roots.is_empty() {
            crate::ops_apply::MultiRelayout::default()
        } else {
            let (em, tl) = (entry.measures.clone(), entry.tree.len());
            with_engine(handle, tl, &em, |eng| {
                crate::ops_apply::relayout_multi_in(eng, &mut entry.tree, &dirty_roots)
            })
        };
        let t_rel = t_rel0.elapsed().as_secs_f64() * 1000.0;
        entry.last_scopes = if multi.scopes.is_empty() { dirty_roots.clone() } else { multi.scopes.clone() };

        // ── ④ 变化集（宿主据此更新层；与 update 路径同口径）──
        let t_col0 = std::time::Instant::now();
        let mut changed = serde_json::Map::new();
        for &sc in &entry.last_scopes {
            let (pox, poy) = parent_origin_of(&entry.tree, sc);
            collect_abs_subtree(&entry.tree, sc, pox, poy, &mut changed);
        }
        let t_col = t_col0.elapsed().as_secs_f64() * 1000.0;

        // ★★**子序对账数据**（本仓实测的判据缺口）：把受影响的父及其**当前 children 序**回传，
        //   供宿主与自己的层序逐位对账——像素判据证明不了层序（行不重叠 ⇒ 屏幕上看不出）。
        //   只回传**本次动过的父**（脏根 + 插入落点），避免整树序列化。
        let mut child_order = serde_json::Map::new();
        {
            let mut parents: Vec<u32> = dirty_roots.clone();
            for ins in &req.inserts {
                if let Some(pid) = ins.parent_id {
                    if let Some(&p) = entry.id_to_idx.get(&pid) {
                        parents.push(p);
                    }
                }
            }
            parents.sort_unstable();
            parents.dedup();
            for p in parents {
                if (p as usize) >= entry.tree.len() {
                    continue;
                }
                let n = entry.tree.get(p);
                let kids: Vec<u32> = n.children.iter().map(|&c| entry.tree.get(c).id).collect();
                child_order.insert(n.id.to_string(), serde_json::json!(kids));
            }
        }
        Ok(serde_json::json!({
            "ok": true,
            "removed": removed,
            "inserted": inserted,
            "relayout_count": multi.relayout_count,
            "scopes": entry.last_scopes,
            "rects": changed,
            "child_order": child_order,
            "node_count": entry.tree.len(),
            // ★内存回收读数（有压实时才有值：`[压实前, 压实后]` / 当前孤点数）
            "compacted": compact_info.map(|(b, a)| serde_json::json!([b, a])).unwrap_or(serde_json::Value::Null),
            "orphans": entry.orphans,
            "timing": {"lock_ms": t_lock, "relayout_ms": t_rel, "collect_ms": t_col},
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★**注入/更新文本度量**（节点 id → 尺寸）——宿主在文本**内容或字体变化后**调用
///
/// 【为什么必须有这个通道（本仓实测的闭环缺口）】文本尺寸只能由宿主度量（CoreText /
///   StaticLayout），而核心的度量表在建树时注入一次。此后：
///   · **结构变化**（插入含文本的行）→ splice 的 `textMeasures` 覆盖；
///   · **文本字面量变化** → 此前**无任何通道** ⇒ 核心要么用旧尺寸（几何偏），
///     要么（修复前）用零尺寸（文字塌成 0 高）。
///   ⇒ 本入口补上这一环：宿主度量后推入，**不触发重排**（几何要等随后的
///     update/apply_ops 标脏才重算——度量与布局解耦，避免双重 reflow）。
///
/// 入参：`{"12":{"width":80.5,"height":19},"13":{...}}`（id 字符串键，与 create 的 textMeasures 同形）
///
/// # Safety
/// `measures_json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_set_text_measures(handle: u64, measures_json: *const c_char) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if measures_json.is_null() {
            return Err("measures_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(measures_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let map: std::collections::HashMap<String, SizeDto> =
            serde_json::from_str(raw).map_err(|e| format!("度量表解析失败：{e}"))?;
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut updated = 0usize;
        for (k, v) in &map {
            if let Ok(id) = k.parse::<u32>() {
                entry.measures.insert(id, Size { width: v.width, height: v.height });
                updated += 1;
            }
        }
        // ★引擎里的度量器是**快照** ⇒ 同步（否则新文本按旧尺寸算：静默错几何）
        let (ms, tl) = (entry.measures.clone(), entry.tree.len());
        with_engine(handle, tl, &ms, |_eng| {});
        Ok(serde_json::json!({"ok": true, "updated": updated, "total": entry.measures.len()}).to_string())
    });
    match r {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// 内部实现：`with_rects=false` 时**不收集也不序列化**矩形（V4 二进制通道下宿主不需要它）
///
/// 【为什么必须能省（本仓实测）】v4 模式下宿主改用二进制取矩形，但 JSON 返回体里若仍带
///   `rects` ⇒ 4003 条矩形的**序列化（~10ms）+ 宿主解析（~19ms）**全部白付一遍。
///   ⇒ 提供本开关，让 JSON 只承载元信息（applied/relayout/scopes，都很小）。
fn apply_ops_impl(handle: u64, ptr: *const u8, len: u32, with_rects: bool) -> Result<String, String> {
    if ptr.is_null() || len == 0 {
        return Err("指令流指针为空或长度为 0".into());
    }
    let buf = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    let dec = crate::ops::decode_ops(buf)?;

    let t0 = std::time::Instant::now();
    let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
    let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
    let t_lock = t0.elapsed().as_secs_f64() * 1000.0;
    // ★度量表借用**提前取**（下面 tree 要可变借用 entry；见 TreeEntry::measures）
    let measures = entry.measures.clone();

    let t_apply0 = std::time::Instant::now();
    let outcome = crate::ops_apply::apply_ops_to_tree(&mut entry.tree, &dec);
    let t_apply = t_apply0.elapsed().as_secs_f64() * 1000.0;

    let unsupported_json: Vec<serde_json::Value> = outcome
        .unsupported
        .iter()
        .map(|(c, m)| serde_json::json!({"op": *c as u8, "reason": m}))
        .collect();
    // ★文本更新明细（见 ApplyOutcome::text_updates）——空时省略（省字节），有则必传
    let text_updates_json: serde_json::Value = serde_json::Value::Object(
        outcome.text_updates.iter().map(|(id, t)| (id.to_string(), serde_json::json!(t))).collect(),
    );

    if outcome.dirty.is_empty() {
        return Ok(serde_json::json!({
            "ok": true, "applied": outcome.applied, "paint_only": outcome.paint_only,
            "dirty": outcome.dirty, "relayout_count": 0, "scopes": [],
            "unsupported": unsupported_json,
            "timing": {"lock_ms": t_lock, "apply_ms": t_apply, "relayout_ms": 0.0, "collect_ms": 0.0},
        })
        .to_string());
    }

    let t_rel0 = std::time::Instant::now();
    // ★复用**按句柄的持久引擎**（含持久 taffy 树；度量器随 with_engine 同步）
    let _ = &measures;
    let (em, tl) = (entry.measures.clone(), entry.tree.len());
    let multi = with_engine(handle, tl, &em, |eng| {
        crate::ops_apply::relayout_multi_in(eng, &mut entry.tree, &outcome.dirty)
    });
    let t_rel = t_rel0.elapsed().as_secs_f64() * 1000.0;
    // ★引擎内部分段（copy/build/solve/writeback）——「先测量再优化」的依据
    let eng_phases = crate::ops_apply::last_relayout_phases();

    // ★记下本次重排范围（供 `proteus_layout_rects_bin` 限定返回范围）
    entry.last_scopes = multi.scopes.clone();

    let mut out = serde_json::json!({
        "ok": true,
        "applied": outcome.applied,
        "paint_only": outcome.paint_only,
        "dirty": outcome.dirty,
        "relayout_count": multi.relayout_count,
        "scopes": multi.scopes,
        "changed_roots": multi.changed_roots,
        "unsupported": unsupported_json,
        "text_updates": text_updates_json,
        "timing": {"lock_ms": t_lock, "apply_ms": t_apply, "relayout_ms": t_rel, "collect_ms": 0.0,
                   "engine_phases": eng_phases},
    });

    if with_rects {
        let t_col0 = std::time::Instant::now();
        let mut changed = serde_json::Map::new();
        // ★★收集用**变化根**：平移传播时它 = 脏子树 + 被平移的兄弟（不能用 scope——
        //   否则被平移的兄弟不被收集 ⇒ 宿主不更新 ⇒ 画面停在旧位置）
        let roots: &[u32] = if multi.changed_roots.is_empty() { &multi.scopes } else { &multi.changed_roots };
        for &sc in roots {
            let (pox, poy) = parent_origin_of(&entry.tree, sc);
            collect_abs_subtree(&entry.tree, sc, pox, poy, &mut changed);
        }
        let t_col = t_col0.elapsed().as_secs_f64() * 1000.0;
        out["rects"] = serde_json::Value::Object(changed);
        out["timing"]["collect_ms"] = serde_json::json!(t_col);
    }
    Ok(out.to_string())
}

/// ★V4：**不带 rects 的 apply**（宿主改用二进制取矩形时的首选入口）
///
/// # Safety
/// 同 `proteus_layout_apply_ops`；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_apply_ops_norects(handle: u64, ptr: *const u8, len: u32) -> *mut c_char {
    match std::panic::catch_unwind(|| apply_ops_impl(handle, ptr, len, false)) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn proteus_layout_apply_ops(handle: u64, ptr: *const u8, len: u32) -> *mut c_char {
    // ★统一走 `apply_ops_impl`（同一语义一处实现——本仓纪律）：
    //   本入口 = with_rects=true（兼容既有调用方，JSON 里带 `rects`）；
    //   二进制通道场景请用 `proteus_layout_apply_ops_norects`（省掉序列化与宿主解析）。
    match std::panic::catch_unwind(|| apply_ops_impl(handle, ptr, len, true)) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★RT0（2026-09-30）—— **动画指令入口**：启动/停止动画（**曲线求值在 Rust 侧**）
///
/// 【为什么不走 ops 指令流（与 ANIM_START opcode 的关系）】
///   动画指令的两个语义层：① **启动**（一次性，含曲线 id/起止值/时长）；
///   ② **每帧推进**（高频，只有 dt 一个数）。本函数承载 ①，`proteus_layout_anim_tick` 承载 ②。
///   ★②**故意不走 ops 二进制流**：每帧一条 20B 消息去编码/解码一个 f32，是把 V2「池按需」
///   好不容易省下的字节又花回去；而 **1 次函数调用 + 1 个 f32** 已是最小跨边界形态。
///   （这就是 RT0 要验证的"最小协议"设计——数字见 examples/rt0_anim_spike.rs 的对照。）
///
/// ★★**解析裁剪形状声明**（C1：`{kind:'inset'|'circle'|'polygon', params:[…]}`）→ (kind, 16 槽)
///
/// 槽位约定（与内核 `AnimKind::ClipN` 注释一致——**跨语言契约**）：
///   · inset（kind=1）：slot0..3 = top/right/bottom/left（**盒分数** 0..1，可负 = 外扩）
///   · circle（kind=2）：slot0..2 = cx/cy/r（分数；r 相对 **min(w,h)**）
///   · polygon（kind=3）：slot0..15 = 最多 8 顶点 (x,y) 展平（分数；顺序即多边形顺序）
///
/// 校验：未知类型 / 参数数量不符 / 非有限数 ⇒ **明确拒绝**（不静默截断——截断会让
/// "写错的形状"悄悄变成另一个形状，本仓纪律：静默失败最致命）。
/// ★★**渐变解析**（渐变 v2）——`{kind, angle|cx/cy/r, stops:[{offset,color,alpha?}]}`
///   → `GradState`（A 态填 `colors_a/offsets_a`；B 态由调用方搬到 `_b` 槽）。
///   ★色标颜色走 `parse_css_color`（**与底色同一解析器**——含 `#RRGGBBAA` 支持）；
///     但 TS 声明面只发六位 + 独立 `alpha`（8 位在色标被校验器拒绝——防两端顺序分歧）。
///   ★全部拒绝分支带修法（数量/升序/非数/未知类型）。
fn parse_gradient(v: &serde_json::Value, field: &str) -> Result<crate::style::GradState, String> {
    let kind_s = v
        .get("kind")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("{field} 缺少 kind（应为 'linear'/'radial'）"))?;
    let kind = match kind_s {
        "linear" => 1u8,
        "radial" => 2u8,
        other => {
            return Err(format!(
                "{field}.kind 未知：{other:?}（支持 'linear'（angle）与 'radial'（cx/cy/r））"
            ))
        }
    };
    let angle = if kind == 1 {
        v.get("angle")
            .and_then(|x| x.as_f64())
            .map(|f| f as f32)
            .ok_or_else(|| format!("{field} 是 linear 但缺 angle（度；0=向上 90=向右）"))?
    } else {
        0.0
    };
    let (cx, cy, r) = if kind == 2 {
        let cx = v.get("cx").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
        let cy = v.get("cy").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
        let r = v.get("r").and_then(|x| x.as_f64()).unwrap_or(1.0) as f32;
        if !(r > 0.0) {
            return Err(format!("{field}.r 必须为正：{r}（r=0 的径向渐变不可见）"));
        }
        (cx, cy, r)
    } else {
        (0.5, 0.5, 1.0)
    };
    let stops = v
        .get("stops")
        .and_then(|x| x.as_array())
        .ok_or_else(|| format!("{field}.stops 缺失或不是数组（至少 2 个色标）"))?;
    if stops.len() < 2 || stops.len() > 8 {
        return Err(format!(
            "{field}.stops 色标数量 {} 不在 2..8（超出请拆成多节点）",
            stops.len()
        ));
    }
    let mut colors = [0u32; 8];
    let mut offsets = [0f32; 8];
    let mut prev = f32::NEG_INFINITY;
    for (i, st) in stops.iter().enumerate() {
        let off = st
            .get("offset")
            .and_then(|x| x.as_f64())
            .map(|f| f as f32)
            .ok_or_else(|| format!("{field}.stops[{i}].offset 缺失或非数（应为 0..1）"))?;
        if !(0.0..=1.0).contains(&off) {
            return Err(format!("{field}.stops[{i}].offset 越界：{off}（应为 0..1）"));
        }
        if off <= prev {
            return Err(format!(
                "{field}.stops[{i}].offset 非升序：{off} 不大于前一个 {prev}（色标必须严格升序）"
            ));
        }
        prev = off;
        let color_s = st
            .get("color")
            .and_then(|x| x.as_str())
            .ok_or_else(|| format!("{field}.stops[{i}].color 缺失或非字符串"))?;
        let mut packed = parse_css_color(color_s)?;
        // ★可选 `alpha`（0..1）：**独立数值字段**——与 TS 契约一致（不靠 8 位十六进制顺序）
        if let Some(a) = st.get("alpha").and_then(|x| x.as_f64()) {
            if !(0.0..=1.0).contains(&a) {
                return Err(format!("{field}.stops[{i}].alpha 越界：{a}（应为 0..1）"));
            }
            let aa = (a * 255.0).round().clamp(0.0, 255.0) as u32;
            packed = (packed & 0x00FF_FFFF) | (aa << 24);
        }
        colors[i] = packed;
        offsets[i] = off;
    }
    Ok(crate::style::GradState {
        kind,
        angle,
        cx,
        cy,
        r,
        n: stops.len() as u8,
        colors_a: colors,
        offsets_a: offsets,
        has_b: false,
        colors_b: [0u32; 8],
        offsets_b: [0f32; 8],
        mix: 0.0,
    })
}

fn parse_clip_path(v: &serde_json::Value) -> Result<(u8, [f32; 16]), String> {
    let kind_s = v
        .get("kind")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "clipPath 缺少 kind（应为 'inset'/'circle'/'polygon'）".to_string())?;
    let kind = match kind_s {
        "inset" => 1u8,
        "circle" => 2u8,
        "polygon" => 3u8,
        other => {
            return Err(format!(
                "clipPath.kind 未知：{other:?}（支持 'inset' 4 参 / 'circle' 3 参 / 'polygon' 最多 8 点）"
            ))
        }
    };
    let arr = v
        .get("params")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "clipPath 缺少 params 数组".to_string())?;
    let nums: Result<Vec<f32>, String> = arr
        .iter()
        .map(|x| {
            x.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| format!("clipPath.params 含非数字：{x}"))
        })
        .collect();
    let nums = nums?;
    for f in &nums {
        if !f.is_finite() {
            return Err(format!("clipPath.params 含非有限数：{f}"));
        }
    }
    let (need_min, need_max, slot_n) = match kind {
        1 => (4usize, 4usize, 4usize),
        2 => (3, 3, 3),
        _ => (6, 16, 16), // polygon：至少 3 个点（6 个数）
    };
    if nums.len() < need_min || nums.len() > need_max {
        return Err(format!(
            "clipPath.params 数量不符（kind={kind_s}）：收到 {}，应为 {}..={}",
            nums.len(),
            need_min,
            need_max
        ));
    }
    // ★成对检查（polygon 且数量在合法区间内但为奇数——如 7 个：数量合法但不成对，
    //   错误应精确指向"成对"而不是笼统的"数量不符"）
    if kind == 3 && nums.len() % 2 != 0 {
        return Err(format!("clipPath polygon 参数必须成对（x,y）：收到 {} 个", nums.len()));
    }
    let mut out = [0f32; 16];
    for (i, f) in nums.iter().enumerate().take(slot_n) {
        out[i] = *f;
    }
    Ok((kind, out))
}

/// ★★**解析自定义贝塞尔控制点**（`curveBezier:[x1,y1,x2,y2]`）——两处 anim 入口共用
///
/// 【契约（CSS `cubic-bezier` 同规）】`x1/x2 ∈ [0,1]`（时间轴必须单调，否则求值不唯一）；
///   `y1/y2` 任意（> 1 / < 0 = 回弹/预期效果的来源）。越界 ⇒ **明确拒绝**（不静默钳制——
///   钳制会让"写错的曲线"悄悄变成另一条，本仓纪律：静默失败最致命）。
/// 【为什么单独校验而不做类型约束】JSON 通道是跨语言的（TS 已按类型校验过一遍，
///   但 FFI 是第二个入口——两边都校验，任何一侧漏了另一侧兜住）。
fn parse_curve_bezier(a: &serde_json::Value, node_id: u32) -> Result<Option<std::sync::Arc<crate::anim::BezierTable>>, String> {
    let Some(v) = a.get("curveBezier") else { return Ok(None) };
    let arr = v
        .as_array()
        .ok_or_else(|| format!("节点 {node_id} 的 curveBezier 必须是 [x1,y1,x2,y2] 数组"))?;
    if arr.len() != 4 {
        return Err(format!(
            "节点 {node_id} 的 curveBezier 需要 4 个数（x1,y1,x2,y2），收到 {} 个",
            arr.len()
        ));
    }
    let mut c = [0f32; 4];
    for (i, x) in arr.iter().enumerate() {
        c[i] = x
            .as_f64()
            .ok_or_else(|| format!("节点 {node_id} 的 curveBezier[{i}] 不是数字"))?
            as f32;
    }
    if !(0.0..=1.0).contains(&c[0]) || !(0.0..=1.0).contains(&c[2]) {
        return Err(format!(
            "节点 {node_id} 的 curveBezier 控制点 x1/x2 必须在 [0,1]（时间轴单调），收到 x1={}, x2={}",
            c[0], c[2]
        ));
    }
    Ok(Some(crate::anim::bezier_table(c)))
}

/// ★★**解析循环声明**（`repeat` / `direction`，2026-10-01 · A2）——两处 anim 入口共用
///
/// 契约（与 CSS `animation-iteration-count` / `animation-direction` 对齐）：
///   · `repeat`: 正数 = 播 n 遍；`"infinite"`（字符串）= 无限；缺省 1。**0 / 负数 / NaN 拒绝**。
///   · `direction`: `"normal"`（缺省）/ `"alternate"`（yoyo——奇偶轮反向）。
/// 返回 `(iterations, alternate)`；`iterations = -1.0` 是**无限**的内部哨兵。
fn parse_repeat(a: &serde_json::Value, node_id: u32) -> Result<(f32, bool), String> {
    let iterations = match a.get("repeat") {
        None => 1.0f32,
        Some(v) if v.is_string() => match v.as_str() {
            Some("infinite") => -1.0,
            other => {
                return Err(format!(
                    "节点 {node_id} 的 repeat 字符串只支持 \"infinite\"，收到 {other:?}（数字直接写数字）"
                ))
            }
        },
        Some(v) => {
            let n = v
                .as_f64()
                .ok_or_else(|| format!("节点 {node_id} 的 repeat 不是数字/\"infinite\"：{v}"))? as f32;
            if !(n.is_finite()) || n < 1.0 {
                return Err(format!(
                    "节点 {node_id} 的 repeat 非法：{n}（应 ≥ 1 的数字，或 \"infinite\"）"
                ));
            }
            n
        }
    };
    // ★★yoyo 方向：**两种字段形态都认**（2026-10-01 真机抓出的跨语言分叉修正）——
    //   TS 编译产物发的是 `alternate: true`（boolean），而本函数首版只读
    //   `direction: "alternate"`（字符串）⇒ **真机上 yoyo 静默不生效**：
    //   sweep 幕第 2 遍变成"重跑 0→180"，末态 180（应回 0）——由 check-flip.py ④ 抓出。
    //   ★教训（与 color_shift 通配同源）：跨语言字段名/形态必须有**对拍测试**，
    //     光有两侧各自的单测不够（它们各自都绿）。见 ffi 单测 `repeat_yoyo_field_forms`。
    let alternate = if a.get("alternate").and_then(|x| x.as_bool()).unwrap_or(false) {
        true
    } else {
        match a.get("direction").and_then(|x| x.as_str()) {
            None | Some("normal") => false,
            Some("alternate") => true,
            Some(other) => {
                return Err(format!(
                    "节点 {node_id} 的 direction 只支持 \"normal\" / \"alternate\"，收到 {other:?}"
                ))
            }
        }
    };
    Ok((iterations, alternate))
}

/// 入参 JSON：`{"anims":[{"nodeId":1,"kind":0,"curve":1,"from":0,"to":200,"durMs":1000}]}`
///   kind: 0=translateX / 1=translateY / 2=scale（与 `AnimKind` 一致）
///   返回：`{"ok":true,"started":N}` 或 `{"ok":false,"error":...}`
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_string_free` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_start(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let list = v
            .get("anims")
            .and_then(|a| a.as_array())
            .ok_or_else(|| "入参缺少 anims 数组".to_string())?;

        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;

        let num = |o: &serde_json::Value, k: &str| -> Result<f32, String> {
            o.get(k)
                .and_then(|x| x.as_f64())
                .map(|x| x as f32)
                .ok_or_else(|| format!("动画缺少数值字段 `{k}`"))
        };
        let mut started = 0usize;
        let mut spring_count = 0usize;
        let mut delayed_count = 0usize;
        let mut scroll_count = 0usize;
        let mut keyframes_count = 0usize;
        for a in list {
            let node_id = a
                .get("nodeId")
                .and_then(|x| x.as_u64())
                .ok_or_else(|| "动画缺少 nodeId".to_string())? as u32;
            let kind_raw = a
                .get("kind")
                .and_then(|x| x.as_u64())
                .ok_or_else(|| "动画缺少 kind".to_string())? as u8;
            let kind = crate::anim::AnimKind::from_u8(kind_raw)?;
            let curve = a.get("curve").and_then(|x| x.as_u64()).unwrap_or(0) as u8;
            // ★自定义贝塞尔（可选；Some 时求值优先于内置 curve id——见 Anim::curve_at）
            let curve_pts = parse_curve_bezier(a, node_id)?;
            // ★A2 循环（可选）：`repeat` 数字 / `'infinite'`（JSON 里是字符串）
            //   `direction: 'alternate'` = yoyo（奇偶轮反向）
            let (iterations, alternate) = parse_repeat(a, node_id)?;
            // ★RT2：驱动方式（缺省 time ⇒ 向后兼容 RT0 的启动报文）
            let drive = crate::anim::AnimDrive::from_u8(a.get("drive").and_then(|x| x.as_u64()).unwrap_or(0) as u8)?;
            // ★RT2 追加：弹簧（`spring:{stiffness,damping,mass}` 提供时用物理模式）
            // ★序列编排：`keyframes:[{to,durMs,curve},…]` 提供时用多段模式（与 spring 二选一，先判序列）
            let mode = match a.get("keyframes") {
                Some(kf) => {
                    let arr = kf
                        .as_array()
                        .ok_or_else(|| format!("节点 {node_id} 的 keyframes 必须是数组"))?;
                    let mut segs: Vec<crate::anim::KeySeg> = Vec::with_capacity(arr.len());
                    for (i, s) in arr.iter().enumerate() {
                        segs.push(crate::anim::KeySeg {
                            to: num(s, "to").map_err(|e| format!("keyframes[{i}] {e}"))?,
                            dur_ms: num(s, "durMs").map_err(|e| format!("keyframes[{i}] {e}"))?,
                            curve: s.get("curve").and_then(|x| x.as_u64()).unwrap_or(1) as u8,
                        });
                    }
                    keyframes_count += 1;
                    crate::anim::AnimMode::Keyframes(segs)
                }
                None => match a.get("spring") {
                    Some(sp) => {
                        spring_count += 1;
                        crate::anim::AnimMode::Spring(crate::anim::SpringParams {
                            stiffness: num(sp, "stiffness")?,
                            damping: num(sp, "damping")?,
                            mass: sp.get("mass").and_then(|x| x.as_f64()).unwrap_or(1.0) as f32,
                        })
                    }
                    None => crate::anim::AnimMode::Curve,
                },
            };
            // ★延迟（编排/交错）；`takeover:false` ⇒ 硬重启
            let delay_ms = a.get("delayMs").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            if delay_ms > 0.0 {
                delayed_count += 1;
            }
            let takeover = a.get("takeover").and_then(|x| x.as_bool()).unwrap_or(true);
            let from = num(a, "from")?;
            // ★MA5：滚动窗口（两者都给且 to > from ⇒ 该动画由滚动位置驱动；缺省 0/0 = 非滚动）
            let scroll_from = a.get("scrollFrom").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let scroll_to = a.get("scrollTo").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let anim = crate::anim::Anim {
                node_id,
                kind,
                curve,
                from,
                to: num(a, "to")?,
                dur_ms: num(a, "durMs")?,
                delay_ms,
                t_ms: 0.0,
                drive,
                progress: 0.0,
                scroll_from,
                scroll_to,
                mode,
                x: from,
                vel: 0.0,
                takeover,
                curve_pts,
                iterations,
                alternate,
            };
            // ★错误必须冒泡（节点不在树上 / 曲线越界）——静默会变成"动画不生效"难查
            // ★MA5：带滚动窗口的动画走 `start_scroll`（drive 切 Progress——时间 tick 不再推进它，
            //   只"保持写入"；进度由宿主滚动回调经 `anim_seek_scroll` 设置）
            let tree = &entry.tree;
            if scroll_to > scroll_from {
                scroll_count += 1;
                entry.anim.start_scroll(tree, anim)?;
            } else {
                entry.anim.start(tree, anim)?;
            }
            started += 1;
        }
        Ok(serde_json::json!({
            "ok": true, "started": started, "spring": spring_count, "delayed": delayed_count,
            "scroll": scroll_count, "keyframes": keyframes_count
        })
        .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★RT0 —— **每帧推进动画**（一次调用 = 一帧；曲线求值与字段写入都在 Rust 侧）
///
/// 返回：`{"ok":true,"changed":N,"finished":M,"active":K}`
///   `changed` = 本帧真正改动的字段数（值未变不计）；`finished` = 本帧结束的动画数；
///   `active` = 推进后仍在活动的动画数。
///
/// ★语义：只写 style 的**绘制字段**（translateX/Y、scale），**不触发重排**——
///   translate/scale 是绘制层变换，不改变布局几何（这正是指令路径的成本优势之一）。
///
/// # Safety
/// 返回指针须用 `proteus_string_free` 释放。
#[no_mangle]
pub extern "C" fn proteus_layout_anim_tick(handle: u64, dt_ms: f32) -> *mut c_char {
    let f = || -> Result<String, String> {
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut eng = std::mem::take(&mut entry.anim);
        let out = eng.tick(&mut entry.tree, dt_ms);
        entry.anim = eng;
        // ★updates 只在诊断入口返回（真机每帧走 `_anim_tick_bin`——16B/条，无 JSON 解析）
        let updates: Vec<serde_json::Value> = out
            .updates
            .iter()
            .map(visual_to_json)
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "changed": out.changed,
            "finished": out.finished,
            "active": out.active_after,
            "updates": updates,
        })
        .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★RT2 —— **按节点批量停动画**（Morpheus §7.3「节点回收必须解绑」的实现面）
///
/// 入参 JSON：`{"nodeIds":[1,2,3]}`
/// 返回：`{"ok":true,"removed":N}`（N = 实际移除的动画数，供宿主对账"真的解绑了"）
///
/// 【为什么必须有这个入口（而不是让宿主自己记着停）】本仓纪律：**能靠机制消除的副作用，
///   不要靠"记得调用"来管理**。宿主的 `dematerializeRow` 是回收点，在那里调用本入口
///   即形成结构性保证（调用点单一只，且有回归测试）。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_stop(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        // ★`{"all":true}` ⇒ 停全部（相位间状态清理；见宿主 animStopAll）
        if v.get("all").and_then(|x| x.as_bool()).unwrap_or(false) {
            let before = entry.anim.len();
            let reset = entry.anim.stop_all(&mut entry.tree);
            return Ok(serde_json::json!({"ok": true, "removed": before, "reset": reset}).to_string());
        }
        let ids: Vec<u32> = v
            .get("nodeIds")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_u64()).map(|x| x as u32).collect())
            .ok_or_else(|| "入参缺少 nodeIds 数组（或 {\"all\":true}）".to_string())?;
        let removed = entry.anim.stop_nodes(&mut entry.tree, &ids);
        Ok(serde_json::json!({"ok": true, "removed": removed}).to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★**曲线的贝塞尔近似**（供平台插值器用——Android `PathInterpolator` 只收控制点）
///
/// 入参：曲线 id（0..=4）。返回：`{"ok":true,"bezier":[x1,y1,x2,y2]}` 或
///   `{"ok":true,"bezier":null}`（该曲线无合适近似，如弹簧——**诚实返回 null，不硬套**）。
///
/// 【为什么由内核给（而不是宿主自己写）】曲线知识必须**只在引擎一处**（本仓纪律 #22：
///   第 N 份手写副本 = 下一个静默缺陷）。宿主只做"把控制点交给平台 API"。
///
/// # Safety
/// 无指针参数。
#[no_mangle]
pub extern "C" fn proteus_anim_curve_bezier(curve: u32) -> *mut c_char {
    let c = crate::anim::curve_bezier_approx(curve as u8);
    let v = match c {
        Some((x1, y1, x2, y2)) => serde_json::json!({"ok": true, "bezier": [x1, y1, x2, y2]}),
        None => serde_json::json!({"ok": true, "bezier": serde_json::Value::Null}),
    };
    CString::new(v.to_string()).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// ★★**MA0-RT：提交规格**（"提交一次 + 平台渲染线程自主插值"路径的数据面）
///
/// 入参：与 `anim_start` 相同的 `{"anims":[…]}`。
/// 返回：`{"ok":true,"plan":{composited,nonCompositedKinds,nodeCount,animCount},
///        "specs":[{nodeId,durMs,delayMs,keyTimes:[…],samples:[[tx,ty,scale,rotate,opacity],…]}]}`
///
/// 【它做什么（§5-bis.2 的落点）】
///   ① **合成属性判定**：整批属性 ⊆ {translate, scale, rotate, opacity} ⇒ `composited=true`
///      （可走平台零参与路径）；否则 `composited=false` 并列出违规属性（**供上层报错/降级**，不静默）；
///   ② **生成采样规格**：曲线求值在 Rust（唯一实现）⇒ 宿主只做"翻译成平台 API"，**宿主里没有曲线数学**；
///   ③ **交接**：把这些动画从 tick 引擎**摘出**（不清样式值）——责任转移给平台渲染线程。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_commit_spec(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let list = v.get("anims").and_then(|a| a.as_array()).ok_or_else(|| "入参缺少 anims 数组".to_string())?;

        let num = |o: &serde_json::Value, k: &str| -> Result<f32, String> {
            o.get(k)
                .and_then(|x| x.as_f64())
                .map(|x| x as f32)
                .ok_or_else(|| format!("动画缺少数值字段 `{k}`"))
        };
        // 解析成 Anim（与 anim_start 同一语义）
        let mut anims: Vec<crate::anim::Anim> = Vec::with_capacity(list.len());
        for a in list {
            let node_id = a.get("nodeId").and_then(|x| x.as_u64()).ok_or_else(|| "动画缺少 nodeId".to_string())? as u32;
            let kind = crate::anim::AnimKind::from_u8(
                a.get("kind").and_then(|x| x.as_u64()).ok_or_else(|| "动画缺少 kind".to_string())? as u8,
            )?;
            // ★MA6：序列编排（与 `anim_start` 同一解析语义——缺了它平台路径会把序列当单段，
            //   静默错形：from=to=1 ⇒ 提交出去"几乎不动的动画"）
            let mode = match a.get("keyframes") {
                Some(kf) => {
                    let arr = kf
                        .as_array()
                        .ok_or_else(|| format!("节点 {node_id} 的 keyframes 必须是数组"))?;
                    let mut segs: Vec<crate::anim::KeySeg> = Vec::with_capacity(arr.len());
                    for (i, s) in arr.iter().enumerate() {
                        segs.push(crate::anim::KeySeg {
                            to: num(s, "to").map_err(|e| format!("keyframes[{i}] {e}"))?,
                            dur_ms: num(s, "durMs").map_err(|e| format!("keyframes[{i}] {e}"))?,
                            curve: s.get("curve").and_then(|x| x.as_u64()).unwrap_or(1) as u8,
                        });
                    }
                    crate::anim::AnimMode::Keyframes(segs)
                }
                None => match a.get("spring") {
                    Some(sp) => crate::anim::AnimMode::Spring(crate::anim::SpringParams {
                        stiffness: num(sp, "stiffness")?,
                        damping: num(sp, "damping")?,
                        mass: sp.get("mass").and_then(|x| x.as_f64()).unwrap_or(1.0) as f32,
                    }),
                    None => crate::anim::AnimMode::Curve,
                },
            };
            let from = num(a, "from")?;
            // ★自定义贝塞尔（与 anim_start 同一条解析——含范围校验与可定位错误）
            let curve_pts = parse_curve_bezier(a, node_id)?;
            // ★MA5：滚动驱动动画**不得**走平台零参与路径——它的进度来自**外部滚动位置**，
            //   而平台路径的语义是"提交后由平台按**时间**自主插值"⇒ 二者是不同驱动源。
            //   静默按时间提交会让"视差跟手"变成"到点自动播放"（完全不是同一动效）。
            if a.get("scrollTo").and_then(|x| x.as_f64()).unwrap_or(0.0)
                > a.get("scrollFrom").and_then(|x| x.as_f64()).unwrap_or(0.0)
            {
                return Err(format!(
                    "节点 {node_id} 的动画带滚动窗口（scrollFrom/scrollTo）——滚动驱动不得走平台零参与路径；\
                     请走 anim_start + 宿主滚动回调（anim_seek_scroll）"
                ));
            }
            anims.push(crate::anim::Anim {
                node_id,
                kind,
                curve: a.get("curve").and_then(|x| x.as_u64()).unwrap_or(1) as u8,
                from,
                to: num(a, "to")?,
                dur_ms: num(a, "durMs")?,
                delay_ms: a.get("delayMs").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32,
                t_ms: 0.0,
                drive: crate::anim::AnimDrive::Time,
                progress: 0.0,
                scroll_from: 0.0,
                scroll_to: 0.0,
                mode,
                x: from,
                vel: 0.0,
                takeover: false,
                curve_pts,
                iterations: 1.0, // ★平台零参与路径按"单遍"提交（循环归 tick 路径——见 commit_spec 注释）
                alternate: false,
            });
        }

        let plan = crate::anim::plan_animations(&anims);
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;

        // ★非合成属性 ⇒ 不生成平台规格（**明确返回 plan 让上层处理**，不静默降级）
        let specs: Vec<crate::anim::CommitSpec> = if plan.composited {
            let sp = crate::anim::commit_specs(&entry.tree, &anims);
            // 交接：把这些节点的 tick 动画摘出（不清样式值——规格基于静态基线采样）
            let ids: Vec<u32> = anims.iter().map(|a| a.node_id).collect();
            entry.anim.detach_nodes(&ids);
            sp
        } else {
            Vec::new()
        };

        let specs_json: Vec<serde_json::Value> = specs
            .iter()
            .map(|sp| {
                serde_json::json!({
                    "nodeId": sp.node_id,
                    "durMs": sp.dur_ms,
                    "delayMs": sp.delay_ms,
                    "keyTimes": sp.key_times,
                    "samples": sp.samples.iter().map(|(tx, ty, sc, rot, op)| {
                        serde_json::json!([tx, ty, sc, rot, op])
                    }).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "plan": {
                "composited": plan.composited,
                "nonCompositedKinds": plan.non_composited_kinds.iter().map(|k| *k as u8).collect::<Vec<_>>(),
                "nodeCount": plan.node_count,
                "animCount": plan.anim_count,
            },
            "specs": specs_json,
        })
        .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★**FLIP 布局动画**（招牌能力，Morpheus §5）—— 记快照 / 启动补间
///
/// 入参：`{"op":"capture"}` 或 `{"op":"start","durMs":300,"curve":1,"staggerMs":0}`
/// 返回：`{"ok":true,"captured":N}` 或 `{"ok":true,"animated":N,"maxDeltaPx":D}`
///
/// 【为什么这是招牌（Morpheus §5）】传统 FLIP 要前后各读一次几何（**跨边界查询**，VDOM 框架里很贵）；
///   而本仓几何**本来就在内核** ⇒ 两次快照都是内部读，**零跨边界、零 JS**。
///   「列表项增删时其他项平滑让位」这种效果因此几乎白送。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_flip(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let op = v.get("op").and_then(|x| x.as_str()).ok_or_else(|| "入参缺少 op".to_string())?;
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        match op {
            "capture" => {
                let mut eng = std::mem::take(&mut entry.anim);
                let n = eng.flip_capture(&entry.tree);
                entry.anim = eng;
                Ok(serde_json::json!({"ok": true, "captured": n}).to_string())
            }
            "start" => {
                let dur = v.get("durMs").and_then(|x| x.as_f64()).unwrap_or(300.0) as f32;
                let curve = v.get("curve").and_then(|x| x.as_u64()).unwrap_or(1) as u8;
                let stagger = v.get("staggerMs").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                let mut eng = std::mem::take(&mut entry.anim);
                let r = eng.flip_start(&mut entry.tree, dur, curve, stagger);
                entry.anim = eng;
                let out = r?;
                // ★起点立即返回（宿主据此把"旧位置"当帧上屏——否则 FLIP 首帧跳变）
                let updates: Vec<serde_json::Value> = out
                    .updates
                    .iter()
                    .map(visual_to_json)
                    .collect();
                Ok(serde_json::json!({
                    "ok": true, "animated": out.animated, "maxDeltaPx": out.max_delta_px,
                    "updates": updates
                })
                .to_string())
            }
            other => Err(format!("未知 op `{other}`（capture / start）")),
        }
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★RT2 —— **手势驱动的进度定位**（方案 §4.2 的 `ANIM_SEEK`）
///
/// 入参 JSON：`{"nodeId":6,"kind":0,"progress":0.42}`
///   · `kind` 与 `anim_start` 同编码（0=translateX/1=translateY/2=scale）
///   · `progress` clamp 到 0..1；该动画被切到 **Progress 驱动**（此后 `tick` 不再推进它）
/// 返回：`{"ok":true,"changed":N,"updates":[[nodeId,tx,ty,scale],…]}`
///
/// ★语义（与方案 §9 验收「手势跟随延迟 ≤ 1 帧」的关系）：`seek` **立即求值并写字段**，
///   不等下一帧 ⇒ 宿主拿到 updates 后当帧刷新即可，延迟由宿主的刷新时机决定（不是内核侧累积）。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_seek(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let node_id = v.get("nodeId").and_then(|x| x.as_u64()).ok_or_else(|| "缺少 nodeId".to_string())? as u32;
        let kind = crate::anim::AnimKind::from_u8(v.get("kind").and_then(|x| x.as_u64()).unwrap_or(0) as u8)?;
        let progress = v.get("progress").and_then(|x| x.as_f64()).ok_or_else(|| "缺少 progress".to_string())? as f32;

        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut eng = std::mem::take(&mut entry.anim);
        let out = eng.seek(&mut entry.tree, node_id, kind, progress);
        entry.anim = eng;
        let updates: Vec<serde_json::Value> = out
            .updates
            .iter()
            .map(visual_to_json)
            .collect();
        Ok(serde_json::json!({"ok": true, "changed": out.changed, "updates": updates}).to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★MA5 —— **滚动驱动**（视差 / 吸顶 / 渐显的统一入口）：滚动位置 → 全部窗口动画
///
/// 入参 JSON：`{"scroll": 240.5}`（**原始滚动位置**，单位与声明里的窗口一致 = px）
///
/// 【为什么入参是"位置"而不是"进度"（判据设计）】进度 = `(off-from)/span` 看着像一行除法，
///   但它属于**动画语义**（窗口语义/钳制/退化处理），若留给宿主各写一份，三端滚动手感就会分叉、
///   且与 `curve_eval` 的组合也会分叉 ⇒ 换算在**内核**（唯一实现，见 `AnimEngine::seek_scroll`）。
///   宿主只报"滚到哪了"——它不需要知道任何动画窗口的存在。
///
/// 返回：`{"ok":true,"changed":N,"updates":[[nodeId,tx,ty,scale,rotate,opacity],…]}`
///   （一次滚动回调驱动**所有**窗口动画——视差层 + 吸顶头 + 渐显项一个调用里全算完）
///
/// ★与手势 `seek` 的区别：那个按 `(node,kind)` 定位单条动画（手指按住哪个就动哪个）；
///   本入口按**滚动位置**驱动全部窗口动画（滚动影响的从来不是一个节点）。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_seek_scroll(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let scroll = v
            .get("scroll")
            .and_then(|x| x.as_f64())
            .ok_or_else(|| "缺少 scroll（原始滚动位置，px）".to_string())? as f32;

        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut eng = std::mem::take(&mut entry.anim);
        let out = eng.seek_scroll(&mut entry.tree, scroll);
        entry.anim = eng;
        let updates: Vec<serde_json::Value> = out
            .updates
            .iter()
            .map(visual_to_json)
            .collect();
        Ok(serde_json::json!({"ok": true, "changed": out.changed, "active": out.active_after, "updates": updates})
            .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★HA4 —— **单节点绝对几何**查询（宿主放置**原生 View** 用）
///
/// 【为什么单独一个入口（而不是让宿主解析 `rects_bin`）】`rects_bin` 返回的是
///   **最近一次重排范围内**的矩形（V4 的性能设计：全量返回会让宿主白做排序过滤）。
///   而"某个 nativeHost 节点现在在哪"是**点查询**：与重排范围无关，且必须**总是**拿得到
///   （原生 View 的摆放不能依赖"它恰好在最近一次重排的 scope 里"）。
///   ⇒ 独立入口，语义单一：**问一个节点，给一个矩形**。
///
/// 返回：`{"ok":true,"id":N,"x":..,"y":..,"width":..,"height":..}`；
///   节点不存在 / 无几何（`display:none`）⇒ `{"ok":false,"error":..}`（不静默给 0 矩形）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_node_rect(handle: u64, node_id: u32) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        match crate::anim::node_abs_rect(&entry.tree, node_id) {
            Some(rect) => Ok(serde_json::json!({
                "ok": true,
                "id": node_id,
                "x": rect.x,
                "y": rect.y,
                "width": rect.width,
                "height": rect.height,
            })
            .to_string()),
            None => Err(format!(
                "节点 {node_id} 无绝对几何（不在树上或 display:none）——原生 View 无法定位"
            )),
        }
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★Host ABI：指令流线格式版本（**跨语言契约的单一来源**）
///
/// 【为什么需要这个入口（纪律 #22：不另立副本）】Host ABI 的 `ops_wire_version` 必须与
///   内核实际使用的 `OPS_VERSION` **同源**——若上层自己写一个常量，改协议时就靠人记着同步。
///   ⇒ 本函数把内核的值**读出来**给上层（host-abi crate 的 `OPS_WIRE_VERSION` 直接引用它）。
#[no_mangle]
pub extern "C" fn proteus_ops_version() -> u32 {
    crate::ops::OPS_VERSION
}

/// ★★**共享元素（跨元素飞行）**——从源矩形飞到目标节点，再归位到 identity
///
/// 入参 JSON：`{"targetId":9, "sourceNodeId":3}` 或 `{"targetId":9, "sourceRect":{"x":..,"y":..,"w":..,"h":..}}`
/// `{"durMs":400,"curve":1,"fadeIn":true}`（可省：durMs 默认 400 / curve 默认 easeOut / fadeIn 默认 true）
///
/// sourceRect 是**系统坐标**（iOS：屏幕点；Android：视图坐标）——由调用方注入（跨页面的
/// 稳态起点只有它知道）；sourceNodeId 是**同树节点**（同页面内的共享元素）。
///
/// 返回：`{"ok":true,"fromRect":{"x","y","w","h"},"toRect":{…},"dx","dy","scale","updates":[…]}`
///
/// 【为什么几何在内核算（与 FLIP/滚动联动同源纪律）】中心差 + 宽度比是**跨页面过渡的全部视觉语义**；
///   宿主各写一份会三端手感分叉，且错误只在真机上肉眼可见。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_shared_element(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let s = unsafe { std::ffi::CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| format!("入参不是合法 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("入参 JSON 解析失败：{e}"))?;
        let target_id = v
            .get("targetId")
            .and_then(|x| x.as_u64())
            .ok_or_else(|| "缺少 targetId".to_string())? as u32;
        let dur_ms = v.get("durMs").and_then(|x| x.as_f64()).unwrap_or(400.0) as f32;
        let curve = v.get("curve").and_then(|x| x.as_u64()).unwrap_or(1) as u8;
        let fade_in = v.get("fadeIn").and_then(|x| x.as_bool()).unwrap_or(true);

        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;

        // 源：优先显式 sourceRect（系统坐标注入），否则同树 sourceNodeId（同页面共享元素）
        let source = if let Some(sr) = v.get("sourceRect") {
            let g = |k: &str| -> Result<f32, String> {
                sr.get(k)
                    .and_then(|x| x.as_f64())
                    .map(|x| x as f32)
                    .ok_or_else(|| format!("sourceRect 缺少数值字段 `{k}`"))
            };
            crate::style::Rect { x: g("x")?, y: g("y")?, width: g("w")?, height: g("h")? }
        } else if let Some(sid) = v.get("sourceNodeId").and_then(|x| x.as_u64()) {
            crate::anim::node_abs_rect(&entry.tree, sid as u32)
                .ok_or_else(|| format!("源节点 {sid} 无绝对几何（不在树上或 display:none）"))?
        } else {
            return Err("缺少源：给 sourceNodeId（同树节点）或 sourceRect（系统坐标）".to_string());
        };

        let mut eng = std::mem::take(&mut entry.anim);
        let r = eng.start_shared_element(&mut entry.tree, target_id, source, dur_ms, curve, fade_in);
        entry.anim = eng;
        let (plan, out) = r?;
        let rect_json = |r: &crate::style::Rect| {
            serde_json::json!({"x": r.x, "y": r.y, "w": r.width, "h": r.height})
        };
        let updates: Vec<serde_json::Value> = out
            .updates
            .iter()
            .map(visual_to_json)
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "targetId": target_id,
            "fromRect": rect_json(&plan.source),
            "toRect": rect_json(&plan.target),
            "dx": plan.dx,
            "dy": plan.dy,
            "scale": plan.scale,
            // ★首帧起点随返回（宿主当帧上屏——否则首帧跳变，与 FLIP 同一条教训）
            "updates": updates,
        })
        .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new(serde_json::json!({"ok": false, "error": "内部 panic（已捕获）"}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★RT2 —— **每帧推进（二进制通道）**：真机宿主走这个入口，**无 JSON 解析**
///
/// 【为什么需要二进制形态（与 `_anim_tick` 的分工）】JSON 入口便于诊断/测试，但真机每帧
///   要把它序列化 + 宿主解析一次；RT0 的对照实验证明"省掉 O(N) 编解码"正是指令路径的
///   主要收益来源之一 ⇒ 每帧通道不该再引入 JSON。本入口把结果写成**定长记录**：
///   `[nodeId u32][tx f32][ty f32][scale f32][rotate f32][opacity f32]` = **24B/条**（按偏移读）。
///   ★**记录宽度是 24B 而非 16B**（RT2 扩展 rotate/opacity 后从 16B 增至 24B）——本注释此前
///     滞留在 16B 而实现早已是 24B（"注释与代码两份事实"的典型，与 check:docs-stats 同源教训）；
///     唯一事实源 = 下方 `buf` 的 6 个 `extend_from_slice` 与 Java 侧 `ANIM_RECORD_BYTES`。
///
/// 返回：字节缓冲区（`out_len` 写入字节数；0 = 本帧无变化）。用 `proteus_rects_free` 释放。
///
/// # Safety
/// `out_len` 须为有效指针。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_tick_bin(handle: u64, dt_ms: f32, out_len: *mut u32) -> *mut u8 {
    unsafe { *out_len = 0 };
    let r = std::panic::catch_unwind(|| -> Result<Vec<u8>, String> {
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut eng = std::mem::take(&mut entry.anim);
        let out = eng.tick(&mut entry.tree, dt_ms);
        entry.anim = eng;
        // ★每帧通道：**112B/条**定长 = id u32 + 七值 f32（tx/ty/scale/rotate/opacity/rotateX/rotateY）
        //   + bg u32 + textColor u32 + clipKind u32 + 16 个 clip 参数 f32 + **strokeProgress f32**
        //   ★C1（2026-10-01）：裁剪形状在**末尾追加**（一切既有偏移保持不变——
        //     消费端既有字段读取零改动；clipKind=0 = 无裁剪，参数全 0）。
        //   ★为什么不量化：clip 参数含**负值语义**（inset 可负 = 外扩；polygon 顶点可越界）——
        //     量化会引入符号/范围妥协，且 16 槽只有 64B（相对 800 节点 × 每帧仍是 MB/s 级可接受）。
        //     如实标注：将来若要压带宽，可在**不动语义**的前提下把 f32 换成带偏移的定点。
        //   ★2026-10-01 由 24B → 28B（底色）→ **32B**（文字色）：两个 u32 都是**打包色**
        //     （0xAARRGGBB）；`u32::MAX` = **本节点无该基色**（宿主忽略该字段——
        //     见 `NodeVisual.color_valid` / `text_color_valid`）。
        //   ★改动须知：记录宽度是**跨语言契约**，两端宿主 + SDK + demo 的解析常量
        //     （iOS `animUpdateRecordBytes` / Android `ANIM_RECORD_BYTES` / SDK `FRAME_UPDATE_BYTES` /
        //     embed-demo 与 `proteus-jni::host`）必须**同批改**——
        //     ★`scripts/check-anim-record-bytes.mjs` 会从本处的写入序列**推出**宽度并与各消费端对账。
        let mut buf = Vec::with_capacity(out.updates.len() * 192);
        for v in out.updates {
            buf.extend_from_slice(&v.id.to_le_bytes());
            buf.extend_from_slice(&v.tx.to_le_bytes());
            buf.extend_from_slice(&v.ty.to_le_bytes());
            buf.extend_from_slice(&v.scale.to_le_bytes());
            buf.extend_from_slice(&v.rotate.to_le_bytes());
            buf.extend_from_slice(&v.opacity.to_le_bytes());
            buf.extend_from_slice(&v.bg.unwrap_or(u32::MAX).to_le_bytes());
            buf.extend_from_slice(&v.text_color.unwrap_or(u32::MAX).to_le_bytes());
            // ★B 批：3D 旋转（末尾追加——偏移 @32/@36）
            buf.extend_from_slice(&v.rotate_x.to_le_bytes());
            buf.extend_from_slice(&v.rotate_y.to_le_bytes());
            // ★C1：裁剪形状（末尾追加——偏移 @40 起：kind u32 + 16×f32）
            let (ck, cp) = v.clip.map(|(k, p)| (k as u32, p)).unwrap_or((0, [0.0; 16]));
            buf.extend_from_slice(&ck.to_le_bytes());
            for i in 0..16 {
                buf.extend_from_slice(&cp[i].to_le_bytes());
            }
            // ★C2：描边进度（末尾追加——偏移 @108；无描边路径时写 u32::MAX 的位模式）
            buf.extend_from_slice(&v.stroke_progress.unwrap_or(f32::NAN).to_le_bytes());
            // ★★渐变 v2（末尾追加——偏移 @112 起）：kind u32 + n u32 + 8×colors u32 + 8×offsets f32
            //   （kind=0 = 无渐变/未变化 ⇒ 宿主忽略；kind≠0 时 colors/offsets 是**已混合**结果）
            let (gk, gn, gc, go) = v
                .grad
                .map(|(k, n, c, o)| (k as u32, n as u32, c, o))
                .unwrap_or((0, 0, [0u32; 8], [0f32; 8]));
            buf.extend_from_slice(&gk.to_le_bytes());
            buf.extend_from_slice(&gn.to_le_bytes());
            for i in 0..8 {
                buf.extend_from_slice(&gc[i].to_le_bytes());
            }
            for i in 0..8 {
                buf.extend_from_slice(&go[i].to_le_bytes());
            }
            // ★★路径变形 v1（末尾追加——偏移 @184）：当前变形因子（NaN = 本节点无 B 态）。
            //   ★**只带因子**（4B）——段列表是变长数据、且只在因子变化时需要 ⇒ 宿主按需
            //     调 `proteus_layout_svg_morph_path` 取（避免每帧搬运整条路径）。
            buf.extend_from_slice(&v.path_morph.unwrap_or(f32::NAN).to_le_bytes());
            // ★★发光强度（glow v1，末尾追加——偏移 @188；NaN = 本节点无发光，宿主保持静态）
            buf.extend_from_slice(&v.glow_intensity.unwrap_or(f32::NAN).to_le_bytes());
        }
        Ok(buf)
    });
    match r {
        Ok(Ok(buf)) => {
            let n = buf.len();
            let mut boxed = buf.into_boxed_slice();
            let ptr = boxed.as_mut_ptr();
            std::mem::forget(boxed);
            unsafe { *out_len = n as u32 };
            ptr
        }
        Ok(Err(e)) => {
            eprintln!("[proteus] anim_tick_bin 失败：{e}");
            std::ptr::null_mut()
        }
        Err(_) => {
            eprintln!("[proteus] anim_tick_bin 内部 panic（已捕获）");
            std::ptr::null_mut()
        }
    }
}

/// ★★**当前变形后的段列表**（路径变形 v1）——入参 `{"nodeId":N}`；返回
///   `{"ok":true,"segs":[…],"totalLen":x,"morph":t}`（段形态与 `svg_nodes` 的 `segs` **同构**——
///   同一份 `PathSeg` serde 序列化，宿主翻译器零改动复用）。
///
/// 【为什么按需查询（而不是每帧进定长记录）】段列表是**变长**数据（一条路径几十到几百段）——
///   塞进每帧记录会把 188B 的定长块吹成 KB 级；而它只在**变形因子变化**时才需要重取
///   （宿主见 `path_morph` 值变 ⇒ 调本入口；值不变 ⇒ 沿用上次的 path）。
///
/// 语义：`morphed(A, B, path_morph)` —— A/B 两态与因子都在内核（唯一 lerp 实现）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_svg_morph_path(
    handle: u64,
    json: *const c_char,
) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if json.is_null() {
            return Err("入参为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| format!("入参解析失败：{e}"))?;
        let node_id = v
            .get("nodeId")
            .and_then(|x| x.as_u64())
            .ok_or_else(|| "缺少 nodeId（应为本节点 id）".to_string())? as u32;
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let node = entry
            .tree
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .ok_or_else(|| format!("节点 {node_id} 不在树上"))?;
        let a = node
            .style
            .svg_path
            .as_ref()
            .ok_or_else(|| format!("节点 {node_id} 没有 svgPath（A 态）——变形需要两态"))?;
        let b = node
            .style
            .svg_path_to
            .as_ref()
            .ok_or_else(|| format!("节点 {node_id} 没有 svgPathTo（B 态）——变形需要两态"))?;
        let t = node.style.path_morph;
        let morphed = a.morphed(b, t);
        Ok(serde_json::json!({
            "ok": true,
            "segs": morphed.segs,
            "totalLen": morphed.total_len,
            "morph": t,
            // ★重采样标注（v2）：异构路径对在**建树时**被重采样到同构——如实告知调用方
            //   （几何是重采样近似，与原 `d` 弧长差 <3%）
            "resampled": node.style.svg_morph_resampled,
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", serde_json::to_string(&e).unwrap_or_else(|_| "\"?\"".into()))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"内部 panic（已捕获）\"}".to_string()),
    }
}

/// ★★**当前变形后的段列表（二进制）**（2026-10-01 · 性能修正）——每帧路径。
///
/// 【为什么必须有（真机读数）】JSON 版（`proteus_layout_svg_morph_path`）在 moonGlow 幕
///   把每帧工作 p95 从 0.17ms 抬到 **2.57ms**（9 条山脊 × 每帧 JSON 编解码 + org.json 解析）
///   ——正是 tick_bin 当年被二进制化的同一条理由（"每帧 O(N) 条走 JSON 是白付"）。
///   ⇒ 二进制版：**一次 JNI 拷贝 + 定长字段**，宿主零 JSON 解析。
///
/// 【格式（全小端）】`u32 count` + 每条目 `u32 tag` + 坐标（f32）：
///   · tag 0 = MoveTo(x,y) · 1 = LineTo(x,y) · 2 = CubicTo(x1,y1,x2,y2,x,y)
///   · tag 3 = QuadTo(x1,y1,x,y) · 4 = Close（无坐标）
///   ★tag 与坐标都用 4 字节（对齐简单；路径段数小，字节数不敏感）。
///   ★JSON 版保留：给内核测试/人工诊断用（"可读"），生产路径走本二进制版。
///
/// # Safety
/// 返回指针须用 `proteus_rects_free` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_svg_morph_path_bin(
    handle: u64,
    node_id: u32,
    out_len: *mut u32,
) -> *mut u8 {
    unsafe { *out_len = 0 };
    let r = std::panic::catch_unwind(|| -> Result<Vec<u8>, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let node = entry
            .tree
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .ok_or_else(|| format!("节点 {node_id} 不在树上"))?;
        let a = node
            .style
            .svg_path
            .as_ref()
            .ok_or_else(|| format!("节点 {node_id} 没有 svgPath（A 态）"))?;
        let b = node
            .style
            .svg_path_to
            .as_ref()
            .ok_or_else(|| format!("节点 {node_id} 没有 svgPathTo（B 态）"))?;
        let morphed = a.morphed(b, node.style.path_morph);
        let mut buf = Vec::with_capacity(4 + morphed.segs.len() * 28);
        buf.extend_from_slice(&(morphed.segs.len() as u32).to_le_bytes());
        for sg in &morphed.segs {
            let tag: u32 = match sg {
                crate::svg_path::PathSeg::MoveTo(..) => 0,
                crate::svg_path::PathSeg::LineTo(..) => 1,
                crate::svg_path::PathSeg::CubicTo(..) => 2,
                crate::svg_path::PathSeg::QuadTo(..) => 3,
                crate::svg_path::PathSeg::Close => 4,
            };
            buf.extend_from_slice(&tag.to_le_bytes());
            match *sg {
                crate::svg_path::PathSeg::MoveTo(x, y) | crate::svg_path::PathSeg::LineTo(x, y) => {
                    buf.extend_from_slice(&x.to_le_bytes());
                    buf.extend_from_slice(&y.to_le_bytes());
                }
                crate::svg_path::PathSeg::CubicTo(x1, y1, x2, y2, x, y) => {
                    for v in [x1, y1, x2, y2, x, y] {
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                crate::svg_path::PathSeg::QuadTo(x1, y1, x, y) => {
                    for v in [x1, y1, x, y] {
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                crate::svg_path::PathSeg::Close => {}
            }
        }
        Ok(buf)
    });
    match r {
        Ok(Ok(buf)) => {
            let n = buf.len();
            let mut boxed = buf.into_boxed_slice();
            let ptr = boxed.as_mut_ptr();
            std::mem::forget(boxed);
            unsafe { *out_len = n as u32 };
            ptr
        }
        Ok(Err(e)) => {
            eprintln!("[proteus] svg_morph_path_bin 失败：{e}");
            std::ptr::null_mut()
        }
        Err(_) => {
            eprintln!("[proteus] svg_morph_path_bin 内部 panic（已捕获）");
            std::ptr::null_mut()
        }
    }
}

/// ★★**带文字色的节点清单**（2026-10-01，文字色通道的取样入口——与 `bg_nodes` 对称）
///
/// 返回：`{"ok":true,"ids":[…],"count":N}`（最多 64 个）。
/// 【为什么单列一个（而不是让调用方从 bg 清单推）】底色与文字色是**两个独立基色**
///   （节点可能只声明其一）⇒ 取样必须问各自的清单（真机判据的取样纪律：向唯一事实源要答案）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_text_color_nodes(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let ids: Vec<u32> = entry
            .tree
            .nodes
            .iter()
            .filter(|n| n.style.text_color_base.is_some())
            .map(|n| n.id)
            .take(64)
            .collect();
        Ok(serde_json::json!({"ok": true, "ids": ids, "count": ids.len()}).to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★★**带裁剪形状的节点清单**（2026-10-01 · C1；与 `bg_nodes`/`text_color_nodes` 同一取样纪律）
///
/// 返回：`{"ok":true,"ids":[…],"count":N}`（最多 64 个）。
/// 【为什么单列一个】目标节点 id 由适配器/Vue **动态分配**（调用方无法预知）——
///   裁剪动画的前提是"节点声明了 clipPath"，取样必须**向唯一事实源要答案**
///   （首次接通时真机实测：探针盲取 targets[0] ⇒ started=0 且原因误导）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_clip_nodes(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let ids: Vec<u32> = entry
            .tree
            .nodes
            .iter()
            .filter(|n| n.style.clip_kind != 0)
            .map(|n| n.id)
            .take(64)
            .collect();
        Ok(serde_json::json!({"ok": true, "ids": ids, "count": ids.len()}).to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★★**带 SVG 路径的节点清单 + 路径详情**（2026-10-01 · C2）
///
/// 返回：`{"ok":true,"ids":[…],"paths":{id: {segs, strokeColor, strokeWidth, totalLen}}, "count":N}`。
///
/// 【为什么把**解析结果**一并回带（真机接通抓出的设计缺口）】宿主建层需要**段列表**才能建
///   平台 path，而 `d` 的解析**只在核内做**（单一实现）⇒ 宿主拿请求树里的 `d` 字符串
///   是**解析不出**段列表的（首版建层时两难：要么宿主自己解析（第二份实现）、要么拿不到）。
///   ⇒ 正解：把内核已解析好的段列表**随查询回带**——宿主只翻译、不解析（纪律 #22）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_svg_nodes(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let mut ids: Vec<u32> = Vec::new();
        let mut paths = serde_json::Map::new();
        for n in entry.tree.nodes.iter() {
            if let Some(sp) = n.style.svg_path.as_ref() {
                if ids.len() >= 64 {
                    break;
                }
                ids.push(n.id);
                paths.insert(
                    n.id.to_string(),
                    serde_json::json!({
                        "segs": sp.segs,
                        "strokeColor": n.style.stroke_color,
                        "strokeWidth": n.style.stroke_width,
                        "totalLen": sp.total_len,
                    }),
                );
            }
        }
        let count = ids.len();
        Ok(serde_json::json!({"ok": true, "ids": ids, "paths": paths, "count": count}).to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★★**带底色的节点清单**（2026-10-01，颜色通道的取样入口）
///
/// 【为什么需要它（真机判据抓出的取样缺陷）】颜色动画要求目标节点在内核里有**底色**
///   （`bg_base`——起点与复位基准）。而帧内节点的 id 由适配器/Vue 渲染动态分配，
///   调用方**无法事先知道**哪个 id 有底色 ⇒ 只能盲试（真机实测：逐个试启动颜色动画，
///   全被拒，最后落回 `?? 2` 这个不存在的兜底 ⇒ 判据判红**且原因误导**）。
///   ⇒ 暴露本查询：调用方（相位/判据）先问"哪些节点有底色"，再选目标。
///
/// 入参：无。返回：`{"ok":true,"ids":[…],"count":N}`（最多 64 个，按节点顺序）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_bg_nodes(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let ids: Vec<u32> = entry
            .tree
            .nodes
            .iter()
            .filter(|n| n.style.bg_base.is_some())
            .map(|n| n.id)
            .take(64)
            .collect();
        Ok(serde_json::json!({"ok": true, "ids": ids, "count": ids.len()}).to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// ★★**播放控制**（2026-10-01 · A3）：全局时间因子 / 暂停 / 恢复。
///
/// 入参 JSON：`{"timeScale": 1.0, "paused": false}`（两键都可省——只改给出的那个）
///   · `timeScale`：全局时间缩放（`0.25` 慢动作 / `2.0` 快进；**只影响时间推进**——
///     seek/滚动驱动的进度由外部给，与全局时钟无关，不受影响）；
///   · `paused`：暂停（时间不推进；**仍写值**——层重建不丢姿态，与 Progress 驱动同款）。
///
/// 返回：`{"ok":true,"timeScale":<当前>,"paused":<当前>}`（回显生效值，便于判据断言）。
/// ★为什么是"设置并回显"而不是 set/get 两个入口：一次跨边界拿到权威状态（判据一条调用即可）。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串。返回指针须用 `proteus_string_free` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_control(handle: u64, json: *const c_char) -> *mut c_char {
    let f = || -> Result<String, String> {
        let raw = unsafe { std::ffi::CStr::from_ptr(json) }.to_string_lossy();
        let v: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("播放控制入参不是 JSON：{e}"))?;
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        if let Some(ts) = v.get("timeScale").and_then(|x| x.as_f64()) {
            let ts = ts as f32;
            if !ts.is_finite() || ts < 0.0 {
                return Err(format!(
                    "timeScale 非法：{ts}（应 ≥ 0 的有限数；0 = 冻结，0.25 = 慢动作，2 = 快进）"
                ));
            }
            entry.anim.time_scale = ts;
        }
        if let Some(p) = v.get("paused").and_then(|x| x.as_bool()) {
            entry.anim.paused = p;
        }
        Ok(serde_json::json!({
            "ok": true,
            "timeScale": entry.anim.time_scale,
            "paused": entry.anim.paused,
        })
        .to_string())
    };
    match std::panic::catch_unwind(f) {
        Ok(Ok(s)) => CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut()),
        Ok(Err(e)) => CString::new(serde_json::json!({"ok": false, "error": e}).to_string())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(_) => CString::new("{\"ok\":false,\"error\":\"内部 panic（已捕获）\"}")
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

/// ★★**仍在推进的动画条数**（0 = 全部结束）——幕切换的唯一权威判据
///
/// 【为什么必须在内核回答（2026-09-30 真机取证）】"这一幕演完了吗"**不能**由调用方按
///   `delayMs + durMs` 推算：弹簧动画的时长由**物理**决定（名义 `durMs` 只是采样窗口，
///   实际在 `settle_eps` 内静止才结束）⇒ JS 侧推算的"幕时长"要么早切（姿态没到）要么多等
///   （可见的停顿——真机实测：每幕末尾一段"结束等会儿再开始"）。
///   内核 tick 只回"**变化**记录"，静止但仍未结束的动画不在里面 ⇒ 外部无法推断。
///   ⇒ 把"还有几条在动"作为**极小的标量查询**暴露出来（一次调用 = 一个 usize，零拷贝零分配）。
///
/// 语义：`a.drive == Progress` 的动画**永不自动结束**（由 stop 显式结束，见 `step` 注释）
///   ⇒ 它们也会被计入——对"幕是否结束"的用途正是想要的语义（滚动/手势驱动的幕不应该自动切走）。
///
/// # Safety
/// 纯标量返回，无指针；句柄不存在时返回 0（与"没有动画"同义，调用方不会卡住）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_anim_active(handle: u64) -> u64 {
    let r = std::panic::catch_unwind(|| -> u64 {
        let Ok(reg) = registry().lock() else { return 0 };
        match reg.get(&handle) {
            Some(entry) => entry.anim.len() as u64,
            None => 0,
        }
    });
    r.unwrap_or(0)
}

/// ★V4 —— **变化集二进制返回**：应用指令后把变化矩形以二进制写回
///
/// 【与 `proteus_layout_apply_ops` 的关系】
///   后者返回 JSON（含 `rects` 字段，222KB / 4003 条）；本函数**只返回二进制矩形**（80KB）。
///   调用方可先 `apply_ops` 拿元信息（applied/relayout/scopes，这些都很小），
///   再用本函数取几何——把最大的那块通道换成二进制。
///   （也可以一步到位：见 `proteus_layout_apply_ops_bin`。）
///
/// # Safety
/// `out_len` 须为有效指针（写入字节数）。返回指针须用 `proteus_rects_free` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_rects_bin(handle: u64, out_len: *mut u32) -> *mut u8 {
    let r = std::panic::catch_unwind(|| -> Result<Vec<u8>, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        // ★★只收集**最近一次重排范围内**的矩形（与 JSON 路径同语义）
        //
        // 【为什么（本仓实测的回退）】若返回整树，类A（只改 1 个圆点）也会给宿主 4003 条
        //   ⇒ 宿主白做排序/过滤 ⇒ `layers` 0.06ms → 4.38ms。
        //   `last_scopes` 为空（尚未 apply 过 / 全量场景）才退回整树。
        let mut items: Vec<(u32, crate::style::Rect)> = Vec::new();
        if entry.last_scopes.is_empty() {
            items.reserve(entry.tree.len());
            for &root in &entry.tree.roots {
                crate::rects_bin::collect_abs_pairs(&entry.tree, root, 0.0, 0.0, &mut items);
            }
        } else {
            for &scope in &entry.last_scopes {
                let (pox, poy) = parent_origin_of(&entry.tree, scope);
                crate::rects_bin::collect_abs_pairs(&entry.tree, scope, pox, poy, &mut items);
            }
        }
        Ok(crate::rects_bin::encode_rects(&items))
    });
    match r {
        Ok(Ok(bytes)) => {
            if !out_len.is_null() {
                unsafe { *out_len = bytes.len() as u32 };
            }
            let mut v = bytes;
            v.shrink_to_fit();
            let ptr = v.as_mut_ptr();
            std::mem::forget(v);
            ptr
        }
        _ => {
            if !out_len.is_null() {
                unsafe { *out_len = 0 };
            }
            std::ptr::null_mut()
        }
    }
}

/// 释放 `proteus_layout_rects_bin` 的返回值
///
/// # Safety
/// `ptr`/`len` 必须来自 `proteus_layout_rects_bin` 且尚未释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_rects_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // 与分配时同布局重建（encode_rects 用 Vec::with_capacity 后 extend，capacity 可能 > len；
    // 已在写出前 shrink_to_fit ⇒ capacity == len）
    unsafe { drop(Vec::from_raw_parts(ptr, len as usize, len as usize)) };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ★★**颜色解析的钉值表**（2026-10-01）——TS 侧 golden 的**期望值来源**
    ///
    /// 【为什么钉成表（而不是各写各的公式）】颜色解析是**跨语言契约**：TS 侧
    ///   `parseColorToChannels`（`@proteus-vue/animation`）与内核实现在同一批输入上
    ///   必须给出**同一个打包值**。本测试把 Rust 侧的实测输出钉死；
    ///   `tests/anim-color-golden.test.ts` 断言 TS 侧产出同一批值 ⇒ 任一侧改规则 ⇒ 当场红。
    ///   ★新增/修改颜色形态（如将来支持 `rgb()` / 8 位 AARRGGBB）必须**同批**改这两处。
    ///
    /// 表格式：`(输入, 期望打包值 0xAARRGGBB, 是否合法)`
    const COLOR_CASES: &[(&str, u32, bool)] = &[
        ("#f0a", 0xFF_FF00AA, true),      // 3 位简写：各通道重复一位，alpha = FF
        ("#33", 0, false),                // 位数非法（2）
        ("#12345", 0, false),             // 位数非法（5）
        ("#ff5533", 0xFF_FF5533, true),   // 6 位：不透明
        ("#2f6fed", 0xFF_2F6FED, true),
        ("#11223344", 0x44_112233, true), // 8 位：CSS4 序（低 8 位 = alpha）
        ("#00000000", 0x00_000000, true), // 全透明黑（合法，不是"未设置"）
        ("#ffffffff", 0xFF_FFFFFF, true),
        ("ff5533", 0, false),             // 缺 '#'
        ("#gggggg", 0, false),            // 非十六进制
        ("#ABC", 0xFF_AABBCC, true),      // 大写 + 简写
    ];

    /// ★★**curveBezier JSON 解析**（2026-10-01 自定义曲线转正）——两处 anim 入口共用
    ///
    /// 守两件事：① 合法控制点解析成 BezierTable（且缓存命中同一 Arc）；
    ///   ② 非法形态（数量错 / 非数字 / x 越界）**明确拒绝**且消息含 nodeId（可定位）。
    #[test]
    fn parse_curve_bezier_accepts_valid_and_rejects_bad() {
        let ok = serde_json::json!({ "curveBezier": [0.34, 1.56, 0.64, 1.0] });
        let t = parse_curve_bezier(&ok, 7).expect("合法控制点应通过").expect("应产生表");
        let t2 = parse_curve_bezier(&ok, 7).unwrap().unwrap();
        assert!(std::sync::Arc::ptr_eq(&t, &t2), "同控制点应命中缓存（800 片共享一份表）");
        // 无字段 ⇒ None（不影响旧声明）
        assert!(parse_curve_bezier(&serde_json::json!({}), 7).unwrap().is_none());
        // 非法：数量错 / 非数字 / x 越界 —— 全部拒绝且消息含 nodeId
        for (bad, needle) in [
            (serde_json::json!({ "curveBezier": [0.3, 1.5, 0.6] }), "4 个数"),
            (serde_json::json!({ "curveBezier": ["a", 1, 0, 1] }), "不是数字"),
            (serde_json::json!({ "curveBezier": [-0.1, 1.5, 0.64, 1] }), "[0,1]"),
            (serde_json::json!({ "curveBezier": [0.34, 1.5, 1.2, 1] }), "[0,1]"),
        ] {
            let err = parse_curve_bezier(&bad, 7).expect_err("非法输入必须被拒绝");
            assert!(err.contains(needle) || err.contains("节点 7"), "错误消息应可定位：{err}");
            assert!(err.contains("节点 7"), "错误消息应含 nodeId：{err}");
        }
    }

    /// ★★**clipPath 声明解析**（C1）——三种形状 + 全部拒绝分支（消息可定位）
    #[test]
    /// ★★路径变形（v1）：端到端（建树 → 通道 → 查询入口返回**变形后**的段）+ 拒绝分支。
    #[test]
    fn svg_path_morph_end_to_end_and_rejects() {
        // 同构两态：一条水平线 → 一条斜线
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 100.0, "height": 100.0,
                 "svgPath": {"d": "M0 0 L10 0", "stroke": "#112233", "strokeWidth": 2},
                 "svgPathTo": {"d": "M0 0 L20 10"}}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        assert!(h > 0, "同构两态应建树成功");
        // 启动变形动画（通道 33）到半程
        let start = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 33, "from": 0.0, "to": 1.0, "durMs": 100, "curve": 0}]
        });
        unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let mut n: u32 = 0;
        let p = unsafe { proteus_layout_anim_tick_bin(h, 50.0, &mut n) };
        assert_eq!(n, 188, "记录应为 188B（含 morph 因子）");
        let sl = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
        unsafe { proteus_rects_free(p, n) };
        let morph = f32::from_le_bytes([sl[184], sl[185], sl[186], sl[187]]);
        assert!((morph - 0.5).abs() < 0.05, "半程因子应 ≈0.5，实际 {morph}");
        // 查询变形后的段：终点应 ≈(15, 5)
        let q = serde_json::json!({"nodeId": 9});
        let r = unsafe {
            proteus_layout_svg_morph_path(h, std::ffi::CString::new(q.to_string()).unwrap().as_ptr())
        };
        let js = unsafe { std::ffi::CStr::from_ptr(r) }.to_string_lossy().to_string();
        unsafe { proteus_layout_free_string(r) };
        let v: serde_json::Value = serde_json::from_str(&js).expect("查询应返回 JSON");
        assert_eq!(v["ok"], true, "查询应成功：{js}");
        let end = &v["segs"][1]["LineTo"];
        let ex = end[0].as_f64().unwrap();
        let ey = end[1].as_f64().unwrap();
        assert!((ex - 15.0).abs() < 0.5, "半程终点 x≈15，实际 {ex}");
        assert!((ey - 5.0).abs() < 0.5, "半程终点 y≈5，实际 {ey}");
        unsafe { proteus_layout_destroy(h) };
    }

    /// ★★路径变形 v2：**异构自动重采样**（不再拒绝）——上限/退化的拒绝分支也在本测试。
    #[test]
    fn svg_path_morph_v2_auto_resamples_hetero() {
        use crate::ffi::proteus_layout_create;
        let mk = |a: Option<&str>, b: Option<&str>| -> u64 {
            let mut node = serde_json::json!({"id": 9, "parentId": 1, "width": 100.0, "height": 100.0});
            if let Some(ad) = a {
                node["svgPath"] = serde_json::json!({"d": ad, "strokeWidth": 2});
            }
            if let Some(bd) = b {
                node["svgPathTo"] = serde_json::json!({"d": bd});
            }
            let req = serde_json::json!({
                "viewport": {"width": 100.0, "height": 100.0},
                "nodes": [{"id": 1, "width": 100.0, "height": 100.0}, node]
            });
            unsafe { proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr()) }
        };
        // ★L vs C：现在**接受**（自动重采样到同构）
        assert!(mk(Some("M0 0 L10 0"), Some("M0 0 C1 1 2 2 10 0")) > 0, "L vs C 应自动重采样");
        // ★段数不同（2 段 vs 3 段）：接受
        assert!(mk(Some("M0 0 L10 0"), Some("M0 0 L5 0 L10 0")) > 0, "段数不同应自动重采样");
        // 圆（C×2）→ 三角（L×2+Z）：接受（闭合语义统一为开放）
        assert!(mk(Some("M0 5 C1 1 9 1 10 5"), Some("M0 0 L10 0 L5 9 Z")) > 0, "闭合差异应统一");
        // 只有 B 态：拒绝（无 A 无从变形）
        assert_eq!(mk(None, Some("M0 0 L10 0")), 0, "只有 B 态应拒绝");
        // 退化（零长）：拒绝并给修法
        assert_eq!(mk(Some("M5 5"), Some("M0 0 L1 0")), 0, "退化 A 态应拒绝");
        // 异构 + 多子路径：拒绝（不做子路径配对猜测）
        assert_eq!(mk(Some("M0 0 L1 0 M2 0 L3 0"), Some("M0 0 C1 1 2 2 10 0")), 0, "异构多子路径应拒绝");
        // 同构 + 多子路径：照旧可用（不重采样）
        assert!(mk(Some("M0 0 L1 0 M2 0 L3 0"), Some("M0 0 L2 0 M4 0 L6 0")) > 0, "同构多子路径仍可用");
        // 同构：接受（零重采样）
        assert!(mk(Some("M0 0 L10 0"), Some("M0 0 L20 10")) > 0, "同构应成功");
        assert!(mk(Some("M0 0 L10 0"), None) > 0, "只有 A 态应成功（只是不可变形）");
    }

    /// 拒绝分支（v2 保留项）：只在 B 态 / 退化 A —— 都必须明确拒绝（含修法）。
    #[test]
    fn svg_path_morph_rejects_missing_a_or_degenerate_only() {
        use crate::ffi::proteus_layout_create;
        let mk = |a: Option<&str>, b: Option<&str>| -> u64 {
            let mut node = serde_json::json!({"id": 9, "parentId": 1, "width": 100.0, "height": 100.0});
            if let Some(ad) = a {
                node["svgPath"] = serde_json::json!({"d": ad, "strokeWidth": 2});
            }
            if let Some(bd) = b {
                node["svgPathTo"] = serde_json::json!({"d": bd});
            }
            let req = serde_json::json!({
                "viewport": {"width": 100.0, "height": 100.0},
                "nodes": [{"id": 1, "width": 100.0, "height": 100.0}, node]
            });
            unsafe { proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr()) }
        };
        assert_eq!(mk(None, Some("M0 0 L10 0")), 0, "只有 B 态应拒绝");
        assert_eq!(mk(Some("M5 5"), Some("M0 0 L1 0")), 0, "退化 A 态应拒绝");
    }


    fn parse_clip_path_shapes_and_rejects() {
        // inset：4 参 → kind 1，槽 0..3
        let (k, p) = parse_clip_path(&serde_json::json!({ "kind": "inset", "params": [0.1, 0.2, 0.3, 0.4] })).unwrap();
        assert_eq!(k, 1);
        assert_eq!([p[0], p[1], p[2], p[3]], [0.1, 0.2, 0.3, 0.4]);
        // circle：3 参 → kind 2
        let (k, p) = parse_clip_path(&serde_json::json!({ "kind": "circle", "params": [0.5, 0.5, 0.3] })).unwrap();
        assert_eq!(k, 2);
        assert_eq!(p[2], 0.3);
        // polygon：6 参（3 点）→ kind 3；8 点（16 参）边界
        let (k, p) = parse_clip_path(&serde_json::json!({ "kind": "polygon", "params": [0.0, 0.0, 1.0, 0.0, 0.5, 1.0] })).unwrap();
        assert_eq!(k, 3);
        assert_eq!([p[0], p[1], p[4], p[5]], [0.0, 0.0, 0.5, 1.0]);
        let pts8: Vec<f32> = (0..16).map(|i| i as f32 / 16.0).collect();
        assert!(parse_clip_path(&serde_json::json!({ "kind": "polygon", "params": pts8 })).is_ok(), "8 点应放行");
        // 全部拒绝分支（消息可定位）
        for (bad, needle) in [
            (serde_json::json!({ "kind": "ellipse", "params": [1.0] }), "未知"),
            (serde_json::json!({ "kind": "inset", "params": [0.1, 0.2] }), "数量不符"),
            // ★polygon 3 参：先撞"数量不符"（6..=16）；成对检查是第二道（5 参时才触发）
            (serde_json::json!({ "kind": "polygon", "params": [0.0, 0.0, 1.0] }), "数量不符"),
            // 7 参：数量在 6..=16 内但为奇数 ⇒ 精确指向"成对"
            (serde_json::json!({ "kind": "polygon", "params": [0.0, 0.0, 1.0, 0.0, 0.5, 1.0, 0.1] }), "成对"),
            (serde_json::json!({ "kind": "inset", "params": [0.1, 0.2, 0.3, "x"] }), "非数字"),
            (serde_json::json!({ "params": [1.0] }), "缺少 kind"),
        ] {
            let err = parse_clip_path(&bad).expect_err("非法输入必须拒绝");
            assert!(err.contains(needle), "错误消息含 {needle}：{err}");
        }
    }

    /// ★★**repeat/yoyo 的跨语言字段形态**（2026-10-01 真机分叉修正的回归锁）
    ///
    /// 【为什么必须钉】TS 编译产物发 `{ repeat: 2, alternate: true }`；内核首版只认
    ///   `direction: "alternate"` ⇒ 真机上 yoyo **静默不生效**（该幕第 2 遍重跑而非回程，
    ///   末态 180° 而应 0°）。两侧各自的单测都绿——只有真机判据（check-flip.py ④）抓到。
    ///   ⇒ 本测试把**两种形态**都钉住（TS 形态必须工作；字符串形态向后兼容）。
    #[test]
    fn repeat_yoyo_field_forms() {
        // TS 编译产物形态：alternate: true
        let ts_form = serde_json::json!({ "repeat": 2, "alternate": true });
        let (it, alt) = parse_repeat(&ts_form, 7).unwrap();
        assert_eq!(it, 2.0);
        assert!(alt, "TS 形态 alternate:true 必须被识别（否则 yoyo 真机静默失效）");
        // 字符串形态（向后兼容）
        let str_form = serde_json::json!({ "repeat": 3, "direction": "alternate" });
        let (it2, alt2) = parse_repeat(&str_form, 7).unwrap();
        assert_eq!(it2, 3.0);
        assert!(alt2);
        // 无 repeat ⇒ 缺省（1 遍、非 yoyo）
        let plain = serde_json::json!({});
        let (it3, alt3) = parse_repeat(&plain, 7).unwrap();
        assert_eq!(it3, 1.0);
        assert!(!alt3);
        // infinite + alternate（呼吸灯的典型形态）
        let inf = serde_json::json!({ "repeat": "infinite", "alternate": true });
        let (it4, alt4) = parse_repeat(&inf, 7).unwrap();
        assert_eq!(it4, -1.0);
        assert!(alt4);
    }

    /// ★★**anim_start 全链路**：JSON（含 curveBezier）→ Anim（curve_pts 生效）——
    ///   守"线格式字段名与内核解析键名一致"（两侧各写各的名字是经典的静默失联）。
    #[test]
    fn anim_start_json_parses_curve_bezier_into_anim() {
        // 直接构造请求体（不经过 FFI 句柄）——复刻 anim_start 的解析路径
        let req = serde_json::json!({
            "anims": [{ "nodeId": 1, "kind": 1, "curve": 1, "curveBezier": [0.34, 1.56, 0.64, 1.0],
                        "from": 0.0, "to": 100.0, "durMs": 400.0 }]
        });
        let list = req.get("anims").unwrap().as_array().unwrap();
        let a = &list[0];
        let node_id = a.get("nodeId").unwrap().as_u64().unwrap() as u32;
        let pts = parse_curve_bezier(a, node_id).unwrap();
        assert!(pts.is_some(), "解析器应产出 BezierTable");
        // 用该表驱动一条真实 Anim，验证求值确实走自定义曲线（过冲）——与 anim.rs 的单测同源
        let mut anim = crate::anim::Anim::curve_anim(1, crate::anim::AnimKind::TranslateY, 0.0, 100.0, 400.0);
        anim.curve_pts = pts;
        assert!(anim.value_at_progress(0.5) > 100.0, "回弹曲线中点应过冲（这证明自定义曲线真的接上了）");
    }

    #[test]
    fn parse_css_color_matches_pinned_table() {
        for (input, expect, legal) in COLOR_CASES {
            let got = parse_css_color(input);
            if *legal {
                match got {
                    Ok(v) => assert_eq!(v, *expect, "颜色 {input}：解析 {v:#010X} ≠ 期望 {expect:#010X}"),
                    Err(e) => panic!("颜色 {input} 应合法，但被拒：{e}"),
                }
            } else {
                assert!(got.is_err(), "颜色 {input} 应被拒绝，却解析出 {:#010X}", got.unwrap());
            }
        }
    }

    #[test]
    fn conformance_entry_reports_ok_on_golden() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/browser-layout.json");
        let raw = std::fs::read_to_string(path).expect("golden 应存在");
        let out = run_conformance(&raw).expect("conformance 应成功");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "真机/本机一致性入口应报 ok：{out}");
        assert!(v["compared_nodes"].as_u64().unwrap() >= 60, "比对节点数应 ≥ 60");
        assert!(v["max_delta_dp"].as_f64().unwrap() <= 0.5, "最大偏差应 ≤ 容差");
    }

    /// ★★几何指纹：**确定性**（同输入两次跑必须同值）+ **敏感性**（改一点点几何必须变）    ///
    /// 【为什么钉这两条（2026-10-01 新增，跨端一致性的机器判据）】
    ///   ① 确定性是"双端指纹可比"的前提——若同端两次跑都不同，跨端比对毫无意义；
    ///   ② 敏感性是判据**有牙**的前提——若改几何指纹不变，那"两端一致"就是自证清白
    ///      （本仓纪律：判据要能被破坏；无牙的判据比没有更糟，它给人通过感）。
    #[test]
    fn geometry_digest_is_deterministic_and_sensitive() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/browser-layout.json");
        let raw = std::fs::read_to_string(path).expect("golden 应存在");
        let a = run_conformance(&raw).expect("conformance 应成功");
        let b = run_conformance(&raw).expect("conformance 应成功");
        let va: serde_json::Value = serde_json::from_str(&a).unwrap();
        let vb: serde_json::Value = serde_json::from_str(&b).unwrap();
        let da = va["geometry_digest"].as_str().expect("报告应含 geometry_digest").to_string();
        let db = vb["geometry_digest"].as_str().unwrap().to_string();
        assert_eq!(da, db, "同输入两次跑指纹必须相同（否则跨端比对无意义）");
        assert_eq!(da.len(), 16, "指纹应为 16 位十六进制：{da}");
        assert!(da.chars().all(|c| c.is_ascii_hexdigit()), "指纹应为十六进制：{da}");

        // ★敏感性（破坏性）：把 golden 的一个期望值**挪一点点**，引擎几何不变 ⇒ 指纹必须不变
        //   （指纹吃的是**引擎算出**的值，不是 golden 期望值——这条同时验证了这一点）；
        //   再把**输入**改一点点（节点宽度）⇒ 引擎几何变化 ⇒ 指纹必须变。
        let tweaked_expect = raw.replacen("\"tolerance\": 0.5", "\"tolerance\": 0.4", 1);
        let c = run_conformance(&tweaked_expect).expect("conformance 应成功");
        let vc: serde_json::Value = serde_json::from_str(&c).unwrap();
        assert_eq!(
            vc["geometry_digest"].as_str().unwrap(),
            da,
            "指纹只吃引擎几何——golden 期望值改变不应影响它"
        );

        // 输入敏感性：构造一个最小 golden，改一个节点宽度，指纹必须变
        let mini = |w: f32| {
            format!(
                r#"{{"generatedBy":"test","note":"","viewport":{{"width":100.0,"height":100.0}},"tolerance":0.5,"cases":[{{"name":"m","nodes":[{{"id":1,"parentId":null,"width":{w},"height":50.0}}],"rects":{{"1":{{"x":0.0,"y":0.0,"width":{w},"height":50.0}}}},"textMeasures":{{}}}}]}}"#
            )
        };
        let d1 = run_conformance(&mini(60.0)).unwrap();
        let d2 = run_conformance(&mini(61.0)).unwrap();
        let v1: serde_json::Value = serde_json::from_str(&d1).unwrap();
        let v2: serde_json::Value = serde_json::from_str(&d2).unwrap();
        assert_ne!(
            v1["geometry_digest"], v2["geometry_digest"],
            "输入改 1dp 指纹必须变（否则判据无牙——本仓纪律：假绿比红更糟）"
        );
    }

    #[test]
    fn bench_entry_returns_stats() {
        let out = run_bench(4050, 5).expect("bench 应成功");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert!(v["node_count"].as_u64().unwrap() >= 4000, "应构造 ≥4000 节点");
        assert!(v["median_ms"].as_f64().unwrap() > 0.0);
    }

    /// ★破坏性：坏输入必须被**捕获并报错**，而不是 panic 跨 FFI（跨 FFI panic 是 UB）
    #[test]
    fn bad_input_is_caught_not_panicking() {
        let out = run_conformance("{ not json").expect_err("坏 JSON 应返回 Err");
        assert!(out.contains("解析失败"), "错误信息应指明解析失败：{out}");
        assert!(run_bench(0, 1).is_err(), "node_count=0 应报错");
    }

    /// ★★增量更新 FFI：改一个叶子 → `relayout_count` 必须**远小于**整树节点数
    ///
    /// 【这条测试锁什么】宿主更新路径此前只能 `destroy + create`（整树重建）；
    ///   本入口把核心既有的 `layout_incremental` 暴露出来。
    ///   判据用 `relayout_count`（增量效果的直接读数），而不是「没报错」——
    ///   否则「退化成全量」也会绿（本仓实测：无边界时增量确实退化，已加保护）。
    #[test]
    fn update_entry_is_actually_incremental() {
        // 100 行 × 40 列，**行给显式宽高** ⇒ 100 个布局边界
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        let mut id = 2u32;
        let mut mid_row_id = 0u32;
        let mut mid_leaf_id = 0u32;
        for r in 0..100 {
            nodes.push_str(&format!(
                ",{{\"id\":{id},\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0,\"width\":750.0,\"height\":20.0}}"));
            let row_id = id; id += 1;
            if r == 50 { mid_row_id = row_id; }
            for c in 0..40 {
                nodes.push_str(&format!(
                    ",{{\"id\":{id},\"parentId\":{row_id},\"width\":40.0,\"height\":16.0,\"flexShrink\":0.0}}"));
                if r == 50 && c == 10 { mid_leaf_id = id; }
                id += 1;
            }
        }
        nodes.push_str("],\"textMeasures\":{}}");
        let c = std::ffi::CString::new(nodes).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "建树应成功");
        let _ = mid_row_id;

        let patch = format!(r#"[{{"id":{mid_leaf_id},"style":{{"width":41.0}}}}]"#);
        let pc = std::ffi::CString::new(patch).unwrap();
        let p = unsafe { proteus_layout_update(h, pc.as_ptr()) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "更新应成功：{out}");
        assert_eq!(v["applied"], 1);
        let relayout = v["relayout_count"].as_u64().unwrap();
        // 整树 4101 节点；边界内重排应远小于它（实测量级 ~42：一行及其子级）
        assert!(relayout > 0, "应真的重排（relayout_count=0 说明没生效）");
        assert!(relayout < 200, "★增量未生效：重排 {relayout} 个节点（整树 4101；期望落在边界内 ≈42）");

        // 未知 id 的补丁不得报错（宿主可能持有过期补丁）——但也不能声称 applied
        let bogus = r#"[{"id":999999,"style":{"width":10.0}}]"#;
        let bc = std::ffi::CString::new(bogus).unwrap();
        let p2 = unsafe { proteus_layout_update(h, bc.as_ptr()) };
        let out2 = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        let v2: serde_json::Value = serde_json::from_str(&out2).unwrap();
        assert_eq!(v2["ok"], true);
        assert_eq!(v2["applied"], 0, "未知 id 不应计入 applied");
        assert_eq!(v2["relayout_count"], 0, "无有效补丁不应重排");

        assert!(proteus_layout_destroy(h));
    }

    /// ★★增量更新返回的「变化集」必须是**正确的绝对坐标**（与全量布局逐节点一致）
    ///
    /// 【为什么这条必须有】宿主将**直接采用**这些矩形去改 layer 的 frame ——
    ///   若绝对坐标算错，屏幕上就是**错位**（而且因为只更新这几个节点，看起来像"随机错位"，
    ///   极难归因）。故必须与「全量布局的绝对矩形」逐位比对，而不是只断言"有返回"。
    #[test]
    fn update_entry_returns_correct_absolute_rects_for_changed_nodes() {
        // 与 update_entry_is_actually_incremental 同构：100 行 × 40 列，行显式宽高 ⇒ 有边界
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        let mut id = 2u32;
        let mut mid_leaf = 0u32;
        let mut mid_row = 0u32;
        for r in 0..100u32 {
            nodes.push_str(&format!(
                ",{{\"id\":{id},\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0,\"width\":750.0,\"height\":20.0}}"));
            let row_id = id; id += 1;
            if r == 50 { mid_row = row_id; }
            for c in 0..40u32 {
                nodes.push_str(&format!(
                    ",{{\"id\":{id},\"parentId\":{row_id},\"width\":40.0,\"height\":16.0,\"flexShrink\":0.0}}"));
                if r == 50 && c == 10 { mid_leaf = id; }
                id += 1;
            }
        }
        nodes.push_str("],\"textMeasures\":{}}");
        let c = std::ffi::CString::new(nodes).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0);

        // 改中间行的一个叶子
        let patch = format!(r#"[{{"id":{mid_leaf},"style":{{"width":41.0}}}}]"#);
        let pc = std::ffi::CString::new(patch).unwrap();
        let p = unsafe { proteus_layout_update(h, pc.as_ptr()) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "{out}");
        let changed = v["rects"].as_object().expect("应返回变化集");
        assert!(!changed.is_empty(), "变化集不应为空");
        let scope_id = v["scope_id"].as_u64().unwrap();
        let _ = mid_row;

        // ★金标准：直接读**当前句柄**的全量绝对矩形（它已含本次变更）
        //   —— 该路径走 `absolute_rects()` 整树遍历，与变化集的「增量算法」是**独立实现**
        //     ⇒ 两者一致才说明增量算法真的对（而不是同一份逻辑的自证）
        let p2 = unsafe { proteus_layout_rects(h) };
        let full = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        let all = fv["rects"].as_object().unwrap();

        let mut worst = 0f64;
        let mut compared = 0usize;
        for (k, cr) in changed {
            let Some(fr) = all.get(k) else { panic!("#{k} 在变化集里但全量里没有") };
            for f in ["x", "y", "width", "height"] {
                let a = cr[f].as_f64().unwrap();
                let b = fr[f].as_f64().unwrap();
                worst = worst.max((a - b).abs());
            }
            compared += 1;
        }
        println!("变化集 {compared} 个节点（scope=#{scope_id}），与全量绝对坐标最大偏差 {worst:.4}dp");
        assert!(compared > 0, "应至少比对 1 个节点");
        assert!(worst < 0.01, "★变化集的绝对坐标与全量不一致（差 {worst:.4}dp）⇒ 宿主会画错位");
        assert!(proteus_layout_destroy(h));
    }

    /// ★★回归锁：**坏输入图必须被拒绝**，而不是把宿主打崩
    ///
    /// 【为什么这条必须有（真机 signal 11 的教训）】适配器里两个 id 分配器各自从 1 开始
    ///   ⇒ 请求里出现自环（`parentId == id`）⇒ taffy 无限递归 → **爆栈 → 应用闪退**。
    ///   布局核心是**库**：拿错数据应当返回错误，而不是终止宿主进程。
    ///   ★这类缺陷只有在「宿主真的拼错树」时才暴露，而**真机启动路径**正是第一次机会。
    #[test]
    fn malformed_input_graph_is_rejected_not_crashing() {
        // ① 自环：节点 1 的 parent 是自己
        let selfloop = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c = std::ffi::CString::new(selfloop).unwrap();
        // ★这一行以前会**爆栈**（栈溢出是 abort，测试进程会直接死掉）
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert_eq!(h, 0, "自环输入必须被拒绝（返回 0），而不是崩");

        // ② 重复 id
        let dup = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":null,"width":50.0,"height":50.0},
            {"id":1,"parentId":null,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c2 = std::ffi::CString::new(dup).unwrap();
        assert_eq!(unsafe { proteus_layout_create(c2.as_ptr()) }, 0, "重复 id 必须被拒绝");

        // ③ 两节点互指（2-cycle）
        let cycle = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":2,"width":50.0,"height":50.0},
            {"id":2,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c3 = std::ffi::CString::new(cycle).unwrap();
        assert_eq!(unsafe { proteus_layout_create(c3.as_ptr()) }, 0, "互相引用必须被拒绝");

        // ④ 对照：**合法**输入仍应成功（证明校验没有误伤）
        let good = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":null,"width":100.0,"height":100.0,"flexDirection":"column"},
            {"id":2,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c4 = std::ffi::CString::new(good).unwrap();
        let h4 = unsafe { proteus_layout_create(c4.as_ptr()) };
        assert!(h4 > 0, "合法输入不应被拒绝");
        assert!(proteus_layout_destroy(h4));
    }

    /// ★命中测试 FFI：跨界必须与核心同语义（target / path / chain 三者都对）
    ///
    /// 布局（100×100 根 + 3 个 40×40 子级横排）后按坐标命中——
    /// 这条测试同时锁住「句柄 → 布局 → 命中」的完整链路（宿主真实调用路径）。
    #[test]
    fn hit_test_entry_reports_target_path_and_chain() {
        let req = serde_json::json!({
            "viewport": {"width": 375.0, "height": 812.0},
            "nodes": [
                {"id": 1, "parentId": null, "width": 100.0, "height": 100.0, "flexDirection": "column"},
                {"id": 2, "parentId": 1, "width": 40.0, "height": 40.0},
                {"id": 3, "parentId": 1, "width": 40.0, "height": 40.0},
                // ★不写 position/overflow/isText —— 顺带复验「省略可选字段可解析」
            ],
            "textMeasures": {}
        }).to_string();
        let c = std::ffi::CString::new(req).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "create 应返回有效句柄");

        let call = |x: f32, y: f32| -> serde_json::Value {
            let p = unsafe { proteus_layout_hit_test(h, x, y) };
            let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
            unsafe { proteus_layout_free_string(p) };
            serde_json::from_str(&s).unwrap()
        };

        // 第一个子级（0,0)-(40,40) 内
        let a = call(20.0, 20.0);
        assert_eq!(a["ok"], true);
        assert_eq!(a["target"], 2, "应命中第一个子级：{a}");
        assert_eq!(a["path"], serde_json::json!([2, 1]), "路径 = 自上层到根");
        assert_eq!(a["chain"], serde_json::json!([2, 1]), "冒泡链 = target + 祖先");

        // 两个子级之间（垂直方向超出子级高度但在根内）→ 命中根
        let b = call(20.0, 80.0);
        assert_eq!(b["target"], 1, "该点只在根内：{b}");
        assert_eq!(b["chain"], serde_json::json!([1]));

        // 完全在外 → 未命中（三个数组均为空）
        let m = call(500.0, 500.0);
        assert_eq!(m["target"], serde_json::Value::Null, "界外应未命中");
        assert_eq!(m["path"], serde_json::json!([]));
        assert_eq!(m["chain"], serde_json::json!([]));

        // 销毁后命中必须安全报错（不得 panic / 不得读到已释放内存）
        assert!(proteus_layout_destroy(h));
        let dead = call(20.0, 20.0);
        assert_eq!(dead["ok"], false, "已销毁句柄应报错：{dead}");
    }

    /// ★★回归锁：省略可选字段（isText / nativeHost / 各类 Optional）的请求必须能解析
    ///
    /// 背景（本仓实测踩到）：`isText` 与 `nativeHost` 是 bool 而**无 `#[serde(default)]`**，
    /// 调用方（含本仓自己的请求构造器）不为「非文本节点」写 `isText:false` →
    /// **整个 4051 节点的请求解析失败**，而症状是「create 返回 0」+「耗时异常」，
    /// 极具误导性（我一度把它归因为「JSON 通道慢」）。
    #[test]
    fn omitted_optional_fields_are_accepted() {
        let minimal = r#"{"viewport":{"width":100,"height":100},"nodes":[{"id":1,"parentId":null,"width":50.0,"height":50.0}]}"#;
        let req: LayoutRequest = serde_json::from_str(minimal).expect("省略 isText/nativeHost 应能解析");
        assert_eq!(req.nodes.len(), 1);
        assert!(!req.nodes[0].is_text);
        assert!(!req.nodes[0].native_host);

        // 完整规模：与请求构造器一致（只有 text 节点写 isText:true）
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        nodes.push_str(",{\"id\":2,\"parentId\":1,\"flexDirection\":\"row\"}");
        nodes.push_str(",{\"id\":3,\"parentId\":2}");                       // ← 不写 isText
        nodes.push_str(",{\"id\":4,\"parentId\":3,\"isText\":true}");
        nodes.push_str("],\"textMeasures\":{}}");
        let req2: LayoutRequest = serde_json::from_str(&nodes).expect("混合写法的请求应能解析");
        assert_eq!(req2.nodes.len(), 4);
        assert!(req2.nodes[3].is_text);
    }

    /// ★句柄生命周期：create → rects → destroy → 再次 rects 应失败
    #[test]
    fn handle_lifecycle_creates_retains_destroys() {
        let req = serde_json::json!({
            "viewport": {"width": 375.0, "height": 812.0},
            "nodes": [
                {"id": 1, "parentId": null, "width": 300.0, "height": 100.0, "flexDirection": "column"},
                {"id": 2, "parentId": 1, "width": 50.0, "height": 30.0}
            ],
            "textMeasures": {}
        }).to_string();
        let c = std::ffi::CString::new(req).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "create 应返回有效句柄");
        assert!(proteus_layout_handle_count() >= 1, "树应常驻");

        // 读几何
        let p = unsafe { proteus_layout_rects(h) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["node_count"], 2);

        // 释放后应查不到（★这是「destroy 真的释放」的证据）
        assert!(proteus_layout_destroy(h), "destroy 应成功");
        let p2 = unsafe { proteus_layout_rects(h) };
        let out2 = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        assert!(out2.contains("\"ok\":false"), "释放后读应失败：{out2}");
    }

    /// 破坏性：无效句柄不得 panic
    #[test]
    fn invalid_handle_is_safe() {
        let p = unsafe { proteus_layout_rects(999999) };
        assert!(!p.is_null());
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        assert!(s.contains("\"ok\":false"));
        assert!(!proteus_layout_destroy(999999), "销毁无效句柄应返回 false");
    }

    // ────────────────────── ★Vapor IR V3：二进制指令流的 FFI 入口 ──────────────────────

    /// 生成一份用于测试的指令字节流（与 TS 侧编码格式一致的最小实现）
    fn encode_test_ops(keys: &[&str], strings: &[&str], ops: &[crate::ops::UpdateOp]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&crate::ops::OPS_MAGIC.to_le_bytes());
        out.extend_from_slice(&crate::ops::OPS_VERSION.to_le_bytes());
        out.extend_from_slice(&(ops.len() as u32).to_le_bytes());
        out.extend_from_slice(&(keys.len() as u32).to_le_bytes());
        out.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        for k in keys {
            out.extend_from_slice(&(k.len() as u16).to_le_bytes());
            out.extend_from_slice(k.as_bytes());
        }
        for s in strings {
            out.extend_from_slice(&(s.len() as u16).to_le_bytes());
            out.extend_from_slice(s.as_bytes());
        }
        for op in ops {
            out.push(op.code() as u8);
            match op {
                crate::ops::UpdateOp::SetStyle { node_id, key_id, value } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&key_id.to_le_bytes());
                    out.extend_from_slice(&value.to_le_bytes());
                }
                crate::ops::UpdateOp::SetText { node_id, text_ref } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.extend_from_slice(&text_ref.to_le_bytes());
                }
                crate::ops::UpdateOp::ToggleVis { node_id, visible } => {
                    out.extend_from_slice(&node_id.to_le_bytes());
                    out.push(if *visible { 1 } else { 0 });
                }
                other => panic!("测试编码器未覆盖：{other:?}"),
            }
        }
        out
    }

    /// ★★V3 端到端（桌面层）：指令流 → 树变更 → 多范围增量重排
    #[test]
    fn apply_ops_binary_stream_updates_geometry() {
        // 两个兄弟行，各含一个圆点；改两行的圆点尺寸（**两个**脏节点）
        let req_json = r#"{
            "viewport": {"width": 300.0, "height": 400.0},
            "nodes": [
                {"id":1,"parentId":null,"tag":"root","style":{"flexDirection":"column","width":300.0,"height":400.0}},
                {"id":2,"parentId":1,"tag":"row","style":{"flexDirection":"row","height":50.0,"flexShrink":0.0}},
                {"id":3,"parentId":2,"tag":"dot","style":{"width":20.0,"height":20.0}},
                {"id":4,"parentId":1,"tag":"row","style":{"flexDirection":"row","height":50.0,"flexShrink":0.0}},
                {"id":5,"parentId":4,"tag":"dot","style":{"width":20.0,"height":20.0}}
            ]
        }"#;
        let handle = unsafe {
            let c = CString::new(req_json).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0, "建树应成功");

        // 改两个圆点（id 3、5）的宽度 —— 批量指令
        let ops = vec![
            crate::ops::UpdateOp::SetStyle { node_id: 3, key_id: 0, value: 80.0 },
            crate::ops::UpdateOp::SetStyle { node_id: 5, key_id: 0, value: 90.0 },
        ];
        let bytes = encode_test_ops(&["layout.width"], &[], &ops);
        let out = unsafe {
            let p = proteus_layout_apply_ops(handle, bytes.as_ptr(), bytes.len() as u32);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        assert!(out.contains("\"ok\":true"), "应用应成功：{out}");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["applied"].as_u64(), Some(2), "两条指令都应应用");
        assert!(v["dirty"].as_array().map(|a| a.len()).unwrap_or(0) >= 2, "应报告 ≥2 个脏节点");
        // ★多范围重排：两个兄弟在不同的行下 ⇒ 应各自落在自己的范围（不是全树）
        let relayout = v["relayout_count"].as_u64().unwrap_or(0);
        assert!(relayout > 0, "应发生重排");
        assert!(relayout <= 5, "重排范围不应超过全树（实测 {relayout}）");

        // 几何确实变了（不是只标记不重算）
        let rects = unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        assert!(rects.contains("80") || rects.contains("90"), "新尺寸应反映在矩形里：{rects}");
        assert!(unsafe { proteus_layout_destroy(handle) });
    }

    /// ★恶意/损坏的指令流必须被拒绝（不能 panic、不能静默改错树）
    #[test]
    fn apply_ops_rejects_corrupt_stream() {
        let req_json = r#"{"viewport":{"width":100.0,"height":100.0},"nodes":[{"id":1,"parentId":null,"tag":"root","style":{"width":100.0,"height":100.0}}]}"#;
        let handle = unsafe {
            let c = CString::new(req_json).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        // ① 垃圾字节
        let junk = vec![0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03];
        let out = unsafe {
            let p = proteus_layout_apply_ops(handle, junk.as_ptr(), junk.len() as u32);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        assert!(out.contains("\"ok\":false"), "垃圾流应被拒绝：{out}");
        // ② 空指针
        let out2 = unsafe {
            let p = proteus_layout_apply_ops(handle, std::ptr::null(), 0);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        assert!(out2.contains("\"ok\":false"), "空指针应报错而非 panic：{out2}");
        assert!(unsafe { proteus_layout_destroy(handle) });
    }

    /// ★未知节点 id 的指令必须**上报**（静默忽略 = UI 静默不更新）
    #[test]
    fn apply_ops_reports_unknown_node() {
        let req_json = r#"{"viewport":{"width":100.0,"height":100.0},"nodes":[{"id":1,"parentId":null,"tag":"root","style":{"width":100.0,"height":100.0}}]}"#;
        let handle = unsafe {
            let c = CString::new(req_json).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let ops = vec![crate::ops::UpdateOp::SetStyle { node_id: 999, key_id: 0, value: 10.0 }];
        let bytes = encode_test_ops(&["layout.width"], &[], &ops);
        let out = unsafe {
            let p = proteus_layout_apply_ops(handle, bytes.as_ptr(), bytes.len() as u32);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["applied"].as_u64(), Some(0), "未知节点不应计入 applied");
        assert!(v["unsupported"].as_array().map(|a| !a.is_empty()).unwrap_or(false),
                "★必须上报 unsupported（否则是静默不更新）：{out}");
        assert!(unsafe { proteus_layout_destroy(handle) });
    }

    /* ────────────────────── ★★V7：结构变更（splice）────────────────────── */

    /// 列表树 JSON（`rows` 行，每行含一个圆点）
    fn list_tree_json(rows: u32) -> String {
        let mut nodes = vec![
            serde_json::json!({"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0}),
        ];
        for i in 0..rows {
            let rid = 100 + i;
            nodes.push(serde_json::json!({"id":rid,"parentId":1,"flexDirection":"row","width":343.0,"height":50.0,"flexShrink":0.0}));
            nodes.push(serde_json::json!({"id":1000 + i,"parentId":rid,"width":30.0,"height":30.0}));
        }
        serde_json::json!({"viewport":{"width":375.0,"height":800.0},"nodes":nodes}).to_string()
    }

    fn rects_of(handle: u64) -> serde_json::Value {
        unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            serde_json::from_str(&s).unwrap()
        }
    }

    fn splice(handle: u64, req: serde_json::Value) -> serde_json::Value {
        unsafe {
            let c = CString::new(req.to_string()).unwrap();
            let p = proteus_layout_splice(handle, c.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            serde_json::from_str(&s).unwrap()
        }
    }

    /// ★★**度量连续性**：增量重排（update / splice）后，**文本节点的尺寸必须仍来自度量表**
    ///
    /// 【为什么必须有这条判据（本仓实测的架构缺口）】文本尺寸**不在 style 里**——它由宿主
    ///   注入的 `textMeasures` 表在 `create` 时供 `TableTextMeasurer` 使用。
    ///   而增量路径（`relayout_multi`）**新建引擎时用的是 `NullTextMeasurer`**：
    ///   若重排范围里含文本叶子，它会**重新度量**（新引擎 ⇒ 缓存是空的）——
    ///   于是文本塌成 0 高。现象：**几何报告里文本高 0，CATextLayer 的 frame 高 0 ⇒ 文字消失**，
    ///   且只在"更新后"出现（首帧正确）⇒ 静态用例完全发现不了。
    ///   ⇒ 本测试用**度量相关的树**（文本无声明尺寸）暴露它：把增量结果与
    ///     「同一结构 + 同一度量表」的全量结果逐节点比对。
    #[test]
    fn incremental_relayout_preserves_text_measure() {
        // 树：根（column）→ 行（row，height 50）→ 文本（无尺寸，只能靠度量 ⇒ 100×19）
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0},
                {"id":100,"parentId":1,"flexDirection":"row","alignItems":"flex-start","width":343.0,"height":50.0,"flexShrink":0.0},
                {"id":101,"parentId":100,"text":"hello"}
            ],
            "textMeasures": {"101": {"width": 100.0, "height": 19.0}}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);
        let before = rects_of(handle);
        assert_eq!(before["rects"]["101"]["height"].as_f64(), Some(19.0), "首帧：文本高应来自度量表");

        // 改行高（触发增量重排；重排范围 = 行 ⇒ 范围内含文本叶子）
        let patches = serde_json::json!([{ "id": 100, "style": { "height": 60.0 } }]);
        let out = unsafe {
            let c = CString::new(patches.to_string()).unwrap();
            let p = proteus_layout_update(handle, c.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            serde_json::from_str::<serde_json::Value>(&s).unwrap()
        };
        assert_eq!(out["ok"], true, "update 应成功：{out}");

        let after = rects_of(handle);
        // ★判据：文本高**必须仍是 19**（增量重排不得把度量丢成 0）
        let h = after["rects"]["101"]["height"].as_f64();
        assert_eq!(
            h, Some(19.0),
            "★增量重排后文本高 {h:?}（应 19）——度量表在增量引擎里丢失（NullTextMeasurer）⇒ 文字会消失"
        );
        // 对照：同一结构 + 同一度量表，**全量**建树的文本高
        let fresh = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let f = rects_of(fresh);
        assert_eq!(f["rects"]["101"]["height"].as_f64(), Some(19.0), "对照（全量）应是 19");
        unsafe { proteus_layout_destroy(handle) };
        unsafe { proteus_layout_destroy(fresh) };
    }

    /// ★★**多补丁 update 必须重排全部脏节点**（不是只重排最后一个）
    ///
    /// 【为什么必须有（本仓实测的缺陷）】此前 update 只把 `last_dirty` 传给
    ///   `layout_incremental` ⇒ 一次带 N 个补丁时**只有最后一个节点所在范围**被重排，
    ///   其余节点的几何**静默过期**（核心与屏幕不一致、零报错）。
    ///   判据：两个**互不相同**的边界行各改一个叶子 ⇒ 两行都应出现在变化集里，
    ///   且与「句柄当前全量矩形」（独立实现）一致。
    #[test]
    fn update_with_multiple_patches_relayouts_all() {
        // 两行（各带显式宽高 ⇒ 各自是布局边界），行内一个叶子
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 800.0},
                {"id": 10, "parentId": 1, "flexDirection": "row", "width": 343.0, "height": 50.0, "flexShrink": 0.0},
                {"id": 11, "parentId": 10, "width": 30.0, "height": 30.0},
                {"id": 20, "parentId": 1, "flexDirection": "row", "width": 343.0, "height": 50.0, "flexShrink": 0.0},
                {"id": 21, "parentId": 20, "width": 30.0, "height": 30.0}
            ],
            "textMeasures": {}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // 同时改**两个不同行**的叶子（旧实现只重排最后一个 ⇒ 另一个静默过期）
        let patch = r#"[{"id":11,"style":{"width":40.0}},{"id":21,"style":{"width":55.0}}]"#;
        let pc = CString::new(patch).unwrap();
        let out = unsafe {
            let p = proteus_layout_update(handle, pc.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "update 应成功：{out}");
        assert_eq!(v["applied"], 2);

        // ★判据一：两个节点都在变化集里（旧实现只有后者）
        let rects = v["rects"].as_object().expect("应有变化集");
        assert!(rects.contains_key("11"), "★节点 11 未出现在变化集（多补丁未全重排）：{out}");
        assert!(rects.contains_key("21"), "★节点 21 未出现在变化集：{out}");

        // ★判据二：与句柄的全量矩形（独立实现）一致
        let full = unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        for id in ["11", "21"] {
            let w = fv["rects"][id]["width"].as_f64().unwrap();
            let expect = if id == "11" { 40.0 } else { 55.0 };
            assert!((w - expect).abs() < 0.01, "节点 {id} 宽应为 {expect}，实为 {w}（几何未跟着变）");
            let cw = rects[id]["width"].as_f64().unwrap();
            assert!((cw - w).abs() < 0.01, "变化集与全量不一致：{id} {cw} vs {w}");
        }
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**文本更新必须回报给宿主**（`text_updates`）——否则屏幕文字停留在旧值
    ///
    /// 【为什么是设备级缺陷（本仓实测）】增量路径只改 layer 的 frame，而文本在
    ///   `CATextLayer.string` 上。核心此前只回报几何 ⇒ 改文案后**核心已变、屏幕还是旧字**，
    ///   且几何断言全绿（只有肉眼能发现）。V6（SFC 端到端含 `{{ item.title }}`）暴露。
    #[test]
    fn apply_ops_reports_text_updates() {
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 800.0},
                {"id": 101, "parentId": 1, "text": "old"},
            ],
            "textMeasures": {"101": {"width": 30.0, "height": 19.0}}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // 用 TS 编码器同款格式构造一条 SET_TEXT（key 表空，字符串池 1 项）
        let keys: Vec<String> = vec![];
        let strings = vec!["new".to_string()];
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(&0x504F5650u32.to_le_bytes()); // magic "PVOP"
        // ★引用常量而非手写 1（本仓实测：手写版本号在协议升级时**必然过期**，
        //   而且症状是"测试报版本不符"——看似环境问题，实则测试自己写死了旧协议）
        buf.extend_from_slice(&crate::ops::OPS_VERSION.to_le_bytes()); // version
        buf.extend_from_slice(&1u32.to_le_bytes());          // opCount
        buf.extend_from_slice(&(keys.len() as u32).to_le_bytes());
        buf.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        // 键表 / 字符串池：每项 = u16 长度（含结尾 NUL）+ UTF-8 字节 + NUL
        for k in &keys { buf.extend_from_slice(&(k.len() as u16).to_le_bytes()); buf.extend_from_slice(k.as_bytes()); }
        // ★长度字段是**纯字节数**（不含 NUL）——本仓实测：写成 len+1 会解出尾随 '\0'
        for s2 in &strings { buf.extend_from_slice(&(s2.len() as u16).to_le_bytes()); buf.extend_from_slice(s2.as_bytes()); }
        // 指令体（定长 9B，见 buffer.ts 的 encodeOp/SET_TEXT）
        buf.push(0x03);                                       // SET_TEXT
        buf.extend_from_slice(&101u32.to_le_bytes());         // nodeId
        buf.extend_from_slice(&0u32.to_le_bytes());           // textRef

        let out = unsafe {
            let p = proteus_layout_apply_ops(handle, buf.as_ptr(), buf.len() as u32);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            serde_json::from_str::<serde_json::Value>(&s).unwrap()
        };
        assert_eq!(out["ok"], true, "applyOps 应成功：{out}");
        assert_eq!(out["applied"], 1);
        assert_eq!(out["text_updates"]["101"], "new", "★必须回报文本更新（否则屏幕文字停留在旧值）：{out}");
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**`textStyleKey` 让同文本不同字号既能共用缓存、又不错**（跨节点复用的前提）
    ///
    /// 【与上一条的关系】上一条测试锁"`style_key == 0` ⇒ 回退节点寻址"（保守正确）。
    ///   本条锁"**给了 `textStyleKey` ⇒ 内容寻址安全且生效**"：
    ///   · 不同字号 ⇒ 不同 key ⇒ 各自尺寸正确（不会互相污染）
    ///   · **同字号同文本 ⇒ 同 key ⇒ 只真实度量一次**（`measure_calls` 少）
    #[test]
    fn text_style_key_enables_safe_content_addressing() {
        // 500 行同文案（同字号）+ 1 行不同字号：前者应只度量 1 次，后者独立
        let mut nodes = vec![
            serde_json::json!({"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 4000.0}),
        ];
        let mut measures = serde_json::Map::new();
        for i in 0..500u32 {
            let id = 100 + i;
            // ★flexShrink:0 —— 本仓列表行的标准写法（见 check-vapor-perf 的基准树注释：
            //   「flexShrink:0 必填，否则行被压缩（本仓实测的基准树缺陷）」）。
            //   本测试的目的是 **textStyleKey 内容寻址**（不同字号各自正确 + 同字号只量一次），
            //   与"行是否可收缩"无关；不写 flexShrink 会让 500 行挤进 4000 高而各自被压扁，
            //   把断言从"度量是否正确"偷换成"收缩分配是否恰好"——那是另一个课题。
            nodes.push(serde_json::json!({
                "id": id, "parentId": 1, "text": "同文案", "textStyleKey": 1600, "flexShrink": 0
            }));
            measures.insert(id.to_string(), serde_json::json!({"width": 60.0, "height": 19.0}));
        }
        nodes.push(serde_json::json!({"id": 999, "parentId": 1, "text": "同文案", "textStyleKey": 2800, "flexShrink": 0}));
        measures.insert("999".to_string(), serde_json::json!({"width": 100.0, "height": 33.0}));

        let req = serde_json::json!({
            "viewport": {"width": 375.0, "height": 4000.0},
            "nodes": nodes,
            "textMeasures": measures
        });
        let handle = unsafe {
            let c = CString::new(req.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // 断言一：几何各自正确（不同字号不得互相污染）
        let full = unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        let h100 = fv["rects"]["100"]["height"].as_f64().unwrap();
        let h999 = fv["rects"]["999"]["height"].as_f64().unwrap();
        assert!(
            (h100 - 19.0).abs() < 0.01 && (h999 - 33.0).abs() < 0.01,
            "★不同 textStyleKey 必须各自正确：100 高={h100}（应 19）· 999 高={h999}（应 33）"
        );
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**形状判据**：`text` 必须在 `style` **内**——顶层 `{id,text}` 被 serde 静默忽略
    ///
    /// 【为什么必须有这条（本仓实测：静默无效的经典形状分叉）】设备上曾出现
    ///   `text_patches=300` 而 `text_updates=0`：适配器发顶层 `{id,text}`，
    ///   而 `StylePatch` 的形状是 `{id, style:{...}}` ⇒ serde 忽略未知顶层字段、
    ///   `applied` 照数 300 ⇒ **看着成功、改动为零**（且无任何报错）。
    ///   本测试把两侧的形状契约**钉死在 Rust 这一侧**（JS 侧另有 `style.text` 断言）。
    #[test]
    fn text_field_must_be_inside_style() {
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 800.0},
                {"id": 11, "parentId": 1, "text": "old"}
            ],
            "textMeasures": {"11": {"width": 30.0, "height": 19.0}}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // ① **错误形状**（顶层 text）：不得生效——且本测试把这个"静默"钉住
        let bad = r#"[{"id":11,"text":"WRONG"}]"#;
        let bc = CString::new(bad).unwrap();
        let bout = unsafe {
            let p = proteus_layout_update(handle, bc.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let bv: serde_json::Value = serde_json::from_str(&bout).unwrap();
        assert_eq!(
            bv["text_updates"].as_object().map(|o| o.len()).unwrap_or(0),
            0,
            "★顶层 text 必须**不生效**（这正是形状分叉静默的机制）：{bout}"
        );

        // ② **正确形状**（style 内）：必须生效
        let good = r#"[{"id":11,"style":{"text":"RIGHT"}}]"#;
        let gc = CString::new(good).unwrap();
        let gout = unsafe {
            let p = proteus_layout_update(handle, gc.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let gv: serde_json::Value = serde_json::from_str(&gout).unwrap();
        assert_eq!(gv["text_updates"]["11"], "RIGHT", "★style 内的 text 必须生效：{gout}");
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**字重不同的同文本必须有不同尺寸**（`textStyleKey` 必须编码字重）
    ///
    /// 【为什么必须有（本仓实测的同类缺陷）】度量缓存键是 `(text_hash, max_w)`，而 hash 里
    ///   区分字体的只有 `style_key`。若 `style_key` **不含字重** ⇒「同文本 + 同字号 +
    ///   一粗一常规」会被**错误合并**同一缓存项 ⇒ 其中一个尺寸错（如粗体文本被按常规体度量
    ///   ⇒ 屏幕上字被裁，且几何断言全绿）。本仓已在"字号"维度踩过完全相同的坑。
    #[test]
    fn different_font_weight_must_not_share_cache() {
        // 两个节点：同文本、同字号，但 style_key 不同（模拟"粗细不同"）
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 800.0},
                {"id": 10, "parentId": 1, "flexDirection": "row", "alignItems": "flex-start",
                 "width": 343.0, "height": 100.0, "flexShrink": 0.0},
                {"id": 11, "parentId": 10, "text": "同文本", "textStyleKey": 160400},
                {"id": 12, "parentId": 10, "text": "同文本", "textStyleKey": 160700}
            ],
            // ★宿主度量的差异：常规体 60×19 · 粗体 72×19（粗体更宽）
            "textMeasures": {
                "11": {"width": 60.0, "height": 19.0},
                "12": {"width": 72.0, "height": 19.0}
            }
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);
        let full = unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        let w11 = fv["rects"]["11"]["width"].as_f64().unwrap();
        let w12 = fv["rects"]["12"]["width"].as_f64().unwrap();
        assert!(
            (w11 - 60.0).abs() < 0.01 && (w12 - 72.0).abs() < 0.01,
            "★不同字重必须各自正确（内容寻址不得跨字重合并）：11 宽={w11}（应 60）· 12 宽={w12}（应 72）"
        );
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**update 路径的文本更新也要回报**（`text_updates`）+ 度量变化后几何跟着变
    ///
    /// 【与 ops 路径的对应】ops 路径的回报见 `apply_ops_reports_text_updates`；
    ///   而 `update`（样式/文本补丁 JSON 入口）此前**完全没有**这个回报 ⇒
    ///   PatchStyle.text 改了核心、屏幕字不变。本测试同时锁定：
    ///   ① 回报了 text_updates；② **新度量被用上**（文本高按注入的度量变化）。
    #[test]
    fn update_path_reports_text_updates_and_uses_new_measure() {
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id": 1, "parentId": null, "flexDirection": "column", "width": 375.0, "height": 800.0},
                {"id": 10, "parentId": 1, "flexDirection": "row", "alignItems": "flex-start",
                 "width": 343.0, "height": 100.0, "flexShrink": 0.0},
                {"id": 11, "parentId": 10, "text": "短"}
            ],
            "textMeasures": {"11": {"width": 20.0, "height": 19.0}}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // ① 注入新度量（模拟宿主度量"一段更长的文案"）
        let measures = r#"{"11":{"width": 30.0, "height": 57.0}}"#;
        let mc = CString::new(measures).unwrap();
        let mout = unsafe {
            let p = proteus_layout_set_text_measures(handle, mc.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        assert_eq!(serde_json::from_str::<serde_json::Value>(&mout).unwrap()["ok"], true, "度量注入应成功：{mout}");

        // ② 改文本字面量
        let patch = r#"[{"id":11,"style":{"text":"一段更长的文案"}}]"#;
        let pc = CString::new(patch).unwrap();
        let out = unsafe {
            let p = proteus_layout_update(handle, pc.as_ptr());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "update 应成功：{out}");
        assert_eq!(v["text_updates"]["11"], "一段更长的文案", "★必须回报文本更新：{out}");

        // ③ 新度量必须被用上（文本高 19 → 57；行高 100 是固定外盒，故看文本自身）
        let full = unsafe {
            let p = proteus_layout_rects(handle);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            s
        };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        let h = fv["rects"]["11"]["height"].as_f64().unwrap();
        assert!((h - 57.0).abs() < 0.01, "★文本高应为注入的新度量 57，实为 {h}（度量未生效 ⇒ 屏幕上字会被裁/留白）");
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★**结构变更后的度量连续性**：splice 插入的行**含文本**时，其文本尺寸仍需正确
    ///
    /// 【与上一条的关系】上一条覆盖"样式增量"；本条覆盖**增删行的真实形态**——
    ///   真实列表行**必然含文本**（`列表项 N`），而 splice 的落点判定/重排路径与 update 不同。
    #[test]
    fn splice_insert_row_with_text_keeps_measure() {
        let tree = serde_json::json!({
            "viewport": {"width": 375.0, "height": 800.0},
            "nodes": [
                {"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0},
                {"id":100,"parentId":1,"flexDirection":"row","alignItems":"flex-start","width":343.0,"height":50.0,"flexShrink":0.0},
                {"id":101,"parentId":100,"text":"row0"}
            ],
            "textMeasures": {"101": {"width": 60.0, "height": 19.0}}
        });
        let handle = unsafe {
            let c = CString::new(tree.to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);
        // 追加一行（含文本 201，度量 60×19）
        let out = splice(
            handle,
            serde_json::json!({
                "inserts": [{
                    "parentId": 1,
                    "nodes": [
                        {"id": 200, "parentId": 1, "flexDirection": "row", "alignItems": "flex-start", "width": 343.0, "height": 50.0, "flexShrink": 0.0},
                        {"id": 201, "parentId": 200, "text": "row1"}
                    ]
                }],
                "textMeasures": {"201": {"width": 60.0, "height": 19.0}}
            }),
        );
        assert_eq!(out["ok"], true, "splice 应成功：{out}");
        let after = rects_of(handle);
        assert_eq!(after["rects"]["201"]["height"].as_f64(), Some(19.0), "插入行的文本高应为 19（来自度量）");
        unsafe { proteus_layout_destroy(handle) };
    }

    /// ★★核心判据：**splice 后的几何 == 从头全量建树（含新结构）的几何**
    ///
    /// 【为什么这是最关键的判据（本仓实测的教训）】结构变更极易"看起来对了但几何错"
    ///   （如新节点建了但没参与布局、摘除的节点仍在占位）。
    ///   与「从头建一棵等价树」逐节点比对绝对矩形，才能证明**结构确实变了**。
    #[test]
    fn splice_insert_equals_fresh_full_build() {
        // ① 5 行 → splice 插入 1 行（落在第 1 个位置）
        let handle = unsafe {
            let c = CString::new(list_tree_json(5)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);
        let out = splice(
            handle,
            serde_json::json!({
                "inserts": [{
                    "parentId": 1,
                    "nodes": [
                        {"id": 900, "parentId": 1, "flexDirection": "row", "width": 343.0, "height": 50.0, "flexShrink": 0.0},
                        {"id": 901, "parentId": 900, "width": 30.0, "height": 30.0}
                    ]
                }]
            }),
        );
        assert_eq!(out["ok"], true, "splice 应成功：{out}");
        assert_eq!(out["inserted"], 1);
        let after = rects_of(handle);

        // ② 对照：从头建「6 行、新行**追加在末尾**」的树
        //    ★对照树的**行序必须与 splice 的语义一致**（本仓实测：我首版把新行放在
        //      "第 1 位"，而 splice 实际是追加 ⇒ 两棵树行序不同 ⇒ 断言必然红，
        //      且看起来像"splice 几何没跟着变"——**误报为实现的错**。
        //      ⇒ 纪律：结构变更的对照树，必须按**该实现的实际插入语义**构造。）
        let mut nodes = vec![serde_json::json!({"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0})];
        for i in 0..5 {
            let rid = 100 + i;
            nodes.push(serde_json::json!({"id":rid,"parentId":1,"flexDirection":"row","width":343.0,"height":50.0,"flexShrink":0.0}));
            nodes.push(serde_json::json!({"id":1000 + i,"parentId":rid,"width":30.0,"height":30.0}));
        }
        // 追加的新行在末尾
        nodes.push(serde_json::json!({"id":900,"parentId":1,"flexDirection":"row","width":343.0,"height":50.0,"flexShrink":0.0}));
        nodes.push(serde_json::json!({"id":901,"parentId":900,"width":30.0,"height":30.0}));
        let handle2 = unsafe {
            let c = CString::new(serde_json::json!({"viewport":{"width":375.0,"height":800.0},"nodes":nodes}).to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let fresh = rects_of(handle2);

        // ③ 逐节点比对**绝对矩形**
        let a = after["rects"].as_object().expect("splice 应返回变化集");
        let f = fresh["rects"].as_object().expect("全量树应有矩形");
        // 变化集只含受影响子树的矩形；对其中每个节点，与全量结果比几何
        let mut compared = 0;
        for (id, r) in a {
            if let Some(fr) = f.get(id) {
                for k in ["x", "y", "width", "height"] {
                    let av = r[k].as_f64().unwrap_or(f64::NAN);
                    let fv = fr[k].as_f64().unwrap_or(f64::NAN);
                    assert!(
                        (av - fv).abs() < 0.01,
                        "★ 节点 {id} 的 {k} 不一致：splice {av} vs 全量 {fv}（结构变了但几何没跟着变？）"
                    );
                }
                compared += 1;
            }
        }
        assert!(compared > 0, "至少应有节点参与比对（否则判据空心）");
        unsafe { proteus_layout_destroy(handle) };
        unsafe { proteus_layout_destroy(handle2) };
    }

    /// ★★**内存回收**：反复"插一批/删一批"后，节点数应**有界**（孤点被压实回收）
    ///
    /// 【为什么必须有（本仓实测的设计余项）】摘除只断链（孤点留数组里，功能正确但占内存）
    ///   ⇒ 长列表反复增删会持续积压。本测试模拟 20 轮"插 40 行 → 删 40 行"：
    ///   · `node_count` 必须**远小于**累计插入量（否则就是没回收）
    ///   · 且**几何仍与全量建树一致**（压实的正确性判据——数组下标重排不得影响语义）
    #[test]
    fn splice_compacts_orphans_and_keeps_geometry_correct() {
        let handle = unsafe {
            let c = CString::new(list_tree_json(50)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);
        let base_nodes = {
            let r = rects_of(handle);
            r["node_count"].as_u64().unwrap() as usize
        };

        // 20 轮：各插 40 行（每行 2 节点）再删掉 → 累计产生 1600 个孤点
        let mut rounds = 0;
        for round in 0..20u32 {
            let mut nodes = Vec::new();
            let mut ids = Vec::new();
            for k in 0..40u32 {
                let rid = 900_000 + round * 1000 + k;
                ids.push(rid);
                nodes.push(serde_json::json!({
                    "id": rid, "parentId": 1, "flexDirection": "row",
                    "width": 343.0, "height": 50.0, "flexShrink": 0.0
                }));
                nodes.push(serde_json::json!({
                    "id": rid + 100, "parentId": rid, "width": 30.0, "height": 30.0
                }));
            }
            let ins = splice(handle, serde_json::json!({ "inserts": [{ "parentId": 1, "index": 1, "nodes": nodes }] }));
            assert_eq!(ins["ok"], true, "插入应成功：{ins}");
            let rm = splice(handle, serde_json::json!({ "removes": ids }));
            assert_eq!(rm["ok"], true, "删除应成功：{rm}");
            rounds += 1;
            if rm["compacted"].is_array() {
                // 压实发生了 ⇒ 节点数应接近基线
                let after = rm["node_count"].as_u64().unwrap() as usize;
                assert!(
                    after < base_nodes + 200,
                    "★压实后节点数应接近基线（{base_nodes}），实为 {after}"
                );
            }
        }
        let _ = rounds;

        // ① 节点数**有界**（累计插入 1600 节点 ⇒ 若不回收会是 base+1600）
        let final_rects = rects_of(handle);
        let final_nodes = final_rects["node_count"].as_u64().unwrap() as usize;
        assert!(
            final_nodes < base_nodes + 400,
            "★孤点未被回收：最终 {final_nodes} 节点（基线 {base_nodes}，累计插入过 1600）"
        );

        // ② 几何仍正确：与"从头建 50 行"的全量树逐节点比对
        let handle2 = unsafe {
            let c = CString::new(list_tree_json(50)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let fresh = rects_of(handle2);
        let a = final_rects["rects"].as_object().expect("应有矩形");
        let f = fresh["rects"].as_object().expect("应有矩形");
        assert_eq!(a.len(), f.len(), "★压实后节点集应与全量树一致");
        let mut compared = 0;
        for (id, r) in a {
            let fr = f.get(id).unwrap_or_else(|| panic!("★压实后多出节点 {id}（不该有）"));
            for k in ["x", "y", "width", "height"] {
                let av = r[k].as_f64().unwrap_or(f64::NAN);
                let fv = fr[k].as_f64().unwrap_or(f64::NAN);
                assert!(
                    (av - fv).abs() < 0.01,
                    "★节点 {id} 的 {k} 不一致：压实后 {av} vs 全量 {fv}（下标重排影响了语义？）"
                );
            }
            compared += 1;
        }
        assert!(compared >= 100, "至少应比对到 50 行的全部节点（实测 {compared}）");
        unsafe { proteus_layout_destroy(handle) };
        unsafe { proteus_layout_destroy(handle2) };
    }

    /// ★★**中间插入**：splice 插到第 k 位后的几何 == **从头全量建树（同顺序）**的几何
    ///
    /// 【为什么是核心判据（本仓的架构解禁）】此前 splice 只能追加（数组序=布局序的架构限制）。
    ///   解禁后 `build_taffy` 只信 `children` 顺序 ⇒ 插入 = 在父的 children 里插一项。
    ///   本测试用**行序**作为可观察量（`y` 坐标即行序）：若顺序错了，y 会立刻对不上。
    #[test]
    fn splice_middle_insert_matches_fresh_full_build() {
        // 5 行（id 100..104，各含一个圆点）
        let handle = unsafe {
            let c = CString::new(list_tree_json(5)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        assert_ne!(handle, 0);

        // 插到**第 2 位**（index=2 ⇒ 新行应落在 100/101 之后、102 之前）
        let out = splice(
            handle,
            serde_json::json!({
                "inserts": [{
                    "parentId": 1, "index": 2,
                    "nodes": [
                        {"id": 900, "parentId": 1, "flexDirection": "row", "width": 343.0, "height": 50.0, "flexShrink": 0.0},
                        {"id": 901, "parentId": 900, "width": 30.0, "height": 30.0}
                    ]
                }]
            }),
        );
        assert_eq!(out["ok"], true, "中间插入应成功（此前被显式拒绝）：{out}");
        assert_eq!(out["inserted"], 1);

        // 对照：从头建「顺序为 100,101,900,102,103,104」的树
        let mut nodes = vec![serde_json::json!({"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0})];
        for &rid in &[100u32, 101, 900, 102, 103, 104] {
            nodes.push(serde_json::json!({"id":rid,"parentId":1,"flexDirection":"row","width":343.0,"height":50.0,"flexShrink":0.0}));
            let dot = if rid == 900 { 901 } else { 1000 + (rid - 100) };
            nodes.push(serde_json::json!({"id":dot,"parentId":rid,"width":30.0,"height":30.0}));
        }
        let handle2 = unsafe {
            let c = CString::new(serde_json::json!({"viewport":{"width":375.0,"height":800.0},"nodes":nodes}).to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let fresh = rects_of(handle2);

        // ★逐节点比对绝对矩形（**行序错会立刻体现在 y 上**）
        let after = rects_of(handle);
        let a = after["rects"].as_object().expect("变化集");
        let f = fresh["rects"].as_object().expect("全量树矩形");
        let mut compared = 0;
        for (id, r) in a {
            if let Some(fr) = f.get(id) {
                for k in ["x", "y", "width", "height"] {
                    let av = r[k].as_f64().unwrap_or(f64::NAN);
                    let fv = fr[k].as_f64().unwrap_or(f64::NAN);
                    assert!(
                        (av - fv).abs() < 0.01,
                        "★节点 {id} 的 {k} 不一致：splice {av} vs 全量 {fv}（中间插入的顺序/几何错）"
                    );
                }
                compared += 1;
            }
        }
        assert!(compared >= 5, "至少应比对到被影响的行（实测 {compared}）");
        unsafe { proteus_layout_destroy(handle) };
        unsafe { proteus_layout_destroy(handle2) };
    }

    /// ★★摘除：被摘的整棵子树**不再出现**在变化集里；兄弟上移（几何与全量一致）
    #[test]
    fn splice_remove_detaches_subtree() {
        let handle = unsafe {
            let c = CString::new(list_tree_json(5)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let out = splice(handle, serde_json::json!({ "removes": [100] })); // 摘第 0 行（含其圆点 1000）
        assert_eq!(out["ok"], true, "remove 应成功：{out}");
        assert_eq!(out["removed"], 1);
        let after = rects_of(handle);
        assert!(after["rects"].get("100").is_none(), "★被摘的行不应出现在变化集里");
        assert!(after["rects"].get("1000").is_none(), "★被摘行的**子孙**也应不在（整棵子树失效）");

        // 对照：从头建 4 行（原第 1..4 行）—— 第 1 行（id=101）应上移到 y=0
        let mut nodes = vec![serde_json::json!({"id":1,"parentId":null,"flexDirection":"column","width":375.0,"height":800.0})];
        for i in 1..5 {
            let rid = 100 + i;
            nodes.push(serde_json::json!({"id":rid,"parentId":1,"flexDirection":"row","width":343.0,"height":50.0,"flexShrink":0.0}));
            nodes.push(serde_json::json!({"id":1000 + i,"parentId":rid,"width":30.0,"height":30.0}));
        }
        let handle2 = unsafe {
            let c = CString::new(serde_json::json!({"viewport":{"width":375.0,"height":800.0},"nodes":nodes}).to_string()).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        let fresh = rects_of(handle2);
        let row101 = after["rects"].get("101").expect("第 1 行应在变化集里");
        assert!(
            (row101["y"].as_f64().unwrap_or(-1.0) - 0.0).abs() < 0.01,
            "★摘除首行后，原第 1 行应上移到 y=0；实际 {}",
            row101["y"]
        );
        assert_eq!(row101["y"], fresh["rects"]["101"]["y"], "应与全量结果一致");
        unsafe { proteus_layout_destroy(handle) };
        unsafe { proteus_layout_destroy(handle2) };
    }

    /// ★坏输入必须被拒（不 panic、不静默改错树）
    #[test]
    fn splice_rejects_bad_input() {
        let handle = unsafe {
            let c = CString::new(list_tree_json(3)).unwrap();
            proteus_layout_create(c.as_ptr())
        };
        // ① 摘不存在的 id
        let bad1 = splice(handle, serde_json::json!({ "removes": [99999] }));
        assert_eq!(bad1["ok"], false, "摘不存在的 id 应报错");
        // ② 插入 id 与树上冲突
        let bad2 = splice(
            handle,
            serde_json::json!({ "inserts": [{ "parentId": 1, "nodes": [{"id": 100, "parentId": 1, "width": 10.0}] }] }),
        );
        assert_eq!(bad2["ok"], false, "id 冲突应报错：{bad2}");
        // ③ 落点不存在
        let bad3 = splice(
            handle,
            serde_json::json!({ "inserts": [{ "parentId": 99999, "nodes": [{"id": 700, "parentId": 99999, "width": 10.0}] }] }),
        );
        assert_eq!(bad3["ok"], false, "落点不存在应报错");
        // ④ ★`index` **越界**应被拒绝（本仓 2026-09-28 解禁中间插入后，只保留越界校验）
        //    ★为什么必须拒绝而不是"静默夹到末尾"：后者会让**行序错**且零提示。
        let bad4 = splice(
            handle,
            serde_json::json!({ "inserts": [{ "parentId": 1, "index": 999, "nodes": [{"id": 800, "parentId": 1, "width": 10.0}] }] }),
        );
        assert_eq!(bad4["ok"], false, "index 越界应被拒绝：{bad4}");
        assert!(
            bad4["error"].as_str().unwrap_or("").contains("越界"),
            "拒绝理由应指明是 index 越界：{bad4}"
        );

        // ⑤ 空指针
        unsafe {
            let p = proteus_layout_splice(handle, std::ptr::null());
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            assert!(s.contains("\"ok\":false"));
        }
        // ★三次坏输入后，原树仍可用（不因坏输入而崩/损坏）
        let after = rects_of(handle);
        assert!(after["rects"].get("100").is_some(), "坏输入不应破坏原树");
        unsafe { proteus_layout_destroy(handle) };
    }

    /// FFI 边界：空指针 / 非法 UTF-8 不得 panic
    #[test]
    fn ffi_null_and_bad_utf8_are_safe() {
        unsafe {
            let p = proteus_layout_conformance(std::ptr::null());
            assert!(!p.is_null(), "空指针应返回错误 JSON 而非 null");
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            assert!(s.contains("\"ok\":false"), "应报 ok:false：{s}");
        }
    }

    /* ─────────────── ★★列表复用池 FFI（§12.6）─────────────── */

    /// 调一次 `proteus_recycle_update` 并把 JSON 解析出来（句柄在调用方持有）
    unsafe fn recycle_update(handle: u64, first: u32, last: u32) -> serde_json::Value {
        let p = proteus_recycle_update(handle, first, last);
        let s = CStr::from_ptr(p).to_str().unwrap().to_string();
        proteus_layout_free_string(p);
        serde_json::from_str(&s).unwrap_or_else(|e| panic!("recycle_update 出参不是 JSON：{e}\n{s}"))
    }

    fn rows_of(v: &serde_json::Value, key: &str) -> Vec<u64> {
        v[key].as_array().unwrap().iter().map(|x| x.as_u64().unwrap()).collect()
    }

    /// 首帧：acquire 行数 = 可见行 + 两侧预加载（Idle ⇒ 对称），且 acquire/release 互斥
    #[test]
    fn recycle_ffi_first_frame_acquires_visible_plus_preload() {
        unsafe {
            let h = proteus_recycle_create(1000, 0, 0);
            assert!(h > 0, "句柄应有效");
            let v = recycle_update(h, 0, 11);
            assert_eq!(v["ok"], true);
            assert_eq!(v["direction"], "idle", "首帧不是滚动，方向应为 idle");
            // 默认 leading=8 / following=2；Idle ⇒ 两侧都用 following(2)
            assert_eq!(v["first_preload"], 0);
            assert_eq!(v["last_preload"], 13, "首帧预载 = 可见区 + 两侧各 2 行");
            let acq = rows_of(&v, "acquire");
            let rel = rows_of(&v, "release");
            assert_eq!(acq, (0..=13).collect::<Vec<u64>>(), "首帧应 acquire 0..=13");
            assert!(rel.is_empty(), "首帧无行可释放");
            assert_eq!(v["live"], 14);
            proteus_recycle_destroy(h);
        }
    }

    /// 向下滚：方向 forward ⇒ 下方多留(8)、上方只留(2) —— **非对称预载的直接读数**
    ///
    /// ★差分对照（防"判据是恒真的空判据"）：同一个函数、只改配置（leading=2/following=2）
    ///   ⇒ 下方预留必须变成 2。若判据只写死 8，则把非对称逻辑删掉它也不会红。
    #[test]
    fn recycle_ffi_forward_keeps_more_below_and_less_above() {
        unsafe {
            let h = proteus_recycle_create(1000, 8, 2);
            let _ = recycle_update(h, 0, 11);
            let v = recycle_update(h, 8, 19);
            assert_eq!(v["direction"], "forward");
            assert_eq!(v["first_preload"], 6, "上方（离开方向）只留 2 行");
            assert_eq!(v["last_preload"], 27, "下方（前进方向）留 8 行");
            // 滚出上方预载区的行被释放、下方新增的行被 acquire
            assert_eq!(rows_of(&v, "release"), (0..=5).collect::<Vec<u64>>());
            assert_eq!(rows_of(&v, "acquire"), (14..=27).collect::<Vec<u64>>());
            // 不变式：同一次更新里 acquire 与 release 不相交
            let acq = rows_of(&v, "acquire");
            let rel = rows_of(&v, "release");
            assert!(acq.iter().all(|a| !rel.contains(a)), "acquire 与 release 必须互斥");
            proteus_recycle_destroy(h);

            // 差分：对称配置下，同一轨迹的前方预留必须是 2（而不是 8）
            let h2 = proteus_recycle_create(1000, 2, 2);
            let _ = recycle_update(h2, 0, 11);
            let v2 = recycle_update(h2, 8, 19);
            assert_eq!(v2["first_preload"], 6);
            assert_eq!(v2["last_preload"], 21, "对称配置 ⇒ 下方只留 2（与上面的 27 形成差分）");
            proteus_recycle_destroy(h2);
        }
    }

    /// ★★回滚：方向反转后**前后预加载区立刻交换**（上方 8 / 下方 2）
    ///
    /// 【这条锁的是 §12.6 的关键细节与本仓踩过的坑】初版把 forward/backward 两分支
    ///   写成同一组参数（都"下方多留"）⇒ 回滚时前进方向（上方）只剩 2 行
    ///   ⇒ 刚滚过的行立刻被释放 ⇒ 回滚要重建（现象：回滚阶段 created 暴涨）。
    #[test]
    fn recycle_ffi_rollback_swaps_preload_sides() {
        unsafe {
            let h = proteus_recycle_create(1000, 8, 2);
            let _ = recycle_update(h, 0, 11);
            let _ = recycle_update(h, 8, 19); // 向下
            let v = recycle_update(h, 4, 15); // 回滚（向上）
            assert_eq!(v["direction"], "backward");
            assert_eq!(v["first_preload"], 0, "回滚时**上方**是前进方向 ⇒ 留 8（4-8 夹到 0）");
            assert_eq!(v["last_preload"], 17, "回滚时下方是离开方向 ⇒ 只留 2");
            // 前方（上方）的行还在 ⇒ 回滚 4 行只补 6 行（且都是池内复用，不发生新建）
            assert!(rows_of(&v, "acquire").len() <= 8, "回滚应主要命中已preload的行");
            // 累计读数可用于判据（宿主侧对账）
            let p = proteus_recycle_stats(h);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            let st: serde_json::Value = serde_json::from_str(&s).unwrap();
            assert_eq!(st["updates"], 3);
            assert!(st["acquire_events"].as_u64().unwrap() >= 14);
            proteus_recycle_destroy(h);
        }
    }

    /// 边界：末行夹取（可见区不得超过 item_count）、非法句柄/参数不 panic
    #[test]
    fn recycle_ffi_clamps_and_rejects_bad_input() {
        unsafe {
            let h = proteus_recycle_create(5, 0, 0);
            let v = recycle_update(h, 3, 99);
            assert_eq!(v["last_visible"], 4, "可见末行应夹到 item_count-1");
            assert_eq!(v["last_preload"], 4);
            proteus_recycle_destroy(h);

            assert_eq!(proteus_recycle_create(0, 0, 0), 0, "item_count=0 应返回 0");
            // 未知句柄：返回 ok:false（不得 panic）
            let p = proteus_recycle_update(999_999, 0, 1);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            assert!(s.contains("\"ok\":false"), "未知句柄应报错：{s}");
            let p2 = proteus_recycle_stats(999_999);
            let s2 = CStr::from_ptr(p2).to_str().unwrap().to_string();
            proteus_layout_free_string(p2);
            assert!(s2.contains("\"ok\":false"));
        }
    }
}
