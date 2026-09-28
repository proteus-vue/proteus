// packages/layout-core-rust/examples/ops_roundtrip.rs
// ★Vapor IR V3 端到端测试**驱动**：读树 JSON + 指令字节流 → 建树 → 应用指令 → 输出矩形
//
// 【为什么用 example 而不是 napi/FFI 绑定】
//   TS 测试要验证「指令 → 树 → 几何」这条**核心逻辑链**；FFI 编组已有 ffi.rs 的单元测试
//   （含空指针 / 垃圾流 / 未知节点那些边界）。用 example 驱动的好处：
//     · 无需真机、无需构建 iOS/Android 产物 ⇒ 毫秒级、可在 CI 跑
//     · 与生产路径**共用同一个 `proteus_layout_apply_ops`**（不是另写一份逻辑）
//
// 用法：ops_roundtrip <tree.json> <ops.bin>
// 输出：JSON（rects / applied / relayout / scopes / unsupported / timing）
use std::env;
use std::ffi::{CStr, CString};
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("用法：ops_roundtrip <tree.json> <ops.bin>");
        std::process::exit(2);
    }
    let tree_json = fs::read_to_string(&args[1]).expect("读 tree.json 失败");
    let ops_bytes = fs::read(&args[2]).expect("读 ops.bin 失败");

    unsafe {
        // ① 建树（与生产同一入口）
        let c_tree = CString::new(tree_json).expect("tree.json 含 NUL");
        let handle = proteus_layout_core::ffi::proteus_layout_create(c_tree.as_ptr());
        if handle == 0 {
            println!("{{\"ok\":false,\"error\":\"建树失败\"}}");
            std::process::exit(1);
        }

        // ② 应用指令（与生产同一入口：解码 → 应用 → 多范围增量重排）
        let out_ptr = proteus_layout_core::ffi::proteus_layout_apply_ops(handle, ops_bytes.as_ptr(), ops_bytes.len() as u32);
        let out = CStr::from_ptr(out_ptr).to_str().expect("输出非 UTF-8").to_string();
        proteus_layout_core::ffi::proteus_layout_free_string(out_ptr);

        // ③ 读回矩形（供几何断言）
        let rect_ptr = proteus_layout_core::ffi::proteus_layout_rects(handle);
        let rects = CStr::from_ptr(rect_ptr).to_str().expect("矩形非 UTF-8").to_string();
        proteus_layout_core::ffi::proteus_layout_free_string(rect_ptr);
        proteus_layout_core::ffi::proteus_layout_destroy(handle);

        // ④ 合并输出（把 apply 的元信息与矩形并到一层，方便 TS 侧断言）
        let a: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::json!({"ok": false}));
        let r: serde_json::Value = serde_json::from_str(&rects).unwrap_or(serde_json::json!({}));
        let merged = serde_json::json!({
            "ok": a["ok"],
            "applied": a["applied"],
            "relayout": a["relayout_count"],
            "scopes": a["scopes"],
            "unsupported": a["unsupported"],
            "timing": a["timing"],
            // 矩形：宿主格式是 {rects: {id: {...}}}；这里直取内层
            "rects": r["rects"].clone(),
        });
        println!("{}", merged);
    }
}
