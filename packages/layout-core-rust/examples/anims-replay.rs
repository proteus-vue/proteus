// packages/layout-core-rust/examples/anims-replay.rs
// ★★**动画批回放诊断**（跨语言字段形态分叉的"现形器"，2026-10-01 手卷浏览循环缺陷催生）
//
// 【它解决什么问题】"真机上某幕发令失败"这类故障，内核**当场给出了精确原因**
//   （`{"ok":false,"error":"节点 207 的 repeat 非法：-1…"}`），但经过宿主/JS 的层层
//   包装后只剩一句"幕「x」发令失败" ⇒ 排查要靠"改代码→打包→装真机→再跑"循环，一轮 ~5 分钟。
//   本工具把**真实节目单编译产物**（tree JSON + anims JSON）在桌面直接喂给内核 FFI，
//   逐条报"哪条被拒 + 内核原话"——同一故障本地 1 秒现形（当时真机跑了两轮才拿回原因）。
//
// 【为什么必须"逐条"喂】内核 `anim_start` 是**非原子批**：逐条校验、逐条入表，遇到第一条
//   非法就返回 Err——**但它之前的都已生效**（真机实测：手卷 47 条里 6 条卷轴补偿已起步、
//   画布已平移，而报告是"发令失败"）。逐条喂能列出**全部**被拒条目（一次看全），
//   而不是只露第一条；顺带把"半批生效"这种状态在本地复现出来。
//
// 【与真机判据的分工】本工具管"**为什么被拒**"（内核原话），真机判据管"**屏幕对不对**"
//   （像素/探针/记账）。两者不可互相替代——但都属"给错误一个当场现形的地方"。
//
// 输入文件怎么来（TS 侧真实编译产物）：
//   tsx 侧 `buildInkScrollTree(view)` 存 tree JSON（本身就是 LayoutRequest 形态
//   `{viewport, nodes}`）；节目单 `act.anims` 存 `{"anims":[…]}`（**已经是编译产物**，
//   不要再过一遍 `compileAnimations`——那会因"重复声明"被编译层拒绝）。
//   参考生成脚本：见本文件末尾注释的命令。
//
// 用法：
//   cargo run --release --example anims-replay -- <tree.json> <anims.json>
// 退出码：0 = 全部被接受；1 = 有被拒条目（CI/本地都可当判据用）。
use proteus_layout_core::ffi::{proteus_layout_anim_start, proteus_layout_create};
use std::ffi::{CStr, CString};

unsafe extern "C" {
    fn proteus_rects_free(p: *mut std::os::raw::c_char);
}

fn call(ptr: *mut std::os::raw::c_char) -> String {
    if ptr.is_null() {
        return "<null>".into();
    }
    unsafe {
        let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        proteus_rects_free(ptr);
        s
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(tree_path), Some(anims_path)) = (args.get(1), args.get(2)) else {
        eprintln!("用法：cargo run --release --example anims-replay -- <tree.json> <anims.json>");
        std::process::exit(2);
    };
    let h_json = std::fs::read_to_string(tree_path).unwrap_or_else(|e| {
        eprintln!("✗ 读 tree 失败（{tree_path}）：{e}");
        std::process::exit(2);
    });
    let anims = std::fs::read_to_string(anims_path).unwrap_or_else(|e| {
        eprintln!("✗ 读 anims 失败（{anims_path}）：{e}");
        std::process::exit(2);
    });
    let cs = CString::new(h_json).unwrap();
    let h = unsafe { proteus_layout_create(cs.as_ptr()) };
    if h == 0 {
        eprintln!("✗ 建树失败（tree JSON 不是合法 LayoutRequest 形态 `{{viewport, nodes}}`？）");
        std::process::exit(2);
    }
    println!("handle={h}");
    let arr: serde_json::Value = serde_json::from_str(&anims).unwrap_or_else(|e| {
        eprintln!("✗ anims JSON 解析失败：{e}");
        std::process::exit(2);
    });
    let list = arr.get("anims").and_then(|a| a.as_array()).unwrap_or_else(|| {
        eprintln!("✗ anims JSON 缺 `anims` 数组");
        std::process::exit(2);
    });
    println!("anims={}", list.len());
    let mut rejected = 0usize;
    for (i, a) in list.iter().enumerate() {
        let one = serde_json::json!({ "anims": [a] }).to_string();
        let out = call(unsafe { proteus_layout_anim_start(h, CString::new(one).unwrap().as_ptr()) });
        if !out.contains("\"ok\":true") {
            rejected += 1;
            println!(
                "✗ 第 {i} 条被拒: node={} kind={} :: {out}",
                a.get("nodeId").map(|x| x.to_string()).unwrap_or_else(|| "?".into()),
                a.get("kind").map(|x| x.to_string()).unwrap_or_else(|| "?".into())
            );
        }
    }
    println!("逐条喂完：{rejected} 条被拒（共 {}）", list.len());
    if rejected > 0 {
        std::process::exit(1);
    }
}

// 生成输入文件（在仓库根，能跑 tsx 即可）：
//   cat > /tmp/dump.ts <<'TS'
//   import { buildInkScrollTree, createInkScrollProgram } from '<repo>/hosts/shared/bridge/showcase-ink'
//   import fs from 'node:fs'
//   const view = { width: 1200, height: 2404 }
//   fs.writeFileSync('/tmp/tree.json', buildInkScrollTree(view))
//   const act = createInkScrollProgram({ view }).next()!
//   fs.writeFileSync('/tmp/anims.json', JSON.stringify({ anims: act.anims }))
//   TS
//   npx tsx /tmp/dump.ts
