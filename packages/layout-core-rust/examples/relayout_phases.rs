// packages/layout-core-rust/examples/relayout_phases.rs
// ★V5：**增量重排的分段耗时**探针——「先测量再优化」的载体
//
// 【为什么需要它（本仓纪律）】真机读数显示类B 的 `relayout` 占 18ms（总耗时 63%），
//   但那是个**总数**。此前 `layers` 段只报总数时，我把「不是瓶颈」当瓶颈查了两轮
//   （主因其实是自制排序）。⇒ 优化前必须先把分段拆开。
//
// 用法：relayout_phases <tree.json> <ops.bin> [iters]
// 输出：每次增量重排的 copy/build/solve/writeback/total（取中位）
use std::env;
use std::ffi::{CStr, CString};
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("用法：relayout_phases <tree.json> <ops.bin> [iters]");
        std::process::exit(2);
    }
    let tree_json = fs::read_to_string(&args[1]).expect("读 tree.json 失败");
    let ops_bytes = fs::read(&args[2]).expect("读 ops.bin 失败");
    let iters: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(30);

    unsafe {
        let c_tree = CString::new(tree_json).expect("tree.json 含 NUL");
        let handle = proteus_layout_core::ffi::proteus_layout_create(c_tree.as_ptr());
        if handle == 0 {
            println!("{{\"ok\":false,\"error\":\"建树失败\"}}");
            std::process::exit(1);
        }
        // ★首轮建立基线（不计入统计）；★若提供了第三个 ops 文件，则与它**交替发送**
        //   ——本仓实测踩到：只发同一个 ops ⇒ 第二轮起 delta=0（尺寸已等于目标）
        //     ⇒ 读数变成"无事可做"的 0.0055ms，**看起来像 700× 收益，实际什么都没做**。
            // 参数：<tree.json> <opsA.bin> [opsB.bin] [iters]
        let alt_bytes: Option<Vec<u8>> = args
            .get(3)
            .filter(|a| a.ends_with(".bin"))
            .map(|a| fs::read(a).expect("读交替 ops"));
        let iters: usize = args
            .iter()
            .skip(3)
            .find_map(|a| if a.ends_with(".bin") { None } else { a.parse::<usize>().ok() })
            .or_else(|| args.get(3).filter(|a| !a.ends_with(".bin")).and_then(|a| a.parse().ok()))
            .unwrap_or(30);
        let warm = proteus_layout_core::ffi::proteus_layout_apply_ops(handle, ops_bytes.as_ptr(), ops_bytes.len() as u32);
        proteus_layout_core::ffi::proteus_layout_free_string(warm);

        let mut samples: Vec<serde_json::Value> = Vec::new();
        for i in 0..iters {
            // 交替：偶数轮用主 ops，奇数轮用 alt（若提供）
            let use_alt = alt_bytes.is_some() && i % 2 == 1;
            let bytes: &[u8] = if use_alt { alt_bytes.as_ref().unwrap() } else { &ops_bytes };
            let p = proteus_layout_core::ffi::proteus_layout_apply_ops(handle, bytes.as_ptr(), bytes.len() as u32);
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_core::ffi::proteus_layout_free_string(p);
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                samples.push(v);
            }
        }
        // 取中位的 total（并给出中位那一轮的全部分段）
        let mut totals: Vec<(f64, usize)> = samples
            .iter()
            .enumerate()
            .map(|(i, v)| (v["timing"]["relayout_ms"].as_f64().unwrap_or(0.0), i))
            .collect();
        totals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let (_, mid) = totals[totals.len() / 2];
        let v = &samples[mid];
        let phases = v["timing"].clone();
        // 另取一次宿主视角的 apply 分段
        println!(
            "{}",
            serde_json::json!({
                "ok": true,
                "iters": iters,
                "median_relayout_ms": totals[totals.len() / 2].0,
                "phases_of_median_round": phases,
                "relayout_count": v["relayout_count"],
                "scopes": v["scopes"],
                "applied": v["applied"],
            })
        );
        proteus_layout_core::ffi::proteus_layout_destroy(handle);
    }
}
