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

/**
 * ★批次 17（CSS 兼容对齐 · 以 Web 为基准）：**逐边 auto 外距标记**。
 *
 * 【为什么单独一型】`Edges` 是 f32（表达不了 CSS 的 `auto`）。Web 里 `margin: 0 auto` 是
 *   **水平居中**的常用写法（flex 项的 auto 外距吸收剩余空间）——此前编译器**静默丢掉 auto** ⇒ App 不居中、
 *   Web 居中（多端不一致且静默）。⇒ 用逐边布尔标记表达 auto；taffy 的 `LengthPercentageAuto` 原生支持。
 * 【单位】auto 与 `margin` 的 f32 值互斥（同一边：auto 为真 ⇒ 忽略该边的 f32 值）。
 */
#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct MarginAuto {
    pub top: bool,
    pub right: bool,
    pub bottom: bool,
    pub left: bool,
}

impl MarginAuto {
    pub const NONE: Self = Self { top: false, right: false, bottom: false, left: false };
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
    /// ★批次 12（CSS 兼容对齐 · 超级应用 栅格）：CSS Grid（taffy 原生；显式轨迹）
    Grid,
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

/// ★★★批次 6（CSS 兼容对齐 · App 三端）：`flex-wrap` —— 闭合集（taffy 原生支持）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FlexWrap {
    Nowrap,
    Wrap,
    WrapReverse,
}

impl Default for FlexWrap {
    fn default() -> Self {
        Self::Nowrap
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

/// ★★**软边遮罩规格**（mask v1 · 2026-10-01）：**进度驱动的双色标柔化揭示**。
///
/// 【与 clip-path 的分工（互补而非重复）】clip = **硬边**裁剪（形状边界一刀切）；
///   遮罩 = **软边**渐隐（内容按渐变 alpha 淡出）——"柔柔显出 / 从雾里渗开 / 边缘化开"
///   这类观感只有遮罩能做（clip 的边界永远是硬的）。
///
/// 【语义（唯一实现 = 本结构体的 `reveal_stops`——两端宿主只翻译它算好的结果）】
///   `progress` 0 ⇒ 全隐（alpha 处处 0）；1 ⇒ 全显；`softness` = 过渡带宽度（0 = 硬边）。
///   **揭示前沿** `front = progress×(1+softness) − softness/2`：
///     · 线性：沿 `angle` 方向（offset 0 在起点侧）——"从下往上渗"之类；
///     · 径向：从圆心向外——"月光从一点渗开"。
///   ★CSS 对照：`mask-image` 可声明但**动它是重绘雷区**（且 `-webkit-mask` 前缀生态混乱）；
///     本引擎把它做成内核逐帧求值的一个标量通道（曲线/弹簧/序列/循环全复用）。
///
/// 【诚实边界】v1 是**进度驱动的两色标**形态（表达"揭示"）；任意多色标静态遮罩
///   （如"中央椭圆+四周渐隐"的三色标形态）不在 v1——那需要独立的静态遮罩规格类型。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MaskSpec {
    /// 1=linear（沿 angle）· 2=radial（自圆心向外）
    pub kind: u8,
    /// 线性：方向角（度；CSS 语义 0=向上 90=向右——与渐变的角度同一套端点换算）
    pub angle: f32,
    /// 径向：圆心（单位空间）与半径（相对盒宽）
    pub cx: f32,
    pub cy: f32,
    pub r: f32,
    /// 过渡带宽度（0..1；0 = 硬边，1 = 最柔）
    pub softness: f32,
    /// 声明的**基态进度**（0..1）——建树初值与 reset 目标（"解绑必须含清值"的基态）
    pub progress_base: f32,
}

impl MaskSpec {
    /// ★★**揭示色标**（`([oA,oB], [aA,aB])`）——遮罩 v1 的**唯一实现**（宿主零数学）。
    ///
    /// 三态：全隐（前沿未进入）· 全显（前沿已越出）· 过渡（双标 soft edge）。
    /// 端点与数值都精确（便于单测钉值）：`progress=0 ⇒ 全隐`、`1 ⇒ 全显`。
    pub fn reveal_stops(&self, progress: f32) -> ([f32; 2], [f32; 2]) {
        let p = progress.clamp(0.0, 1.0);
        let s = self.softness.clamp(0.0, 1.0);
        let front = p * (1.0 + s) - s * 0.5;
        // ★边界判定用显式的 p **端点短路**（不靠浮点比较——`1.0×1.4 − 0.4` 在 f32 下
        //   是 0.99999994：`>= 1.0` 判否 ⇒ 端点本应"全显"却落进过渡分支，**终帧留一条软边**
        //   （"进度到底了但画面没全显"——这类端点漂移必须用短路根除，与"端点钉死"同一条纪律）。
        if p <= 0.0 {
            ([0.0, 1.0], [0.0, 0.0]) // 全隐（端点短路）
        } else if p >= 1.0 {
            ([0.0, 1.0], [1.0, 1.0]) // 全显（端点短路）
        } else if front + s * 0.5 <= 0.0 {
            ([0.0, 1.0], [0.0, 0.0]) // 全隐（前沿尚未进入）
        } else if front - s * 0.5 >= 1.0 {
            ([0.0, 1.0], [1.0, 1.0]) // 全显（前沿已越出）
        } else {
            let oa = (front - s * 0.5).clamp(0.0, 1.0);
            let ob = (front + s * 0.5).clamp(0.0, 1.0);
            ([oa, ob], [1.0, 0.0])
        }
    }
}

/// ★★**发光规格**（glow v1）：颜色 + 半径 + 强度（见 `LStyle.glow` 的分层描边说明）。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GlowSpec {
    /// 发光色（打包 `0xAARRGGBB`——alpha 通道由 `alpha` 乘子覆盖，与 TS 契约一致）
    pub color: u32,
    /// 发光半径（px；分层描边的最外圈超出量——> 0）
    pub radius: f32,
    /// 强度（0..1；与 `glow_intensity` 相乘后落到每层 alpha）
    pub alpha: f32,
}

fn default_glow_intensity() -> f32 {
    1.0
}

fn default_origin() -> f32 {
    0.5
}

fn default_mask_progress() -> f32 {
    1.0
}

/// ★★**渐变状态**（渐变 v2）：A 态（树里 `fillGradient`）+ B 态（`fillGradientTo`）+ 混合因子。
///
/// 【语义（与 CSS 的差别——这是本引擎的**超出**项）】CSS 的渐变**不可过渡**
///   （`background-image` 不在可插值属性里——浏览器里改色标是硬跳变；平滑要 Houdini，而
///   Houdini 只有 Chromium 系）。本引擎把它做成内核逐帧求值：`mix` 0..1 线性混合 A/B 的
///   每个色标（颜色按四通道、位置按标量）——**两端宿主只翻译内核算好的结果**（零 lerp 数学）。
///
/// 【结构约束（建树时校验，违反即明确拒绝）】A 与 B 的 `kind` 相同、色标**个数**相同
///   （否则"逐标混合"无定义——不做"补齐/截断"这类静默猜测）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// ★★**B 态几何**（2026-10-01 · 渐变 v2 扩展）：线性 = `angle_b`；径向 = `cx_b/cy_b/r_b`。
    ///   【为什么要动画几何】色标动画解决"颜色在变"，几何动画解决**"光本身在动"**：
    ///   月晕扩散（`r` 变大）/ 光的角度转向（`angle` 旋转）/ 光斑移动（`cx/cy`）——
    ///   仍是同一个 `gradientMix` 通道驱动（**零新通道**：几何与色标是同一个"两态混合"语义）。
    ///   ★CSS 同样不能过渡渐变几何（`background-image` 不可插值；要 Houdini）。
    pub angle_b: f32,
    pub cx_b: f32,
    pub cy_b: f32,
    pub r_b: f32,
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

    /// ★★**混合后的几何**：`(angle, cx, cy, r)`——与 `mixed()` 同一 `mix` 因子（同一语义的两个面）。
    ///   线性只用 `angle`；径向只用 `cx/cy/r`（另一端字段原样透传=不产生无意义插值）。
    pub fn mixed_geometry(&self) -> (f32, f32, f32, f32) {
        let t = self.mix.clamp(0.0, 1.0);
        if !self.has_b {
            return (self.angle, self.cx, self.cy, self.r);
        }
        let lerp = |a: f32, b: f32| a + (b - a) * t;
        (
            lerp(self.angle, self.angle_b),
            lerp(self.cx, self.cx_b),
            lerp(self.cy, self.cy_b),
            lerp(self.r, self.r_b),
        )
    }
}

/// 引擎就绪样式（对应 TS 侧 `LayoutNode` 的输入部分；字段与 TS 参考实现一一对应）。
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
    /// ★批次 19（CSS 兼容对齐 · 以 Web 为基准）：**百分比** min/max 尺寸（0..1；基准 = 父内容盒）。
    ///   与 `*_ratio`（未约束的尺寸）平行，但作用于 min/max 钳制——`max-width:100%`（不溢出容器）/ `min-height:100%` 常用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_width_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height_pct: Option<f32>,

    #[serde(default)]
    pub margin: Edges,
    /// ★批次 17：逐边 auto 外距标记（见 MarginAuto 注释）。auto 为真 ⇒ 忽略该边的 margin f32。
    #[serde(default)]
    pub margin_auto: MarginAuto,
    #[serde(default)]
    pub padding: Edges,

    #[serde(default)]
    pub flex_direction: FlexDirection,
    /// ★批次 6：`flex-wrap`（`nowrap` / `wrap` / `wrap-reverse`；默认 nowrap）
    #[serde(default)]
    pub flex_wrap: FlexWrap,
    /// `justify-content`（字符串形态：`flex-start` / `center` / `space-between` …）
    #[serde(default = "default_justify")]
    pub justify_content: String,
    /// `align-items`（`stretch` / `flex-start` / `center` / `flex-end` …）
    #[serde(default = "default_align")]
    pub align_items: String,
    /// ★批次 11（CSS 兼容对齐）：`align-content`（多行弹性容器的**行间**对齐；open string，缺省 stretch）
    #[serde(default = "default_align_content")]
    pub align_content: String,
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
    /// ★批次 8（CSS 兼容对齐 · 定位）：`right`（absolute 的右边缘 inset；含 `right` 时与 `left` 互斥由 taffy 定）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<f32>,
    /// ★批次 8：`bottom`（absolute 的下边缘 inset）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f32>,
    #[serde(default)]
    pub overflow: Overflow,

    // ── ★批次 12（CSS 兼容对齐 · 超级应用 栅格）：CSS Grid 显式轨迹 ──
    //   空格分隔的 token 串（`1fr 1fr 200px`）；宿主/内核只解析这一层（repeat() 由编译器展开）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_template_columns: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_template_rows: Option<String>,

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
    /// ★★**绕 Y 轴旋转**（度；锚点 = `transform_origin`（默认层中心））——翻转/翻牌的轴
    #[serde(default)]
    pub rotate_y: f32,
    /// ★★**倾斜 X**（2026-10-01 · skew v1；度）——`x' = x + tan(skewX)·y`（CSS `skewX` 同式）。
    ///   用途：旗帜飘动 / 水草从根部弯折（配 `transform_origin` 在底部）/ 等距视角 / 速度残影。
    #[serde(default)]
    pub skew_x: f32,
    /// ★★**倾斜 Y**（度）——`y' = y + tan(skewY)·x`（CSS `skewY` 同式）
    #[serde(default)]
    pub skew_y: f32,
    /// ★★**SVG 描边进度**（2026-10-01 · C2；0..1 = 画到哪——内核只存；路径本体见 `svg_d`）
    #[serde(default)]
    pub stroke_progress: f32,
    /// ★★**描边进度的声明基态**（2026-10-01 · 手卷浏览抓出的缺口）：
    ///   `svgPath: {d, stroke, strokeWidth, progress: 1}` 声明"这条路径是**已画成**的
    ///   （静态插图/浏览一幅完成的画）——没有它，静态声明的路径**永远画不出来**
    ///   （此前基态硬编码 0 = 未画，只有动画通道能把值抬上去；真机实测：手卷 57 条静态
    ///   描边节点全部不可见 ⇒ 整幅画只剩色块=空白纸）。
    ///   ★与 `mask.progress` 是**同一条纪律**（静态声明的基态参与复位——`stop_all` 回它，
    ///   不回 0）；缺省 0（向后兼容：既有"声明 + 动画 0→1"路径零行为变化）。
    #[serde(default)]
    pub stroke_progress_base: f32,
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
    /// ★★**软边遮罩**（2026-10-01 · mask v1）：见 `MaskSpec`（进度驱动的双色标柔化揭示）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<MaskSpec>,
    /// ★★**遮罩当前进度**（0=全隐 / 1=全显；`maskProgress` 通道驱动）
    #[serde(default = "default_mask_progress")]
    pub mask_progress: f32,
    /// ★★**发光声明**（2026-10-01 · glow v1）：`{color, radius, alpha}` ——
    ///   渲染 = **N 层同心描边**（`boost_k = radius×k/N`，`alpha_k = alpha×(1-(k-1)/N)²`）。
    ///   【为什么不用平台原生（iOS `CALayer.shadow` / Android `Paint.setShadowLayer`）】
    ///   · Android 的 `setShadowLayer` 在**硬件加速下只支持文本**（对 Path 无效——
    ///     真机上会静默不画；这是"看起来能跑"的经典陷阱）；
    ///   · iOS 原生阴影是高斯（质量高但**与 Android 不同形**）——本仓的"跨端一致优先"
    ///     纪律要求**同一算法两端**（分层描边是确定性的，且 GPU 填充极廉价）。
    ///   ⇒ 两端同 N、同宽度增长、同 alpha 衰减（参考实现见 TS `glowLayers` + 单测钉值）。
    ///   ★若节点有 `svg_path`：发光随**画线进度**走（画到哪、光到哪——PathMeasure 截断）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glow: Option<GlowSpec>,
    /// ★★**发光强度**（0..1 乘子；基态 = 1 = 按声明的 alpha 全额发光）。
    ///   `glowIntensity` 通道（34）驱动——呼吸/渐亮/渐隐都走它（曲线/弹簧/序列/循环全复用）。
    #[serde(default = "default_glow_intensity")]
    pub glow_intensity: f32,
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
    /// ★★**变换原点**（2026-10-01 · transform-origin v1）：**盒分数**（0.5,0.5 = 层中心，CSS 缺省）。
    ///   旋转/缩放/倾斜/3D **全部**绕它发生——"门轴旋转""从根部弯折"这类演出靠它。
    ///   ★静态样式（v1 不可动画——CSS 允许但极少用；诚实边界写在这）。
    ///   ★为什么必须进内核透传给宿主：宿主是**执行变换的那一端**（内核只存语义），
    ///     而这个值决定"绕哪转"——漏传就是"所有旋转都绕中心"（很难与 bug 区分）。
    #[serde(default = "default_origin")]
    pub transform_origin_x: f32,
    #[serde(default = "default_origin")]
    pub transform_origin_y: f32,
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

/// ★批次 11：`align-content` 缺省（CSS 默认 `stretch`）
fn default_align_content() -> String {
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
            min_width_pct: None,
            max_width_pct: None,
            min_height_pct: None,
            max_height_pct: None,
            margin: Edges::ZERO,
            margin_auto: MarginAuto::NONE,
            padding: Edges::ZERO,
            flex_direction: FlexDirection::default(),
            flex_wrap: FlexWrap::default(),
            justify_content: default_justify(),
            align_items: default_align(),
            align_content: default_align_content(),
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
            right: None,
            bottom: None,
            overflow: Overflow::default(),
            grid_template_columns: None,
            grid_template_rows: None,
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
            stroke_progress_base: 0.0,
            svg_path: None,
            svg_path_to: None,
            path_morph: 0.0,
            glow: None,
            glow_intensity: 1.0,
            mask: None,
            mask_progress: 1.0,
            skew_x: 0.0,
            skew_y: 0.0,
            transform_origin_x: 0.5,
            transform_origin_y: 0.5,
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


#[cfg(test)]
mod tests {
    use super::*;

    /// ★★遮罩揭示数学（mask v1）：**唯一实现**的三态钉值（全隐 / 过渡 / 全显）。
    #[test]
    fn mask_reveal_stops_pins_three_states() {
        let m = MaskSpec {
            kind: 1,
            angle: 180.0,
            cx: 0.5,
            cy: 0.5,
            r: 0.75,
            softness: 0.4,
            progress_base: 0.0,
        };
        // progress=0 ⇒ 全隐（两标 alpha 均 0）
        let (o, a) = m.reveal_stops(0.0);
        assert_eq!(a, [0.0, 0.0], "progress=0 应全隐（alpha 处处 0）");
        assert_eq!(o, [0.0, 1.0]);
        // progress=1 ⇒ 全显
        let (o2, a2) = m.reveal_stops(1.0);
        assert_eq!(a2, [1.0, 1.0], "progress=1 应全显");
        assert_eq!(o2, [0.0, 1.0]);
        // progress=0.5 ⇒ 过渡：front = 0.5×1.4 − 0.2 = 0.5 ⇒ oA=0.3 / oB=0.7（精确值）
        let (o3, a3) = m.reveal_stops(0.5);
        assert!((o3[0] - 0.3).abs() < 1e-6, "oA 应 = 0.3（实际 {}）", o3[0]);
        assert!((o3[1] - 0.7).abs() < 1e-6, "oB 应 = 0.7（实际 {}）", o3[1]);
        assert_eq!(a3, [1.0, 0.0], "过渡态：前沿前 1、前沿后 0");
        // softness=0 ⇒ 硬边（过渡带宽度 0——仍是合法的"一刀切"）
        let hard = MaskSpec { softness: 0.0, ..m };
        let (o4, a4) = hard.reveal_stops(0.3);
        assert!((o4[0] - 0.3).abs() < 1e-6 && (o4[1] - 0.3).abs() < 1e-6, "硬边：两标同位置");
        assert_eq!(a4, [1.0, 0.0]);
        // 越界钳位（与全部通道同一纪律）
        assert_eq!(m.reveal_stops(-5.0).1, [0.0, 0.0]);
        assert_eq!(m.reveal_stops(9.0).1, [1.0, 1.0]);
    }

    /// ★★遮罩端到端（建树 → 通道 → 逐帧色标）：`progress` 0.5 时 tick 段里读到
    ///   oA=0.3/aA=1（内核已算好——宿主零数学）。
    #[test]
    fn mask_progress_writes_and_reports_stops() {
        use crate::ffi::{
            proteus_layout_anim_start, proteus_layout_anim_tick_bin, proteus_layout_create,
            proteus_layout_free_string, proteus_layout_mask_stops,
        };
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 100.0, "height": 100.0,
                 "backgroundColor": "#224466",
                 "mask": {"kind": "linear", "angle": 180.0, "softness": 0.4, "progress": 0.0}}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        assert!(h > 0, "带遮罩声明应建树成功");
        // 初始（progress_base=0）⇒ 遮罩全隐：查询入口应回 alpha 全 0
        let q = serde_json::json!({"nodeId": 9});
        let r = unsafe {
            proteus_layout_mask_stops(h, std::ffi::CString::new(q.to_string()).unwrap().as_ptr())
        };
        let js = unsafe { std::ffi::CStr::from_ptr(r) }.to_string_lossy().to_string();
        unsafe { proteus_layout_free_string(r) };
        let v: serde_json::Value = serde_json::from_str(&js).expect("查询应回 JSON");
        assert_eq!(v["ok"], true, "{js}");
        assert_eq!(v["stops"][1].as_f64().unwrap(), 0.0, "基态 alpha 应 0（全隐）");
        // 启动遮罩动画到半程
        let start = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 35, "from": 0.0, "to": 1.0, "durMs": 100, "curve": 0}]
        });
        let r2 = unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let m2 = unsafe { std::ffi::CStr::from_ptr(r2) }.to_string_lossy().to_string();
        assert!(m2.contains("\"ok\":true"), "遮罩动画应被受理：{m2}");
        let mut n: u32 = 0;
        let p = unsafe { proteus_layout_anim_tick_bin(h, 50.0, &mut n) };
        assert!(n >= 228, "记录应 ≥228B（含遮罩段）：实际 {n}");
        let sl = unsafe { std::slice::from_raw_parts(p, n as usize) }.to_vec();
        unsafe { crate::ffi::proteus_rects_free(p, n) };
        // 遮罩段固定在 @208：kind u32 + oA/aA/oB/aB
        let mk = u32::from_le_bytes([sl[208], sl[209], sl[210], sl[211]]);
        assert_eq!(mk, 1, "遮罩 kind=1（linear）");
        let oa = f32::from_le_bytes([sl[212], sl[213], sl[214], sl[215]]);
        let aa = f32::from_le_bytes([sl[216], sl[217], sl[218], sl[219]]);
        assert!((oa - 0.3).abs() < 0.02, "半程 oA 应 ≈0.3（实际 {oa}）");
        assert!((aa - 1.0).abs() < 1e-4, "半程 aA 应 = 1（实际 {aa}）");
        // stop ⇒ 回声明基态（0 = 全隐）
        let stop = "{\"all\":true}";
        unsafe {
            crate::ffi::proteus_layout_anim_stop(h, std::ffi::CString::new(stop).unwrap().as_ptr())
        };
        let r3 = unsafe {
            proteus_layout_mask_stops(h, std::ffi::CString::new(q.to_string()).unwrap().as_ptr())
        };
        let js3 = unsafe { std::ffi::CStr::from_ptr(r3) }.to_string_lossy().to_string();
        unsafe { proteus_layout_free_string(r3) };
        let v3: serde_json::Value = serde_json::from_str(&js3).unwrap();
        assert_eq!(v3["stops"][1].as_f64().unwrap(), 0.0, "stop 后应回基态（全隐）");
        unsafe { crate::ffi::proteus_layout_destroy(h) };
    }

    /// 拒绝分支：无遮罩声明时驱动遮罩进度 ⇒ 明确拒绝（含修法）。
    #[test]
    fn mask_progress_rejects_without_declaration() {
        use crate::ffi::{proteus_layout_anim_start, proteus_layout_create};
        let req = serde_json::json!({
            "viewport": {"width": 100.0, "height": 100.0},
            "nodes": [
                {"id": 1, "width": 100.0, "height": 100.0},
                {"id": 9, "parentId": 1, "width": 100.0, "height": 100.0}
            ]
        });
        let h = unsafe {
            proteus_layout_create(std::ffi::CString::new(req.to_string()).unwrap().as_ptr())
        };
        let start = serde_json::json!({
            "anims": [{"nodeId": 9, "kind": 35, "from": 0.0, "to": 1.0, "durMs": 100}]
        });
        let r = unsafe {
            proteus_layout_anim_start(h, std::ffi::CString::new(start.to_string()).unwrap().as_ptr())
        };
        let m = unsafe { std::ffi::CStr::from_ptr(r) }.to_string_lossy().to_string();
        assert!(m.contains("没有遮罩声明"), "应明确拒绝并指原因：{m}");
        assert!(m.contains("mask"), "应给修法（声明 mask）：{m}");
        unsafe { crate::ffi::proteus_layout_destroy(h) };
    }
}
