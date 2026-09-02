// CompilerIR 契约（G-29 B2——与 packages/compiler-backend/src/spi.ts 同构的 Rust 侧表示）
//   version:1 / render 树（type/semantic/props/children/loc）/ semantic（tree+计数）/ bindings
//   serde 序列化为 JSON——TS 侧 conformance 校验消费
use serde::Serialize;

/// 源码位置（行/列——与 TS SourceLoc 同构）
#[derive(Debug, Clone, Serialize)]
pub struct SourceLoc {
    pub line: usize,
    pub column: usize,
}

/// 渲染 IR 节点（G-27 nodeOps 消费：有 semantic 走语义映射；无 semantic 属 Layer 1 兼容层）
#[derive(Debug, Clone, Serialize)]
pub struct RenderNode {
    #[serde(rename = "type")]
    pub node_type: String,
    /// p-* 标签 → 语义（非 p- / 未知 p- → None，兼容层）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<String>,
    pub props: serde_json::Value,
    pub children: Vec<RenderNode>,
    pub loc: SourceLoc,
}

#[derive(Debug, Serialize)]
pub struct RenderIR {
    pub root: RenderNode,
}

/// 语义 IR（G-31 C-IR 树 + 计数——conformance 交叉核对）
#[derive(Debug, Serialize)]
pub struct SemanticIR {
    /// C-IR 树（p-* 语义树——非 p- 标签不产生 Layer 0 C-IR；无树 → null——与 Node 侧 ComponentIR|null 同构）
    pub tree: Option<serde_json::Value>,
    /// C-IR 树节点数（= 渲染树带 semantic 的元素数）
    pub semantic_count: usize,
    /// 兼容层元素数（渲染树无 semantic 的元素）
    pub compat_count: usize,
}

#[derive(Debug, Serialize)]
pub struct CapabilityBinding {
    pub name: String,
    pub semantic: String,
}

#[derive(Debug, Serialize)]
pub struct ModelBinding {
    pub name: String,
    pub expr: String,
}

#[derive(Debug, Serialize)]
pub struct HandlerBinding {
    pub name: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
pub struct BindingsIR {
    pub capabilities: Vec<CapabilityBinding>,
    pub models: Vec<ModelBinding>,
    pub handlers: Vec<HandlerBinding>,
}

/// CompilerIR 契约（version:1——CMP004 / CMP002 校验锚点）
#[derive(Debug, Serialize)]
pub struct CompilerIR {
    pub version: u8,
    pub render: RenderIR,
    pub semantic: SemanticIR,
    pub bindings: BindingsIR,
}

impl CompilerIR {
    /// 序列化为 JSON（pretty 可选——G-29.1 IR Golden diff 用紧凑/pretty 均可）
    pub fn to_json_pretty(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}
