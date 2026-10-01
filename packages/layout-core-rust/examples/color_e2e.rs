// ★★颜色通道端到端（2026-10-01）——走**生产 FFI 路径**：建树（带 backgroundColor）
//   → `anim_start`（颜色通道 kind=5）→ `anim_tick_bin`（28B 记录）→ 读回打包色。
//
// 【为什么用 FFI 而不是直接调 `AnimEngine`】判据与两端宿主消费的是**同一条通路**
//   （含 DTO 解析、记录编码）。两侧结论一致才有意义（本仓纪律：测的就是跑的）。
//
// 用法：cargo run --release --example color_e2e
use std::ffi::{CStr, CString};

use proteus_layout_core::ffi::{
    proteus_layout_anim_start, proteus_layout_anim_tick_bin, proteus_layout_create,
    proteus_layout_free_string, proteus_rects_free,
};

fn cstr(s: &str) -> CString {
    CString::new(s).unwrap()
}

fn main() {
    // ① 建树：节点 2 带底色 `#2f6fed`（R=0x2f G=0x6f B=0xed A=0xff）
    // ★用 `r##"…"##`：颜色字面量里的 `"#` 会**提前终止** `r#"…"#` 原始字符串
    //   （本仓实测踩到：编译器报 `expected ;, found 2f6fed`——这正是那个坑的报错形态）
    let req = r##"{"viewport":{"width":390,"height":844},"nodes":[
        {"id":1,"parentId":null,"width":390,"height":844},
        {"id":2,"parentId":1,"width":100,"height":50,"backgroundColor":"#2f6fed"}
    ]}"##;
    let r = cstr(req);
    let h = unsafe { proteus_layout_create(r.as_ptr()) };
    assert_ne!(h, 0, "建树失败");
    println!("handle = {h}");

    // ② 启动颜色动画：R 通道 0x2f(47) → 0xff(255)，线性 100ms
    let start = r#"{"anims":[{"nodeId":2,"kind":5,"curve":0,"from":47,"to":255,"durMs":100}]}"#;
    let s = cstr(start);
    let out = unsafe { proteus_layout_anim_start(h, s.as_ptr()) };
    let out_s = unsafe { CStr::from_ptr(out) }.to_string_lossy().into_owned();
    unsafe { proteus_layout_free_string(out) };
    println!("start → {out_s}");

    // ③ 两帧：50ms（半程 → R≈151）与 60ms（走完 → R=255，其余通道保持底色）
    for dt in [50.0f32, 60.0] {
        let mut len: u32 = 0;
        let p = unsafe { proteus_layout_anim_tick_bin(h, dt, &mut len) };
        assert!(!p.is_null(), "tick 返回空");
        let buf = unsafe { std::slice::from_raw_parts(p, len as usize) };
        println!("tick(dt={dt}) → {len}B（{}条，28B/条）", len as usize / 28);
        for rec in buf.chunks(28) {
            let id = u32::from_le_bytes([rec[0], rec[1], rec[2], rec[3]]);
            let rgba = u32::from_le_bytes([rec[24], rec[25], rec[26], rec[27]]);
            println!("  node {id} → rgba=0x{rgba:08X}");
        }
        unsafe { proteus_rects_free(p, len) };
    }
}
