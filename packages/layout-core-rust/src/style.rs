// packages/layout-core-rust/src/style.rs
// ★★L1 排版核心：**引擎就绪样式**（全是数值，无 CSS 字符串）。
//
// 定位（方案 §5.1 `layout/` + CSS Profile §8.3）：
//   上游（编译期折叠）已把 CSS 折叠成数值/比例，本层**不做任何解析**。
//   运行时调用栈里不应出现「样式字符串 → 解析」这一步（Profile 门禁「运行时零解析」）。
//
// ★与 TS 参考实现（`packages/layout-core`）的字段一一对应——两边吃同一份 golden，
//   故字段名/语义必须保持同步（conformance 会替我们抓住漂移）。
use serde::{Deserialize, Serialize};

/// 四边值（margin / padding；已折叠为逻辑像素）
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Edges {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

impl Edges {
    pub const ZERO: Self = Self { top: 0.0, right: 0.0, bottom: 0.0, left: 0.0 };

    /// 主轴方向的两侧之和（`horizontal` = 主轴为横轴）
    pub fn main_sum(&self, horizontal: bool) -> f32 {
        if horizontal {
            self.left + self.right
        } else {
            self.top + self.bottom
        }
    }

    /// 交叉轴方向的两侧之和
    pub fn cross_sum(&self, horizontal: bool) -> f32 {
        if horizontal {
            self.top + self.bottom
        } else {
            self.left + self.right
        }
    }
}

/// 尺寸（逻辑像素）
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

/// 矩形（节点在坐标系中的位置与尺寸）
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Display {
    Flex,
    None,
}

impl Default for Display {
    fn default() -> Self {
        Self::Flex
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FlexDirection {
    Row,
    Column,
    RowReverse,
    ColumnReverse,
}

impl Default for FlexDirection {
    fn default() -> Self {
        Self::Column
    }
}

impl FlexDirection {
    /// 主轴是否为横轴（决定 margin/padding/尺寸读写用哪个轴）
    pub fn is_horizontal(self) -> bool {
        matches!(self, Self::Row | Self::RowReverse)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Position {
    Static,
    Relative,
    Absolute,
}

impl Default for Position {
    fn default() -> Self {
        Self::Static
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Overflow {
    Visible,
    Hidden,
    Scroll,
    Auto,
}

impl Default for Overflow {
    fn default() -> Self {
        Self::Visible
    }
}

/// 引擎就绪样式（对应 TS 侧 `LayoutNode` 的输入部分）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
/// ★★**渐变状态**（渐变 v2）：A 态（树里 `fillGradient`）+ B 态（`fillGradientTo`）+ 混合因子。
///
/// 【语义（与 CSS 的差别——这是本引擎的**超出**项）】CSS 的渐变**不可过渡**
///   （`background-image` 不在可插值属性里——浏览器里改色标是硬跳变；平滑要 Houdini，而
///   Houdini 只有 Chromium 系）。本引擎把它做成内核逐帧求值：`mix` 0..1 线性混合 A/B 的
///   每个色标（颜色按四通道、位置按标量）——**两端宿主只翻译内核算好的结果**（零 lerp 数学）。
///
/// 【结构约束（建树时校验，违反即明确拒绝）】A 与 B 的 `kind` 相同、色标**个数**相同
///   （否则"逐标混合"无定义——不做"补齐/截断"这类静默猜测）。
pub struct GradState {
    /// 1=linear 2=radial（与 TS 契约一致）
    pub kind: u8,
    /// 线性：方向角（度；CSS 语义 0=向上 90=向右）
    pub angle: f32,
    /// 径向：圆心与半径（单位空间——与 TS `radialNormalized` 同义）
    pub cx: f32,
    pub cy: f32,
    pub r: f32,
    /// 色标个数（2..8）
    pub n: u8,
    /// A 态色标（打包 `0xAARRGGBB`——与底色同编码）与位置
    pub colors_a: [u32; 8],
    pub offsets_a: [f32; 8],
    /// B 态色标（`fillGradientTo`；`has_b=false` 时其余字段无意义）
    pub has_b: bool,
    pub colors_b: [u32; 8],
    pub offsets_b: [f32; 8],
    /// ★★**混合因子**（`gradientMix` 通道的当前值；0 = 全 A / 1 = 全 B）
    pub mix: f32,
}

impl GradState {
    /// 当前（混合后）的色标——**唯一的 lerp 实现**（宿主与探针都消费它的结果）。
    /// 颜色按四通道各自 lerp（与颜色通道动画同一数学：sRGB 直插，两端一致）。
    pub fn mixed(&self) -> ([u32; 8], [f32; 8]) {
        let t = self.mix.clamp(0.0, 1.0);
        let mut colors = self.colors_a;
        let mut offsets = self.offsets_a;
        if self.has_b {
            for i in 0..self.n as usize {
                let a = self.colors_a[i];
                let b = self.colors_b[i];
                let lerp_ch = |sh: u32| -> u32 {
                    let ca = ((a >> sh) & 0xFF) as f32;
                    let cb = ((b >> sh) & 0xFF) as f32;
                    (ca + (cb - ca) * t).round().clamp(0.0, 255.0) as u32
                };
                colors[i] = (lerp_ch(24) << 24) | (lerp_ch(16) << 16) | (lerp_ch(8) << 8) | lerp_ch(0);
                offsets[i] = self.offsets_a[i] + (self.offsets_b[i] - self.offsets_a[i]) * t;
            }
        }
        (colors, offsets)
    }
}

/// ★★引擎就绪样式（全数值）——与 TS 参考实现字段一一对应（见文件头）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LStyle {
    /// 显式宽高（逻辑像素；`None` = auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
    /// ★百分比尺寸：**由求解器解析**（基准 = 父**内容盒**，适配层拿不到——见 TS 侧同名字段注释）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_ratio: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_ratio: Option<f32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,

    #[serde(default)]
    pub margin: Edges,
    #[serde(default)]
    pub padding: Edges,

    #[serde(default)]
    pub flex_direction: FlexDirection,
    /// `justify-content`（字符串形态：`flex-start` / `center` / `space-between` …）
    #[serde(default = "default_justify")]
    pub justify_content: String,
    /// `align-items`（`stretch` / `flex-start` / `center` / `flex-end` …）
    #[serde(default = "default_align")]
    pub align_items: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align_self: Option<String>,

    #[serde(default)]
    pub flex_grow: f32,
    #[serde(default = "default_shrink")]
    pub flex_shrink: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flex_basis: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flex_basis_ratio: Option<f32>,

    #[serde(default)]
    pub gap: f32,

    #[serde(default)]
    pub display: Display,
    #[serde(default)]
    pub position: Position,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<f32>,
    #[serde(default)]
    pub overflow: Overflow,

    // ── ★RT0/RT2（2026-09-30）：绘制层变换 + 视觉属性（**不参与布局**）──
    //
    // 【为什么放在内核（而不是让宿主自己算）】指令驱动动画（RT0/V6）要把曲线求值结果
    //   落在**内核持有的状态**上：ANIM_START 指令启动、每帧 tick 求值并写入这些字段，
    //   宿主（或后续 RenderCmd 输出）直接消费，全程**不经 JS**。
    //   ★它们是 paint-only：不改变几何 ⇒ 不触发重排（这是指令路径的关键成本优势）。
    #[serde(default)]
    pub translate_x: f32,
    #[serde(default)]
    pub translate_y: f32,
    /// 缩放倍率（缺省 = 1；**不是 0**）
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// ★RT2 追加：旋转（**度**，正 = 顺时针；锚点 = 层中心，与 CSS `rotate` 同语义）
    #[serde(default)]
    pub rotate: f32,
    /// ★★**绕 X 轴旋转**（2026-10-01 · B 批 3D；度；锚点 = 层中心）——翻牌/立方体的轴
    ///   【为什么与 `rotate`（Z 轴）分开三个字段而不是一个 vec3】三个旋转轴各自独立
    ///   参与动画（同 (节点,属性) 替换语义要求"每轴一个槽"）；合一个 = 谁先写谁被覆盖。
    #[serde(default)]
    pub rotate_x: f32,
    /// ★★**绕 Y 轴旋转**（度；锚点 = 层中心）——翻转/翻牌的轴
    #[serde(default)]
    pub rotate_y: f32,
    /// ★★**SVG 描边进度**（2026-10-01 · C2；0..1 = 画到哪——内核只存；路径本体见 `svg_d`）
    #[serde(default)]
    pub stroke_progress: f32,
    /// ★★**SVG 路径声明**（C2）：归一化后的段列表（由 `svg_path::parse_svg_path` 解析——
    ///   **单一实现**：宿主不做第二份 SVG 解析器，只把段列表翻译成平台 path）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg_path: Option<crate::svg_path::SvgPath>,
    /// ★★**路径变形的 B 态**（2026-10-01 · 路径变形 v1）：`svgPathTo` 的解析结果。
    ///   【能力本质】CSS **完全不能做**这件事（`d` 属性不可过渡——网页端要靠 GSAP MorphSVG /
    ///   flubber 这类库逐点重算）。本引擎把它做进内核：`pathMorph` 通道 0..1 驱动
    ///   **逐点插值**（`SvgPath::morphed` 是唯一 lerp 实现），宿主只翻译结果。
    ///   【结构约束】与 `svg_path` 必须**同构**（同命令序列——`structure_signature()` 相同），
    ///   否则建树时明确拒绝（异型之间插值无定义；不做"猜测对齐"）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg_path_to: Option<crate::svg_path::SvgPath>,
    /// ★★**路径变形的当前因子**（0 = 全 A / 1 = 全 B；`pathMorph` 通道写入）
    #[serde(default)]
    pub path_morph: f32,
    /// ★★**两态是否经过自动重采样**（路径变形 v2）：异构路径对 ⇒ 建树时重采样到同构。
    ///   ★如实标注（不静默）：宿主/判据可读到"这条路径被重采样过——几何是重采样近似，
    ///   与原 `d` 有 <3% 的弧长差"（本仓纪律：静默的行为改变是最贵的缺陷）。
    #[serde(default)]
    pub svg_morph_resampled: bool,
    /// ★★**描边颜色**（打包 `0xAARRGGBB`；0 = 未声明）
    #[serde(default)]
    pub stroke_color: u32,
    /// ★★**描边宽度**（px；0 = 未声明）
    #[serde(default)]
    pub stroke_width: f32,
    /// ★★**渐变填充**（2026-10-01 · 渐变 v2 可动画）——A/B 两态 + 混合因子。
    ///   【为什么在内核（v1 时它刻意在宿主——那是有条件的，条件变了）】v1 的边界论证是
    ///   "① 内核不参与它的求值 ② 解析不到'两端必然分叉'的程度"——**v2 打破了 ①**：
    ///   `gradientMix` 通道要逐帧混合色标 ⇒ 求值进了内核 ⇒ 色标数学必须**一处实现**
    ///   （否则两端各写一份 lerp = 本仓第 N 份手写副本的经典事故）。⇒ 按 v1 文件头
    ///   写好的迁移路径迁入内核；**声明面不变**（`fillGradient` 写法照旧，新增可选 `fillGradientTo`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grad: Option<GradState>,
    /// ★★**裁剪形状类型**（2026-10-01 · C1；0=无 1=inset 2=circle 3=polygon）
    ///   【为什么类型静态】CSS 同规：异型形状间不插值（inset→circle 无意义）——
    ///   类型在建树时定死，**参数**参与动画（`clip: [f32; 16]`）。
    #[serde(default)]
    pub clip_kind: u8,
    /// ★★**裁剪形状的当前参数**（16 槽；含义按 `clip_kind` 解释——见内核 `AnimKind::ClipN` 注释）
    #[serde(default)]
    pub clip: [f32; 16],
    /// ★★**裁剪形状的基态**（复位目标；建树时从节点声明取——与 `bg_base`/`text_color_base` 同义务）
    #[serde(default)]
    pub clip_base: [f32; 16],
    /// ★★**透视距离**（px；CSS `perspective` 语义；`None` = 无透视（正交投影））
    ///
    /// 【为什么在**节点**上（而不是父容器）】本仓当前没有"父风格继承"链路（父的 perspective
    ///   影响子渲染需要渲染期查询祖先——会增加每帧查询）。⇒ v1 落在节点自身：
    ///   `perspective: 1200` = 该节点自己的 3D 旋转带透视（视觉上等价"以自身中心为视点"）。
    ///   ★诚实边界：CSS 的"父 perspective 作用于所有子"（共享视点）暂不支持——多子立体场景
    ///   需要它时再评估（不在 v1 假装有）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective: Option<f32>,
    /// ★RT2 追加：不透明度（0..1，缺省 = 1）——复杂动效的标配（淡入淡出）
    #[serde(default = "default_scale")]
    pub opacity: f32,
    /// ★★Color（2026-10-01）：**背景色**（`0xAARRGGBB` 打包）——颜色动画的当前值槽位
    ///
    /// 【为什么必须有这个槽位】颜色动画要**每帧求值并写入内核状态**，宿主直接消费、
    ///   全链**不经 JS**（与 translate/scale 同一纪律）。此前内核**完全没有颜色字段**
    ///   （背景色是各宿主的本地数据：iOS 读树 JSON 的 `style["backgroundColor"]`、
    ///   Android 用 Java 侧 `Cmd.color`）⇒ 动画的值无处可落。
    ///
    /// 【`None` 的语义】= "本节点没有内核底色" ⇒ 报告里 `color_valid=false`，宿主**保持自己的
    ///   静态绘制**（不覆盖）。这正是为了不打扰"宿主自有颜色源"（如 Android 的 `Cmd.color`）：
    ///   只有**树里声明了底色**的节点才进内核颜色轨道。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<u32>,
    /// 底色（**复位目标**；来自树 DTO 的 `backgroundColor`，建树时定，动画不改它）
    ///
    /// 【为什么需要它（本仓「解绑必须含清值」纪律的又一次应用）】动画跑完/被 stop 后，
    ///   若只把动画项移出列表，`bg` 会**停在最后一帧**（残留颜色污染后续相位）。
    ///   ⇒ 复位语义 = `bg = bg_base`。这也是"颜色动画要求节点有底色"的原因：
    ///     没有复位目标就不能安全清场（内核在 `start` 处**明确拒绝**，不静默）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_base: Option<u32>,
    /// ★★**文字色**（2026-10-01）：`0xAARRGGBB` 打包——文字色动画的当前值槽位
    ///
    /// 【与 `bg` 的关系】完全同构的两条轨道：同一套四通道数学（`AnimKind::TextColorR/G/B/A`），
    ///   只是写**不同的槽**（底色写 `bg`、文字色写本字段）。分成两个字段而不是复用一个
    ///   "当前颜色 + 目标槽"结构，是为了让"同时动底色和文字色"天然可行（两条轨道互不干扰）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<u32>,
    /// 文字色（**复位目标**；来自树 DTO 的 `color`，建树时定，动画不改它）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color_base: Option<u32>,
}

fn default_scale() -> f32 {
    1.0
}

fn default_justify() -> String {
    "flex-start".into()
}
fn default_align() -> String {
    "stretch".into()
}
fn default_shrink() -> f32 {
    1.0
}

impl Default for LStyle {
    fn default() -> Self {
        Self {
            width: None,
            height: None,
            width_ratio: None,
            height_ratio: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            margin: Edges::ZERO,
            padding: Edges::ZERO,
            flex_direction: FlexDirection::default(),
            justify_content: default_justify(),
            align_items: default_align(),
            align_self: None,
            flex_grow: 0.0,
            flex_shrink: 1.0,
            flex_basis: None,
            flex_basis_ratio: None,
            gap: 0.0,
            display: Display::default(),
            position: Position::default(),
            top: None,
            left: None,
            overflow: Overflow::default(),
            translate_x: 0.0,
            translate_y: 0.0,
            scale: 1.0,
            rotate: 0.0,
            rotate_x: 0.0,
            rotate_y: 0.0,
            perspective: None,
            clip_kind: 0,
            clip: [0.0; 16],
            clip_base: [0.0; 16],
            grad: None,
            stroke_progress: 0.0,
            svg_path: None,
            svg_path_to: None,
            path_morph: 0.0,
            svg_morph_resampled: false,
            stroke_color: 0,
            stroke_width: 0.0,
            opacity: 1.0,
            bg: None,
            bg_base: None,
            text_color: None,
            text_color_base: None,
        }
    }
}

impl LStyle {
    /// 是否可能是「布局边界」（§5.4）：宽高**均为显式值** ⇒ 对外尺寸与子级无关。
    /// ★这是**必要条件**而非充分条件：完全显式的宽高才让「内部变更不外溢」成立。
    pub fn is_layout_boundary(&self) -> bool {
        self.width.is_some() && self.height.is_some() && self.display == Display::Flex
    }
}
