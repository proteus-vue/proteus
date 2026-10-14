// packages/shader-codegen-rust/src/main.rs
// proteus-shader-gen —— ShaderBackend 算法真源的**构建期生成器**（决策 #834）。
//
// 用法：
//   proteus-shader-gen --list                                   # 导出材质目录 JSON
//   proteus-shader-gen --material glass --target msl            # 落一份到 stdout
//   proteus-shader-gen --material glass --target agsl --out F   # 落一份到文件
//   proteus-shader-gen --out-dir DIR                            # 落**全部材质 × 全部目标**到目录
//   proteus-shader-gen --verify                                 # 只校验（naga 解析+落地，全绿退出 0）
use proteus_shader_codegen::{emit, emit_fragment, materials, Target};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut material: Option<String> = None;
    let mut target: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut out_dir: Option<String> = None;
    let mut list = false;
    let mut verify = false;
    let mut render_ref: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--list" => list = true,
            "--verify" => verify = true,
            "--render-ref" => { i += 1; render_ref = args.get(i).cloned(); }
            "--material" => { i += 1; material = args.get(i).cloned(); }
            "--target" => { i += 1; target = args.get(i).cloned(); }
            "--out" => { i += 1; out_file = args.get(i).cloned(); }
            "--out-dir" => { i += 1; out_dir = args.get(i).cloned(); }
            "-h" | "--help" => { print_help(); return; }
            other => { eprintln!("未知参数：{other}"); std::process::exit(2); }
        }
        i += 1;
    }

    if list {
        println!("{}", materials::catalog_json());
        return;
    }

    // ★B6 像素等价：CPU 参考渲染（输出 raw RGBA + 尺寸；供设备/本机 GPU 输出比对）
    if let Some(spec_path) = render_ref {
        if let Err(e) = render_reference(&spec_path) {
            eprintln!("✗ {e}");
            std::process::exit(1);
        }
        return;
    }

    let targets = ["msl", "agsl", "glsl", "spirv"];

    if verify {
        let mut fail = 0;
        for m in materials::MATERIALS {
            for t in targets {
                let tg = Target::parse(t).unwrap();
                match emit(m.id, tg) {
                    Ok(e) => {
                        // 额外断言：产物非空、含预期标记（SPIR-V 是二进制，检查字节）
                        if t == "spirv" {
                            match &e.spirv {
                                Some((v, f)) if !v.is_empty() && !f.is_empty() => {
                                    println!("✓ {}/{} 落地 OK（vert {} B / frag {} B）", m.id, t, v.len(), f.len());
                                }
                                _ => { eprintln!("✗ {}/{} SPIR-V 为空", m.id, t); fail += 1; }
                            }
                        } else if e.fragment.is_empty() { eprintln!("✗ {}/{} 片元为空", m.id, t); fail += 1; }
                        else { println!("✓ {}/{} 落地 OK（{} 字节）", m.id, t, e.fragment.len()); }
                    }
                    Err(err) => { eprintln!("✗ {}/{} 落地失败：{err}", m.id, t); fail += 1; }
                }
            }
        }
        if fail > 0 { eprintln!("{fail} 项失败"); std::process::exit(1); }
        println!("全部材质 × 目标落地通过");
        return;
    }

    if let Some(dir) = out_dir {
        // 全部材质 × 目标 → 目录（文件名：<material>.<target>.<ext>）
        std::fs::create_dir_all(&dir).expect("建目录失败");
        for m in materials::MATERIALS {
            for t in targets {
                let tg = Target::parse(t).unwrap();
                let e = emit(m.id, tg).expect("落地失败");
                if t == "spirv" {
                    // ★★★SPIR-V 二进制（决策 #841）：`.vert.spv` / `.frag.spv`（Vulkan 载入用）
                    let (vert, frag) = e.spirv.expect("SPIR-V 缺失");
                    let base = format!("{dir}/{}.{}", m.id, t);
                    std::fs::write(format!("{base}.vert.spv"), &vert).expect("写顶点失败");
                    std::fs::write(format!("{base}.frag.spv"), &frag).expect("写片元失败");
                    println!("→ {base}.vert.spv / {base}.frag.spv");
                    continue;
                }
                let ext = if t == "msl" { "metal" } else { "glsl" };
                let base = format!("{dir}/{}.{}", m.id, t);
                std::fs::write(format!("{base}.frag.{ext}"), &e.fragment).expect("写片元失败");
                if let Some(v) = &e.vertex {
                    std::fs::write(format!("{base}.vert.{ext}"), v).expect("写顶点失败");
                }
                println!("→ {base}.frag.{ext}");
            }
        }
        // 目录元信息
        std::fs::write(format!("{dir}/catalog.json"), materials::catalog_json()).expect("写 catalog 失败");
        return;
    }

    // 单材质单目标
    let m = material.unwrap_or_else(|| { eprintln!("需要 --material（或 --list / --out-dir / --verify）"); std::process::exit(2); });
    let t = target.unwrap_or_else(|| "msl".to_string());
    let tg = Target::parse(&t).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(2); });
    let frag = emit_fragment(&m, tg).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1); });
    match out_file {
        Some(f) => { std::fs::write(&f, &frag).expect("写文件失败"); println!("→ {f}"); }
        None => println!("{frag}"),
    }
}

fn print_help() {
    println!("proteus-shader-gen —— ShaderBackend 算法真源生成器\n\
    \n  --list                          导出材质目录 JSON\
    \n  --material <id> --target <t>    落一份（target: msl|agsl|glsl）\
    \n  --out <file>                    写到文件（缺省 stdout）\
    \n  --out-dir <dir>                 落全部材质 × 目标到目录\
    \n  --verify                        只校验落地，全绿退出 0\
    \n  --render-ref <spec.json>        CPU 参考渲染（像素等价 oracle；见 render_reference 注释）");
}

/// CPU 参考渲染（像素等价门禁的 oracle · B6）。
///
/// 入参 spec.json：`{ "backdrop": {"width","height","rgba":[0..255…]}, "params": {…GlassParams…}, "out": {"width","height"} }`
/// 出参（stdout）：`{ "width","height","rgba":[0..255…] }`（行主序、左上原点）。
/// 设备 GPU（Metal/AGSL）用**同一 backdrop + 同一 params** 渲染后，逐像素比对（容差内相等 ⇒ 落地正确）。
fn render_reference(spec_path: &str) -> Result<(), String> {
    use proteus_shader_codegen::reference::{render, GlassParams};
    let raw = std::fs::read_to_string(spec_path).map_err(|e| format!("读 spec 失败：{e}"))?;
    let spec: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("spec 解析失败：{e}"))?;

    let bd = &spec["backdrop"];
    let bw = bd["width"].as_u64().ok_or("backdrop.width 缺")? as usize;
    let bh = bd["height"].as_u64().ok_or("backdrop.height 缺")? as usize;
    let rgba = bd["rgba"].as_array().ok_or("backdrop.rgba 缺")?;
    if rgba.len() != bw * bh * 4 { return Err(format!("backdrop.rgba 长度 {} ≠ {}×{}×4", rgba.len(), bw, bh)); }
    let mut px: Vec<[f32; 4]> = Vec::with_capacity(bw * bh);
    for i in 0..(bw * bh) {
        let f = |k: usize| rgba[i * 4 + k].as_u64().unwrap_or(0) as f32 / 255.0;
        px.push([f(0), f(1), f(2), f(3)]);
    }

    let p = &spec["params"];
    let gp = GlassParams {
        size_px: (p["size_px"][0].as_f64().unwrap_or(130.0) as f32, p["size_px"][1].as_f64().unwrap_or(130.0) as f32),
        pad: p["pad"].as_f64().unwrap_or(24.0) as f32,
        radius: p["radius"].as_f64().unwrap_or(0.0) as f32,
        blur: p["blur"].as_f64().unwrap_or(0.0) as f32,
        refract_depth: p["refract_depth"].as_f64().unwrap_or(0.0) as f32,
        specular: p["specular"].as_f64().unwrap_or(0.18) as f32,
        saturation: p["saturation"].as_f64().unwrap_or(1.0) as f32,
        tint: [
            p["tint"][0].as_f64().unwrap_or(1.0) as f32,
            p["tint"][1].as_f64().unwrap_or(1.0) as f32,
            p["tint"][2].as_f64().unwrap_or(1.0) as f32,
            p["tint"][3].as_f64().unwrap_or(0.0) as f32,
        ],
        light_dir: (p["light_dir"][0].as_f64().unwrap_or(-0.35) as f32, p["light_dir"][1].as_f64().unwrap_or(-0.94) as f32),
        // ★★★决策 #911：区域背景亮度（缺省 0 = 视作深底）
        bg_lum: p["bg_lum"].as_f64().unwrap_or(0.0) as f32,
    };
    let ow = spec["out"]["width"].as_u64().unwrap_or(gp.size_px.0 as u64) as usize;
    let oh = spec["out"]["height"].as_u64().unwrap_or(gp.size_px.1 as u64) as usize;

    let out = render(&px, bw, bh, ow, oh, &gp);
    let rgba_out: Vec<u8> = out.iter().flat_map(|p| p.iter().map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
    let json = serde_json::json!({ "width": ow, "height": oh, "rgba": rgba_out });
    println!("{json}");
    Ok(())
}
