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
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--list" => list = true,
            "--verify" => verify = true,
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

    let targets = ["msl", "agsl", "glsl"];

    if verify {
        let mut fail = 0;
        for m in materials::MATERIALS {
            for t in targets {
                let tg = Target::parse(t).unwrap();
                match emit(m.id, tg) {
                    Ok(e) => {
                        // 额外断言：产物非空、含预期标记
                        if e.fragment.is_empty() { eprintln!("✗ {}/{} 片元为空", m.id, t); fail += 1; }
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
    \n  --verify                        只校验落地，全绿退出 0");
}
