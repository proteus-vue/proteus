// packages/shader-codegen-rust/src/land/mod.rs
// ★★★落地层 —— WGSL 单一源 → 各端着色器源码。**这是 ShaderBackend 的"后端"集合**。
//
// 【分工】本层只做"语法/方言"落地，不含任何材质算法（算法在 materials/*.wgsl）。
//   新增一端 = 加一个 land/<端>.rs（B5 的鸿蒙在此接入）。
pub mod agsl;
pub mod glsl;
pub mod msl;
pub mod spirv;

use crate::Target;

// ★WGSL 前端公共部分：解析 + 校验（各后端共用）。
pub(crate) fn parse_and_validate(
    wgsl: &str,
) -> Result<(naga::Module, naga::valid::ModuleInfo), String> {
    let module = naga::front::wgsl::parse_str(wgsl).map_err(|e| format!("WGSL 解析失败：{}", e.emit_to_string(wgsl)))?;
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    let info = validator.validate(&module).map_err(|e| format!("WGSL 校验失败：{e:?}"))?;
    Ok((module, info))
}

/// 把（已组合的）WGSL 模块落地到目标。
pub fn emit(combined_wgsl: &str, fragment_entry: &str, target: Target) -> Result<crate::Emitted, String> {
    let (module, info) = parse_and_validate(combined_wgsl)?;
    match target {
        Target::Msl => msl::emit(&module, &info),
        Target::Glsl => glsl::emit(&module, &info, fragment_entry),
        Target::Agsl => agsl::emit(&module, &info, fragment_entry),
        Target::Spirv => {
            // ★★★SPIR-V 目标是**二进制**：文本字段留空，二进制走 `spirv` 字段（决策 #841）。
            let (vert, frag) = spirv::emit(&module, &info)?;
            Ok(crate::Emitted { vertex: None, fragment: String::new(), spirv: Some((vert, frag)) })
        }
    }
}
