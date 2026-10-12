// packages/shader-codegen-rust/src/land/agsl.rs
// 落地：WGSL → Android **AGSL**（`android.graphics.RuntimeShader`）。
//
// 【为什么不是直接用 naga 的 GLSL 后端】AGSL 是**标准 GLSL-ES-3.20 的一个受控子集**，naga 只能出到
//   GLSL-ES-3.10，且两者在若干表示上不同。核心差异（本层逐条机械改写，规则集中、可单测）：
//   ① 无 `#version`/`precision`（AGSL 隐式 320、精度固定）；
//   ② 采样器：`uniform sampler2D s; … texture(s,uv)` → `uniform shader s; … s.eval(px)`；
//   ③ **无 uniform block**（std140）：AGSL 的 uniform 必须**逐个平铺声明**（`uniform float4 x;`），
//      并用 `setFloatUniform` 设值 ⇒ 本层把 `layout(std140) uniform B { S inst; };` 的 `inst.field`
//      访问**展平**为顶层 `field`，并删除 block/struct 声明、改写访问；
//   ④ 片元入口：AGSL 固定 `half4 main(float2 coord)`（coord = 片元**像素**坐标）；
//   ⑤ `gl_FragCoord` → `coord`。
//   ★语法/绑定名归一（宿主按生成的**稳定名** setInputShader/setFloatUniform，不再有 mangled 名）。
//
// 【API 门】AGSL 需 Android API 31+；<31 由宿主按框架降级（半透明实色，绝不白屏/黑块）。
use crate::land::glsl;

/// 生成 AGSL 片元源码。
///
/// 【Android 落地形态说明】AGSL 由 **`android.graphics.RuntimeShader`** 加载——Java 源码**不**包含
///   本字符串（它是运行时由宿主从 assets 读入的）。故这里产出的源码**不做** `_pad` 字段/边界 hack，
///   只保证"能喂给 RuntimeShader 编译"（半精度 → `main(float2 coord)` 入口、`.eval` 采样、平铺 uniform）。
///   调用方（宿主）用 `UniformLayout`（catalog）设值：`setFloatUniform("tint", ...)` 等。
pub fn emit(module: &naga::Module, info: &naga::valid::ModuleInfo, fragment_entry: &str) -> Result<crate::Emitted, String> {
    let glsl_frag = glsl::emit_stage(module, info, naga::ShaderStage::Fragment, fragment_entry)?;
    let agsl = rewrite_glsl_to_agsl(&glsl_frag);
    // ★★★门禁（无设备可跑）：**AGSL 不支持 `while`**（只支持 `for`）——naga 会把任何 WGSL 循环出成
    //   GLSL `while(true){…}` ⇒ 若算法里出现循环，此断言**当场报错**（否则真机编译失败、玻璃**静默降级**
    //   为半透明实色——本仓实测踩过：B2 声称"Android 玻璃已验"，实际 AGSL 一直编译失败）。
    //   修法：把固定次数循环**展开**（见 materials/*.wgsl 同注）。
    if agsl.contains("while") {
        return Err("AGSL 落地物含 `while`（AGSL 不支持）——请把算法中的循环展开（见 materials/*.wgsl 注释）".into());
    }
    Ok(crate::Emitted { vertex: None, fragment: agsl, spirv: None })
}

/// GLSL-ES-3.10 → AGSL 机械改写（规则见文件头）。
fn rewrite_glsl_to_agsl(src: &str) -> String {
    // ── 第一遍：解析所有 struct（名→字段），并识别 uniform block（其结构体名 + 实例名）与采样器名 ──
    let mut structs: Vec<(String, Vec<(String, String)>)> = Vec::new();
    let mut block_struct: Option<String> = None;
    let mut block_inst: Option<String> = None;
    let mut sampler_name: Option<String> = None;
    {
        let mut cur: Option<(String, Vec<(String, String)>)> = None;
        for raw in src.lines() {
            let t = raw.trim();
            if let Some(rest) = t.strip_prefix("struct ") {
                let name = rest.trim_end_matches('{').trim().to_string();
                cur = Some((name, Vec::new()));
                continue;
            }
            if let Some((_, fields)) = cur.as_mut() {
                if t.starts_with('}') {
                    structs.push(cur.take().unwrap());
                    continue;
                }
                let no_semi = t.trim_end_matches(';');
                let mut it = no_semi.split_whitespace();
                if let (Some(ty), Some(nm)) = (it.next(), it.next()) {
                    if !ty.is_empty() && !nm.is_empty() {
                        fields.push((ty.to_string(), nm.to_string()));
                    }
                }
                continue;
            }
            if t.starts_with("layout(std140) uniform") {
                // `layout(std140) uniform B { S inst; };`
                if let Some(brace) = t.find('{') {
                    let inner = t[brace + 1..].trim_start();
                    let inner = inner.split('}').next().unwrap_or("").trim();
                    let mut it = inner.split_whitespace();
                    if let Some(ty) = it.next() {
                        block_struct = Some(ty.to_string());
                    }
                    if let Some(inst) = it.next() {
                        block_inst = Some(inst.trim_end_matches(';').to_string());
                    }
                }
            }
            if t.starts_with("uniform") && t.contains("sampler2D") {
                if let Some(nm) = t.split_whitespace().last() {
                    sampler_name = Some(nm.trim_end_matches(';').to_string());
                }
            }
        }
    }
    let inst = block_inst.clone().unwrap_or_default();
    // ★只取 uniform block 那个 struct 的字段（避免顶点 varyings 结构体混入平铺 uniform）
    let fields: Vec<(String, String)> = block_struct
        .as_ref()
        .and_then(|bs| structs.iter().find(|(n, _)| n == bs))
        .map(|(_, f)| f.clone())
        .unwrap_or_default();

    // ── 第二遍：逐行改写 ──
    let mut out = String::new();
    let mut out_var: Option<String> = None;
    let mut in_struct = false;
    let mut emitted_flat_uniforms = false;
    for raw in src.lines() {
        let t = raw.trim();
        if t.starts_with("#version") || t.starts_with("precision ") { continue; }
        if t.starts_with("struct ") { in_struct = true; continue; }
        if in_struct {
            if t.starts_with('}') { in_struct = false; }
            continue;
        }
        if t.starts_with("layout(std140) uniform") {
            if !emitted_flat_uniforms {
                for (ty, nm) in &fields {
                    out.push_str(&format!("uniform {ty} {nm};\n"));
                }
                emitted_flat_uniforms = true;
            }
            continue;
        }
        if t.starts_with("layout(location") && t.contains("out ") {
            if let Some(nm) = t.split_whitespace().last() {
                out_var = Some(nm.trim_end_matches(';').to_string());
            }
            continue;
        }
        if t.starts_with("uniform") && t.contains("sampler2D") {
            out.push_str("uniform shader backdrop_tex;\n");
            continue;
        }
        out.push_str(raw);
        out.push('\n');
    }
    let out_var = out_var.unwrap_or_else(|| "_fs2p_location0".to_string());

    // ① 展平 block 实例字段访问（先做，避免与采样器改名冲突——两个 naga 名都以 _fs 结尾）
    let out = if inst.is_empty() {
        out
    } else {
        let stripped = out.replace(&format!("{inst}."), "");
        replace_ident(&stripped, &inst, "")
    };
    // ② 采样器稳定改名（按 token 边界，避免误伤）
    let out = match &sampler_name {
        Some(sm) => replace_ident(&out, sm, "backdrop_tex"),
        None => out,
    };
    // ③ texture(s, c) → s.eval(c)
    let out = rewrite_texture_calls(&out);
    // ④ gl_FragCoord → coord；入口签名；return
    finalize_main(&out, &out_var)
}

/// 按**标识符边界**把 `from` 整体替换为 `to`（避免子串误伤，如 `_a` 命中 `_ab`）。
fn replace_ident(src: &str, from: &str, to: &str) -> String {
    if from.is_empty() { return src.to_string(); }
    let bytes = src.as_bytes();
    let fb = from.as_bytes();
    let is_ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + fb.len() <= bytes.len()
            && &bytes[i..i + fb.len()] == fb
            && (i == 0 || !is_ident(bytes[i - 1]))
            && (i + fb.len() == bytes.len() || !is_ident(bytes[i + fb.len()]))
        {
            out.push_str(to);
            i += fb.len();
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

/// 文本级把 `texture(<sampler>, <arg>)` 改写成 `<sampler>.eval(<arg>)`。
fn rewrite_texture_calls(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if src[i..].starts_with("texture(") {
            let mut depth = 0i32;
            let mut j = i + "texture".len();
            let start = j;
            let mut comma = None;
            while j < bytes.len() {
                match bytes[j] {
                    b'(' => depth += 1,
                    b')' => { depth -= 1; if depth == 0 { break; } }
                    b',' if depth == 1 => { comma = Some(j); }
                    _ => {}
                }
                j += 1;
            }
            if let Some(c) = comma {
                let sampler = src[start + 1..c].trim();
                let coord = src[c + 1..j].trim();
                out.push_str(&format!("{sampler}.eval({coord})"));
                i = j + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// 把 naga 的 `void main()` 片元改写成 AGSL 的 `half4 main(float2 coord)`。
///
/// naga 出的 GLSL 片元尾部形如：
/// ```glsl
/// void main() { … _fs2p_location0 = <expr>; return; }
/// ```
/// AGSL 要求单入口 `half4 main(float2 coord)` 且**返回值**。⇒ 把 out 变量赋值行改成
/// `return half4(<expr>);`，并删掉裸 `return;`（AAGSL 无 void 返回）。
fn finalize_main(src: &str, out_var: &str) -> String {
    let src = src.replace("gl_FragCoord", "vec4(coord.x, coord.y, 0.0, 1.0)");
    let head = src.replace("void main()", "half4 main(float2 coord)");
    let mut out = String::with_capacity(head.len());
    for line in head.lines() {
        let t = line.trim();
        // 裸 return;（片元末尾的 void 返回）——删除
        if t == "return;" {
            continue;
        }
        // `<out_var> = <expr>;` → `return half4(<expr>);`
        if let Some(rest) = t.strip_prefix(&format!("{out_var} =")) {
            if let Some(expr) = rest.trim().strip_suffix(';') {
                out.push_str(&format!("    return half4({expr});\n"));
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glass_agsl() -> String {
        crate::emit_fragment("glass", crate::Target::Agsl).expect("emit")
    }

    #[test]
    fn agsl_invariants() {
        let s = glass_agsl();
        // ① AGSL 入口签名
        assert!(s.contains("half4 main(float2 coord)"), "需 AGSL 入口签名");
        // ② 无 version/precision
        assert!(!s.contains("#version"), "不应含 #version");
        assert!(!s.contains("precision "), "不应含 precision");
        // ③ 无 sampler2D / 无 uniform block
        assert!(!s.contains("sampler2D"), "AGSL 无 sampler2D");
        assert!(!s.contains("std140"), "AGSL 无 uniform block（须平铺）");
        // ④ 采样器用 .eval
        assert!(s.contains("backdrop_tex.eval("), "采样须用 .eval");
        // ⑤ 无 naga mangled 绑定名
        assert!(!s.contains("_group_0_binding_"), "不应残留 mangled 绑定名");
        // ⑥ 平铺 uniform（不再是 inst.field）
        assert!(s.contains("uniform vec4 tint;"), "tint 应平铺为 uniform vec4");
        assert!(!s.contains(".tint"), "字段访问应已展平");
        // ⑦ gl_FragCoord 已换
        assert!(!s.contains("gl_FragCoord"), "应无 gl_FragCoord");
        // ⑧ 尾部不残留未声明的 out 变量与裸 return;
        assert!(!s.contains("_fs2p_location0"), "out 变量应已改为 return half4(...)");
        assert!(!s.contains("return;"), "不应残留裸 return;（AGSL 无 void 返回）");
        assert!(s.contains("return half4("), "应有 half4 返回");
    }
}
