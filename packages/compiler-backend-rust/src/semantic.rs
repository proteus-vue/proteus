// 语义映射（G-29 B2——与 packages/component-ir/src/schema.ts TAG_SEMANTIC_MAP 对齐的核心集）
//   p-* 标签 → 语义（layout/ui/shell/gesture/engineering/capability 主要标签）
//   语义等价（G-29.1）：Node 侧 TAG_SEMANTIC_MAP 同值——Rust 端产出同一 semantic 字符串
use crate::ir::RenderNode;

/// 核心语义映射表（与 TAG_SEMANTIC_MAP 逐条对齐——新组件入 catalog 时同步本表）
pub fn semantic_for_tag(tag: &str) -> Option<&'static str> {
    match tag {
        // 布局（12）
        "p-box" => Some("layout.box"),
        "p-inline" => Some("layout.inline"),
        "p-stack" => Some("layout.stack"),
        "p-grid" => Some("layout.grid"),
        "p-fluid" => Some("layout.fluid"),
        "p-adaptive" => Some("layout.adaptive"),
        "p-fit" => Some("layout.fit"),
        "p-spacer" => Some("layout.spacer"),
        "p-divider" => Some("layout.divider"),
        "p-scroll" => Some("layout.scroll"),
        "p-virtual-list" => Some("layout.virtual-list"),
        "p-masonry" => Some("layout.masonry"),
        "p-split" => Some("layout.split"),
        "p-safe" => Some("layout.safe"),
        "p-sidebar" => Some("layout.sidebar"),
        // UI（18）
        "p-text" => Some("ui.text"),
        "p-heading" => Some("ui.heading"),
        "p-icon" => Some("ui.icon"),
        "p-image" => Some("ui.image"),
        "p-button" => Some("ui.button"),
        "p-input" => Some("ui.input"),
        "p-textarea" => Some("ui.textarea"),
        "p-switch" => Some("ui.switch"),
        "p-slider" => Some("ui.slider"),
        "p-checkbox" => Some("ui.checkbox"),
        "p-radio" => Some("ui.radio"),
        "p-picker" => Some("ui.picker"),
        "p-select" => Some("ui.select"),
        "p-form" => Some("ui.form"),
        "p-list-view" => Some("ui.list"),
        "p-nav-bar" => Some("ui.nav"),
        "p-rich-text" => Some("ui.rich-text"),
        "p-avatar" => Some("ui.avatar"),
        "p-media" => Some("ui.media"),
        "p-canvas" => Some("ui.canvas"),
        "p-svg" => Some("ui.svg"),
        // Shell（10）
        "p-nav" => Some("shell.nav"),
        "p-tabbar" => Some("shell.tabbar"),
        "p-drawer" => Some("shell.drawer"),
        "p-modal" => Some("shell.modal"),
        "p-toast" => Some("shell.toast"),
        "p-split-panels" => Some("shell.split-panels"),
        "p-page" => Some("shell.page"),
        "p-segment" => Some("shell.segment"),
        "p-popover" => Some("shell.popover"),
        "p-action-sheet" => Some("shell.action-sheet"),
        // Gesture（组件形态 G8/G9）
        "p-draggable" => Some("gesture.draggable"),
        "p-scrollable" => Some("gesture.scrollable"),
        // Engineering 组件形态（E18/E19/E20）
        "p-router-link" => Some("engineering.router-link"),
        "p-transition" => Some("engineering.transition"),
        "p-animate" => Some("engineering.animate"),
        // Capability 入口
        "p-scan-qr" => Some("capability.scan-qr"),
        "p-pick-photo" => Some("capability.pick-photo"),
        "p-location" => Some("capability.location"),
        "p-share" => Some("capability.share"),
        "p-payment" => Some("capability.payment"),
        _ => None, // 未知 p- / 非 p- 标签（view/text/scroll-view——Layer 1 兼容层不产 C-IR）
    }
}

/// 非约束属性筛选（与 Node pickConstraintProps：去 v-* 指令标记，留静态 + 动态约束）
fn pick_constraint_props(
    props: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for (k, v) in props {
        if k.starts_with("v-") {
            continue;
        }
        if k.starts_with('@') || k.starts_with("v-on:") {
            continue;
        }
        out.insert(k.clone(), v.clone());
    }
    out
}

/// 渲染节点 → C-IR 树（p-* 标签 → { tag, semantic, props, children }；非 p- / 未知 → None）
/// 序列化为 serde Value——与 TS toComponentIR 产物同构
pub fn render_to_component_ir(node: &RenderNode) -> Option<serde_json::Value> {
    if !node.node_type.starts_with("p-") {
        return None;
    }
    let semantic = match &node.semantic {
        Some(s) => s.clone(),
        None => return None, // 未知 p- 标签不臆造语义（G-24.2）
    };
    let mut children: Vec<serde_json::Value> = Vec::new();
    for c in &node.children {
        if let Some(ci) = render_to_component_ir(c) {
            children.push(ci);
        }
    }
    let mut obj = serde_json::Map::new();
    obj.insert(
        "tag".to_string(),
        serde_json::Value::String(node.node_type.clone()),
    );
    obj.insert("semantic".to_string(), serde_json::Value::String(semantic));
    obj.insert(
        "props".to_string(),
        serde_json::Value::Object(pick_constraint_props(&props_map(node))),
    );
    obj.insert("children".to_string(), serde_json::Value::Array(children));
    Some(serde_json::Value::Object(obj))
}

fn props_map(node: &RenderNode) -> serde_json::Map<String, serde_json::Value> {
    match &node.props {
        serde_json::Value::Object(m) => m.clone(),
        _ => serde_json::Map::new(),
    }
}

/// C-IR 树节点计数（conformance 交叉核对：semanticCount == C-IR 树节点数）
pub fn count_cir(node: &serde_json::Value) -> usize {
    let mut n = 1usize;
    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        for c in children {
            n += count_cir(c);
        }
    }
    n
}

/// 兼容层元素计数（渲染树无 semantic 的元素——view/text/scroll-view 等）
pub fn count_compat(node: &RenderNode) -> usize {
    let mut n = 0usize;
    if node.semantic.is_none() {
        n += 1;
    }
    for c in &node.children {
        n += count_compat(c);
    }
    n
}

/// capability.* 语义入口 → bindings.capabilities（G-28 能力调用收集——与 Node collectCapabilities 对齐）
pub fn collect_capabilities(node: &serde_json::Value, out: &mut Vec<crate::ir::CapabilityBinding>) {
    if let Some(sem) = node.get("semantic").and_then(|s| s.as_str()) {
        if sem.starts_with("capability.") {
            out.push(crate::ir::CapabilityBinding {
                name: sem.trim_start_matches("capability.").to_string(),
                semantic: sem.to_string(),
            });
        }
    }
    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        for c in children {
            collect_capabilities(c, out);
        }
    }
}
