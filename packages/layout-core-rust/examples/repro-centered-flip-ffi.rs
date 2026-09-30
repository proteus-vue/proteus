// 复现（**生产 FFI 路径**）：居中网格 + `proteus_layout_update` 后，`flip_start` 为何只动 21 片 / 3px
//
// 【与 repro-centered-flip.rs 的差别】那个是"我重构的布局调用"（可能不等价）；
//   本程序走**设备上真实的三步**：`proteus_layout_create` → `proteus_layout_update`（800 条补丁）
//   → 比对两次 `proteus_layout_rects`（与内核 `flip_start` 的比较同式）。
//   ⇒ 结论可以直接当作"设备现象的内核解释"。
//
// 用法：cargo run --release --example repro-centered-flip-ffi
use std::ffi::{CStr, CString};

use proteus_layout_core::ffi::{
    proteus_layout_create, proteus_layout_flip, proteus_layout_free_string, proteus_layout_rects, proteus_layout_update,
};

const W: f32 = 390.0;
const H: f32 = 844.0;
const COLS: usize = 20;
const ROWS: usize = 40;
const N: usize = COLS * ROWS;
const PAD: f32 = 8.0;
const GAP: f32 = 3.0;

fn main() {
    let tile = ((W - PAD * 2.0 - GAP * (COLS as f32 - 1.0)) / COLS as f32).floor();
    // ① 建树 JSON（与 entry-showcase.ts 的 buildTree **同形**：根居中，行 flex-start，瓦片定宽）
    let mut nodes = vec![format!(
        r#"{{"id":1,"width":{W},"height":{H},"flexDirection":"column","gap":{GAP},"justifyContent":"center","alignItems":"center","padding":{{"left":{PAD},"top":{PAD},"right":{PAD},"bottom":{PAD}}}}}"#
    )];
    for r in 0..ROWS {
        nodes.push(format!(
            r#"{{"id":{},"parentId":1,"flexDirection":"row","gap":{GAP},"height":{tile},"flexShrink":0}}"#,
            2 + r
        ));
    }
    for i in 0..N {
        let row = 2 + i / COLS;
        nodes.push(format!(
            r#"{{"id":{},"parentId":{row},"width":{tile},"height":{tile},"flexShrink":0}}"#,
            1000 + i
        ));
    }
    let tree = format!(r#"{{"viewport":{{"width":{W},"height":{H}}},"nodes":[{}]}}"#, nodes.join(","));

    unsafe {
        let handle = proteus_layout_create(CString::new(tree).unwrap().as_ptr());
        assert!(handle != 0, "create 失败");
        let before = rects(handle);
        let t0 = before[&1000];
        let t1 = before[&1009];
        let t2 = before[&1019];
        println!("① 建树（瓦片 {tile}）：首片 x={:.1} · 中片 x={:.1} · 行尾右缘 {:.1}", t0.0, t1.0, t2.0 + t2.2);

        // ② 800 条补丁（与 flip-condense 同形：瓦片 15 → 9）
        let to = 9.0f32;
        let patches: Vec<String> = (0..N)
            .map(|i| format!(r#"{{"id":{},"style":{{"width":{to},"height":{to}}}}}"#, 1000 + i))
            .collect();
        let upd = call_fn(handle, &format!("[{}]", patches.join(",")), proteus_layout_update);
        let upd_str = cstr(upd);
        let upd_v: serde_json::Value = serde_json::from_str(&upd_str).unwrap_or(serde_json::Value::Null);
        println!(
            "② update 回执：applied={:?} relayout_count={:?} scopes={:?} changed_roots={:?}",
            upd_v.get("applied"), upd_v.get("relayout_count"), upd_v.get("scopes"), upd_v.get("changed_roots")
        );
        println!("   补丁条数={}", patches.len());

        let after = rects(handle);
        let a0 = after[&1000];
        let a1 = after[&1009];
        let a2 = after[&1019];
        println!("   瓦片 {to}：首片 x={:.1} · 中片 x={:.1} · 行尾右缘 {:.1}", a0.0, a1.0, a2.0 + a2.2);

        // ②b ★取证细节：行与瓦片的**实际**几何（宽度/位置是否真按新尺寸重排）
        let mut widths: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for i in 0..N {
            let w = after[&(1000 + i as u32)].2;
            *widths.entry(format!("{w:.1}")).or_insert(0) += 1;
        }
        println!("   瓦片宽度分布：{widths:?}");
        let r0b = before[&2];
        let r0a = after[&2];
        println!("   行 0：before x={:.1} w={:.1} · after x={:.1} w={:.1}", r0b.0, r0b.2, r0a.0, r0a.2);
        print!("   行 0 前 5 片 after：");
        for i in 0..5 {
            let a = after[&(1000 + i as u32)];
            print!("[{i}: x={:.1} w={:.1}] ", a.0, a.2);
        }
        println!();
        print!("   行 0 前 5 片 before：");
        for i in 0..5 {
            let b = before[&(1000 + i as u32)];
            print!("[{i}: x={:.1} w={:.1}] ", b.0, b.2);
        }
        println!();

        // ③ FLIP：capture → start（与设备同序：此时还没再改几何 ⇒ Δ 应来自 ② 的更新）
        let cap = cstr(proteus_layout_flip(handle, CString::new(r#"{"op":"capture"}"#).unwrap().as_ptr()));
        let st = cstr(proteus_layout_flip(
            handle,
            CString::new(r#"{"op":"start","durMs":900,"curve":3,"staggerMs":0}"#).unwrap().as_ptr(),
        ));
        let st_v: serde_json::Value = serde_json::from_str(&st).unwrap_or(serde_json::Value::Null);
        println!("③ flip capture={cap} · start: animated={:?} maxDeltaPx={:?}", st_v.get("animated"), st_v.get("maxDeltaPx"));

        // ④ 直接用量几何算位移（与 flip_start 同式），确认"几何到底变了多少"
        let mut moved = 0usize;
        let mut max_dx = 0f32;
        for i in 0..N {
            let (ox, _oy, _, _) = before[&(1000 + i as u32)];
            let (nx, _ny, _, _) = after[&(1000 + i as u32)];
            let dx = ox - nx;
            if dx.abs() > 0.5 {
                moved += 1;
                max_dx = max_dx.max(dx.abs());
            }
        }
        println!("④ 几何逐片比对：moved={moved} · max|dx|={max_dx:.1}");
        println!();
        println!("瓦片宽 15→{to} ⇒ 行内容宽 357→{}（居中后每行左缘 16.5→{}）",
            COLS as f32 * to + GAP * (COLS as f32 - 1.0),
            (W - PAD * 2.0 - (COLS as f32 * to + GAP * (COLS as f32 - 1.0))) / 2.0);
        println!("⇒ 结论：{}", if moved > 700 {
            "位移正常（装置问题）"
        } else {
            "位移很小（**布局本身没变**：行内容宽变了但瓦片在行内位置几乎不动 ⇒ 视觉上只是瓦片变小）"
        });
    }
}

type RectMap = std::collections::HashMap<u32, (f32, f32, f32, f32)>;

unsafe fn rects(handle: u64) -> RectMap {
    let raw = cstr(proteus_layout_rects(handle));
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut out = RectMap::new();
    if let Some(map) = v.get("rects").and_then(|x| x.as_object()) {
        for (k, r) in map {
            let id: u32 = k.parse().unwrap_or(0);
            let x = r.get("x").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let y = r.get("y").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let w = r.get("width").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            let h = r.get("height").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            out.insert(id, (x, y, w, h));
        }
    }
    out
}

unsafe fn call_fn(
    handle: u64,
    json: &str,
    f: unsafe extern "C" fn(u64, *const std::os::raw::c_char) -> *mut std::os::raw::c_char,
) -> *mut std::os::raw::c_char {
    f(handle, CString::new(json).unwrap().as_ptr())
}

unsafe fn cstr(p: *mut std::os::raw::c_char) -> String {
    let s = CStr::from_ptr(p).to_string_lossy().into_owned();
    proteus_layout_free_string(p);
    s
}
