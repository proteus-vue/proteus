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
            opacity: 1.0,
            bg: None,
            bg_base: None,
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
