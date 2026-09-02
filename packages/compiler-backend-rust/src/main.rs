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

/// 提取 <template> 块内容（支持带属性的开标签 `<template lang="...">`；无 template → 空）
fn extract_template(source: &str) -> Option<String> {
    let open_at = source.find("<template")?;
    let after_open = &source[open_at..];
    // 校验 <template 后紧跟的是 '>' 或空白（真标签——防 `<template-foo` 误匹配）
    if !after_open.starts_with("<template") {
        return None;
    }
    let after_tpl = after_open.get(9..).unwrap_or("");
    let first = after_tpl.chars().next();
    let ok_tag = first == Some('>')
        || first == Some(' ')
        || first == Some('\t')
        || first == Some('\n')
        || first == Some('\r');
    if !ok_tag {
        return None;
    }
    let gt = source[open_at..].find('>')? + open_at;
    let close = source[gt + 1..].find("</template>")? + gt + 1;
    Some(source[gt + 1..close].to_string())
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
