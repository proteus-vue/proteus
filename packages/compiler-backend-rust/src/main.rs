// G-29 B2 RustBackend CLI：`proteus-cc-rust compile <file.vue>` → 语义等价的 CompilerIR JSON（stdout）
//   ——与 NodeBackend（packages/compiler-backend/src/node.ts）产出同一契约（G-29.1：Node/Rust/WASM 语义等价）
//   流程：读 .vue → 提取 <template> → 轻量扫描元素树 → render 树（p-* 语义链接）+
//        semantic 树（C-IR）+ bindings（capability 入口 / v-model / @handler）→ JSON 输出
mod ir;
mod semantic;
mod template;

use ir::{BindingsIR, CompilerIR, RenderIR};
use semantic::{
    collect_capabilities, count_cir, count_compat, render_to_component_ir, semantic_for_tag,
};
use std::io::Read;
use template::TmplElement;

/// 提取最外层 <template> 块内容（支持带属性的开标签 `<template lang="...">`；槽模板 `<template #x>` 不截断——深度感知；无 template → 空）
fn extract_template(source: &str) -> Option<String> {
    let bytes = source.as_bytes();
    // 1) 找第一个真正的 <template 开标签（<template 后须是 '>' 或空白——防 `<template-foo` 误匹配；跳过注释）
    let mut i = 0usize;
    let mut open_at: Option<usize> = None;
    while i < source.len() {
        if source[i..].starts_with("<!--") {
            match source[i..].find("-->") {
                Some(e) => i += e + 3,
                None => break,
            }
            continue;
        }
        match source[i..].find("<template") {
            Some(rel) => {
                let abs = i + rel;
                let after = &source[abs + "<template".len()..];
                let first = after.chars().next();
                let ok_tag = first == Some('>')
                    || first == Some(' ')
                    || first == Some('\t')
                    || first == Some('\n')
                    || first == Some('\r');
                if ok_tag {
                    open_at = Some(abs);
                    break;
                }
                i = abs + 1;
            }
            None => break,
        }
    }
    let open_at = open_at?;
    // 2) 开标签结束 '>'（引号感知——属性值可含 '>'）
    let mut quote: Option<u8> = None;
    let mut j = open_at;
    let open_end = loop {
        if j >= source.len() {
            return None;
        }
        let b = bytes[j];
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
                    break j;
                }
            }
        }
        j += 1;
    };
    // 3) 深度感知找外层 </template>：槽模板 <template #x>…</template> 开闭自抵消；depth 归 0 即外层闭合
    let mut depth = 0usize;
    let mut k = open_end + 1;
    while k < source.len() {
        if source[k..].starts_with("<!--") {
            match source[k..].find("-->") {
                Some(e) => {
                    k += e + 3;
                    continue;
                }
                None => break,
            }
        }
        let is_close = source[k..].starts_with("</template");
        let is_open = !is_close && source[k..].starts_with("<template");
        if is_close || is_open {
            let marker_len = if is_close {
                "</template".len()
            } else {
                "<template".len()
            };
            let after_marker = &source[k + marker_len..];
            let next = after_marker.chars().next();
            let ok_tag = next == Some('>')
                || next == Some(' ')
                || next == Some('\t')
                || next == Some('\n')
                || next == Some('\r');
            if ok_tag {
                if is_close {
                    if depth == 0 {
                        return Some(source[open_end + 1..k].to_string());
                    }
                    depth -= 1;
                } else {
                    depth += 1;
                }
                k += marker_len;
                continue;
            }
        }
        // 按字符推进（字节 +1 会切进多字节 UTF-8 字符）
        let ch_len = source[k..]
            .chars()
            .next()
            .map(|c| c.len_utf8())
            .unwrap_or(1);
        k += ch_len;
    }
    None
}

/// 遍历元素树收集 handlers（@click="fn"）与 models（v-model="x"）——与 Node elementToRenderNode 的 acc 对齐
fn collect_bindings(el: &TmplElement) -> (Vec<ir::HandlerBinding>, Vec<ir::ModelBinding>) {
    let mut handlers = Vec::new();
    let mut models = Vec::new();
    for (k, v) in &el.props {
        let key = k.as_str();
        if key.starts_with('@') || key.starts_with("v-on:") {
            let name = key
                .trim_start_matches('@')
                .trim_start_matches("v-on:")
                .to_string();
            let target = v
                .get("expr")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            handlers.push(ir::HandlerBinding { name, target });
        } else if key.starts_with("v-model") {
            let name = key
                .strip_prefix("v-model:")
                .unwrap_or("modelValue")
                .to_string();
            let expr = v
                .get("expr")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            models.push(ir::ModelBinding { name, expr });
        }
    }
    for c in &el.children {
        let (h, m) = collect_bindings(c);
        handlers.extend(h);
        models.extend(m);
    }
    (handlers, models)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 || args[1] != "compile" {
        eprintln!("用法: proteus-cc-rust compile <file.vue> [--pretty]");
        std::process::exit(2);
    }
    let path = &args[2];
    let pretty = args.iter().any(|a| a == "--pretty");

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("proteus-cc-rust: 无法打开 {}：{}", path, e);
            std::process::exit(1);
        }
    };
    let mut source = String::new();
    if file.read_to_string(&mut source).is_err() {
        eprintln!("proteus-cc-rust: 读取失败：{}", path);
        std::process::exit(1);
    }

    let template_src = extract_template(&source).unwrap_or_default();

    // 元素树 → render 树（空 template → 空根，对齐 Node 的 template 兜底根）
    let ir = match template::scan_template(&template_src) {
        Some(root_el) => {
            let render_root = template::element_to_render_node(&root_el, &semantic_for_tag);
            let (handlers, models) = collect_bindings(&root_el);
            let c_ir = render_to_component_ir(&render_root);
            let semantic_count = match &c_ir {
                Some(tree) => count_cir(tree),
                None => 0,
            };
            let compat_count = count_compat(&render_root);
            let mut capabilities = Vec::new();
            if let Some(tree) = &c_ir {
                collect_capabilities(tree, &mut capabilities);
            }
            CompilerIR {
                version: 1,
                render: RenderIR { root: render_root },
                semantic: ir::SemanticIR {
                    tree: c_ir,
                    semantic_count,
                    compat_count,
                },
                bindings: BindingsIR {
                    capabilities,
                    models,
                    handlers,
                },
            }
        }
        None => CompilerIR {
            version: 1,
            render: RenderIR {
                root: ir::RenderNode {
                    node_type: "template".to_string(),
                    semantic: None,
                    props: serde_json::Value::Object(serde_json::Map::new()),
                    children: Vec::new(),
                    loc: ir::SourceLoc { line: 1, column: 1 },
                },
            },
            semantic: ir::SemanticIR {
                tree: None,
                semantic_count: 0,
                compat_count: 0,
            },
            bindings: BindingsIR {
                capabilities: Vec::new(),
                models: Vec::new(),
                handlers: Vec::new(),
            },
        },
    };

    let out = if pretty {
        ir.to_json_pretty()
    } else {
        ir.to_json()
    };
    println!("{}", out);
}
