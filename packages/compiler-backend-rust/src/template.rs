// 轻量 Vue template 扫描器（G-29 B2——与 Node 侧 @vue/compiler-dom 的宽松容错行为对齐，聚焦 p-* 元素树）
//   提取：嵌套元素树（tag / attrs（静态字符串 / :bind {expr} / @event / v-model / 布尔）/ children / 行号）
//   「Semantic Equivalence（G-29.1）」的输入侧——Node/Rust 对同一 SFC 模板产出同构元素树
use crate::ir::{RenderNode, SourceLoc};

/// 模板元素（与 TS TemplateNode 语义同构）
#[derive(Debug, Clone)]
pub struct TmplElement {
    pub tag: String,
    /// 属性：静态字符串值 / 动态 {expr} 标记（serde_json::Value）
    pub props: Vec<(String, serde_json::Value)>,
    pub children: Vec<TmplElement>,
    pub line: usize,
    pub column: usize,
}

/// 属性值形状（静态字符串 → 字符串；:绑定 → { "expr": "..." }；布尔 → true）
fn attr_value(name: &str, raw: Option<&str>) -> (String, serde_json::Value) {
    // 动态绑定 :attr="expr"
    if name.starts_with(':') || name.starts_with("v-bind:") {
        let key = name.trim_start_matches(':').trim_start_matches("v-bind:");
        let expr = raw.unwrap_or("");
        return (key.to_string(), serde_json::json!({ "expr": expr }));
    }
    // 事件 @click="fn"
    if name.starts_with('@') || name.starts_with("v-on:") {
        // 事件单独归 bindings.handlers——这里 props 保留标记供 TS 侧对齐（render 树 props 不含事件）
        return (
            name.to_string(),
            serde_json::json!({ "expr": raw.unwrap_or("") }),
        );
    }
    // v-model / v-if / v-for / v-show 等指令
    if name.starts_with("v-") {
        return (
            name.to_string(),
            serde_json::json!({ "expr": raw.unwrap_or("") }),
        );
    }
    // 静态属性
    match raw {
        Some(v) => (name.to_string(), serde_json::Value::String(v.to_string())),
        None => (name.to_string(), serde_json::Value::Bool(true)),
    }
}

/// 计算位置（字符串前缀换行数 + 最后换行后列）
fn position_at(src: &str, idx: usize) -> (usize, usize) {
    let prefix = &src[..idx];
    let mut line = 1usize;
    let mut col = 1usize;
    for ch in prefix.chars() {
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    (line, col)
}

/// 找标签结束 '>'（引号感知——属性值可含 '<'/'<' 字符，如 source="<b>加粗</b>"）
fn find_tag_end(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        match quote {
            Some(q) => {
                if b == q {
                    quote = None;
                }
            }
            None => {
                if b == b'"' || b == b'\'' {
                    quote = Some(b);
                } else if b == b'>' {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

/// 扫描 template 源码 → 根元素（含嵌套子树；DOM 友好：跳过注释/文本；自闭合根元素正确返回）
/// ★Node 单根语义对齐（G-29.1）：Node 以编译产物的「第一个顶层元素」为 render 根、后续顶层兄弟
///   （v-if/v-else 的 else 分支等）丢弃——本扫描器同样只保留首根，后续顶层元素整个子树丢弃（discard_depth）
pub fn scan_template(template: &str) -> Option<TmplElement> {
    let mut stack: Vec<TmplElement> = Vec::new();
    // 首根候选：顶层元素闭合/自闭合时记下（v-if/v-else 多顶层 → 只取第一个，与 Node flatten + 单根一致）
    let mut first_root: Option<TmplElement> = None;
    // 丢弃计数：second+ 顶层元素子树（其内部开闭标签配对计数；归零后恢复正常扫描）
    let mut discard_depth = 0usize;
    let mut rest = template;
    let mut offset = 0usize;

    // 栈空时 push 的元素即根候选（已有首根 → 丢弃——Node 单根语义）
    fn attach_or_root(
        el: TmplElement,
        stack: &mut Vec<TmplElement>,
        first_root: &mut Option<TmplElement>,
    ) -> bool {
        if stack.is_empty() {
            if first_root.is_none() {
                *first_root = Some(el);
            } else {
                return false; // 第二顶层兄弟 → 丢弃
            }
        } else if let Some(parent) = stack.last_mut() {
            parent.children.push(el);
        }
        true
    }

    while !rest.is_empty() {
        // 找下一个 '<'
        let lt = match rest.find('<') {
            Some(i) => i,
            None => break,
        };
        // 跳过 < 之前的文本（< 处可能是注释/闭合/开始标签）
        let after = &rest[lt..];
        let (line, column) = position_at(template, offset + lt);

        if after.starts_with("<!--") {
            // 注释：跳到 -->
            let end = match after.find("-->") {
                Some(i) => i + 3,
                None => rest.len(),
            };
            rest = &rest[lt + end..];
            offset += lt + end;
            continue;
        }
        if after.starts_with("</") {
            // 闭合标签：丢弃计数内 → 只配对不建树；否则弹栈（栈底=顶层根闭合 → 定稿首根）
            let close_gt = match after.find('>') {
                Some(i) => i,
                None => break,
            };
            rest = &rest[lt + close_gt + 1..];
            offset += lt + close_gt + 1;
            if discard_depth > 0 {
                discard_depth -= 1;
            } else if stack.len() > 1 {
                let popped = stack.pop().unwrap();
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(popped);
                }
            } else if stack.len() == 1 {
                // 顶层根闭合：定稿首根（不留栈——后续顶层兄弟走丢弃）
                let popped = stack.pop().unwrap();
                if first_root.is_none() {
                    first_root = Some(popped);
                }
            }
            // 多余闭合（栈空）忽略
            continue;
        }
        // 开始标签 <tag ...>（结束 '>' 引号感知——属性值可含 '<'/>'）
        let open_gt = match find_tag_end(after) {
            Some(i) => i,
            None => break,
        };
        let tag_section = &after[1..open_gt]; // "tag attr... /"（可能自闭合尾斜杠）
        let self_closing = tag_section.trim_end().ends_with('/');
        let cleaned = tag_section.trim_end().trim_end_matches('/').trim();
        if cleaned.is_empty() {
            // 空 <>（异常）跳过
            rest = &rest[lt + open_gt + 1..];
            offset += lt + open_gt + 1;
            continue;
        }
        // 解析标签名 + 属性
        let mut parts = cleaned.splitn(2, char::is_whitespace);
        let tag_name = parts.next().unwrap_or("").trim().to_string();
        let attr_str = parts.next().unwrap_or("");
        // 防标签名后直接跟 /（<br/>）——自闭合判定已处理
        let props = parse_attrs(attr_str);
        let element = TmplElement {
            tag: tag_name,
            props,
            children: Vec::new(),
            line,
            column,
        };
        if discard_depth > 0 {
            // 丢弃子树内部：继续配对计数（不建树）
            if !self_closing {
                discard_depth += 1;
            }
        } else if self_closing {
            // 自闭合：立即挂父（栈空则记首根）——不留在栈上；第二顶层 → 丢弃
            attach_or_root(element, &mut stack, &mut first_root);
        } else if stack.is_empty() && first_root.is_some() {
            // 第二+ 顶层非自闭合元素 → 整体丢弃（Node 单根语义：v-else 分支不产树）
            discard_depth = 1;
        } else {
            stack.push(element);
        }
        rest = &rest[lt + open_gt + 1..];
        offset += lt + open_gt + 1;
    }
    // 关闭剩余栈（栈底即根——根未显式闭合到文件尾）
    while stack.len() > 1 {
        let popped = stack.pop().unwrap();
        if let Some(parent) = stack.last_mut() {
            parent.children.push(popped);
        }
    }
    // 返回首根：常规栈底 / 自闭合/顶层闭合定稿（first_root）
    stack.pop().or(first_root)
}

/// 属性串解析：name="value" / name='value' / name=value / :name="expr" / @name="fn" / 布尔 name
fn parse_attrs(s: &str) -> Vec<(String, serde_json::Value)> {
    let mut out: Vec<(String, serde_json::Value)> = Vec::new();
    let mut rest = s;
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        // 找名字（到 = 或空白）
        let eq = rest.find('=');
        let ws_idx = rest.find(char::is_whitespace);
        let name_end = match (eq, ws_idx) {
            (Some(e), Some(w)) => e.min(w),
            (Some(e), None) => e,
            (None, Some(w)) => w,
            (None, None) => rest.len(),
        };
        let name = rest[..name_end].trim().to_string();
        if name.is_empty() {
            break;
        }
        rest = &rest[name_end..];
        // 值（= 后引号或裸）
        let value = if let Some(nv) = rest.strip_prefix('=') {
            rest = nv.trim_start();
            let first = rest.chars().next();
            if first == Some('"') || first == Some('\'') {
                let q = first.unwrap();
                let body = &rest[1..];
                let close = body.find(q).unwrap_or(body.len());
                let v = &body[..close];
                rest = &body[close + 1..];
                Some(v.to_string())
            } else {
                // 裸值到空白
                let w = rest.find(char::is_whitespace).unwrap_or(rest.len());
                let v = &rest[..w];
                rest = &rest[w..];
                Some(v.to_string())
            }
        } else {
            None // 布尔属性
        };
        out.push(attr_value(&name, value.as_deref()));
    }
    out
}

/// 元素树 → 渲染 IR 节点（语义链接 + props + 行号）——p-* 标签 → semantic_for_tag
pub fn element_to_render_node(
    el: &TmplElement,
    semantic_for: &dyn Fn(&str) -> Option<&'static str>,
) -> RenderNode {
    let mut props: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    for (k, v) in &el.props {
        // 事件/指令不入 props（bindings 收集在 main；render 树保留静态 + :bind 约束属性）
        if k.starts_with('@')
            || k.starts_with("v-on:")
            || k.starts_with("v-model")
            || k.starts_with("v-if")
            || k.starts_with("v-for")
            || k.starts_with("v-show")
            || k.starts_with("v-html")
        {
            continue;
        }
        props.insert(k.clone(), v.clone());
    }
    let children = el
        .children
        .iter()
        .map(|c| element_to_render_node(c, semantic_for))
        .collect();
    RenderNode {
        node_type: el.tag.clone(),
        semantic: semantic_for(&el.tag).map(|s| s.to_string()),
        props: serde_json::Value::Object(props),
        children,
        loc: SourceLoc {
            line: el.line,
            column: el.column,
        },
    }
}
