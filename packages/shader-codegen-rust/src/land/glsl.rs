// packages/shader-codegen-rust/src/land/glsl.rs
// 落地：WGSL → 标准 GLSL-ES-3.10（GLES3 承载/调试；也是 AGSL 改写的中间形态）。
use naga::back::glsl;

pub fn emit(module: &naga::Module, info: &naga::valid::ModuleInfo, fragment_entry: &str) -> Result<crate::Emitted, String> {
    Ok(crate::Emitted {
        vertex: Some(emit_stage(module, info, naga::ShaderStage::Vertex, vertex_entry(module)?)?),
        fragment: emit_stage(module, info, naga::ShaderStage::Fragment, fragment_entry)?,
    })
}

fn vertex_entry(module: &naga::Module) -> Result<&str, String> {
    module
        .entry_points
        .iter()
        .find(|e| e.stage == naga::ShaderStage::Vertex)
        .map(|e| e.name.as_str())
        .ok_or_else(|| "WGSL 缺少顶点入口".to_string())
}

pub(crate) fn emit_stage(
    module: &naga::Module,
    info: &naga::valid::ModuleInfo,
    stage: naga::ShaderStage,
    entry: &str,
) -> Result<String, String> {
    let opts = glsl::Options {
        version: glsl::Version::Embedded { version: 310, is_webgl: false },
        ..Default::default()
    };
    let pipe = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.to_string(), multiview: None };
    let mut out = String::new();
    let mut writer = glsl::Writer::new(
        &mut out,
        module,
        info,
        &opts,
        &pipe,
        naga::proc::BoundsCheckPolicies::default(),
    )
    .map_err(|e| format!("GLSL writer 创建失败（{stage:?}）：{e:?}"))?;
    writer.write().map_err(|e| format!("GLSL 落地失败（{stage:?}）：{e:?}"))?;
    Ok(out)
}
