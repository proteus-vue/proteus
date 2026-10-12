// packages/shader-codegen-rust/src/land/msl.rs
// 落地：WGSL → iOS Metal Shading Language（MSL）。
use naga::back::msl::{self, Options, PipelineOptions};

/// 产出顶点 + 片元两份 MSL 源码（同模块、共享 varying 结构体 ⇒ 可对接）。
pub fn emit(module: &naga::Module, info: &naga::valid::ModuleInfo) -> Result<crate::Emitted, String> {
    // 找入口名（quad 顶点固定 vs_quad；片元由材质给定——这里按 stage 各取一个）
    let vs_name = module
        .entry_points
        .iter()
        .find(|e| e.stage == naga::ShaderStage::Vertex)
        .map(|e| e.name.clone())
        .ok_or("WGSL 缺少顶点入口（vs_quad）")?;
    let fs_name = module
        .entry_points
        .iter()
        .find(|e| e.stage == naga::ShaderStage::Fragment)
        .map(|e| e.name.clone())
        .ok_or("WGSL 缺少片元入口")?;

    let mut opts = Options::default();
    opts.lang_version = (2, 0);

    let mut vertex = None;
    let mut fragment = None;
    for (name, stage) in [(vs_name, naga::ShaderStage::Vertex), (fs_name, naga::ShaderStage::Fragment)] {
        let pipe = PipelineOptions {
            entry_point: Some((stage, name)),
            ..Default::default()
        };
        let (src, _) = msl::write_string(module, info, &opts, &pipe)
            .map_err(|e| format!("MSL 落地失败（{stage:?}）：{e:?}"))?;
        match stage {
            naga::ShaderStage::Vertex => vertex = Some(src),
            naga::ShaderStage::Fragment => fragment = Some(src),
            _ => {}
        }
    }
    Ok(crate::Emitted { vertex, fragment: fragment.unwrap(), spirv: None })
}
