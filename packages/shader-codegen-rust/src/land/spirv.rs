// packages/shader-codegen-rust/src/land/spirv.rs
// 落地：WGSL → SPIR-V（Vulkan 载体；鸿蒙腿 · 决策 #841）。
//
// 【为什么有这一端】鸿蒙 SDK 原生支持 Vulkan（`libvulkan.so` + 全量 `vulkan_ohos.h`；真机取证
//   Maleoon 920C = Vulkan 1.3 + 计算/图形队列）⇒ 鸿蒙玻璃**不必**做 CPU 移植（那是"无 GPU 着色器
//   API"的错误前提下的退路）。正确形态：**同一份 WGSL 单源 → SPIR-V**，宿主离屏 Vulkan 跑 ——
//   与 Android(AGSL)/iOS(MSL) 同源、宿主零算法。
//
// 【产物形态】SPIR-V 是**二进制**（u32 字序列，小端）。naga 的 `spv::write_vec` 返回 `Vec<u32>`；
//   本模块把它序列化成**小端字节**（Vulkan `vkCreateShaderModule` 吃的正是字节流）。
//   顶点、片元各自一份 module（同 WGSL 模块、不同 entry point）。
use naga::back::spv;

/// 产出顶点 + 片元两份 SPIR-V **字节流**（小端；供 vkCreateShaderModule）。
pub fn emit(module: &naga::Module, info: &naga::valid::ModuleInfo) -> Result<(Vec<u8>, Vec<u8>), String> {
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

    let opts = spv::Options::default();
    let to_bytes = |words: Vec<u32>| -> Vec<u8> {
        let mut bytes = Vec::with_capacity(words.len() * 4);
        for w in words {
            bytes.extend_from_slice(&w.to_le_bytes());   // SPIR-V 小端（Vulkan 契约）
        }
        bytes
    };
    let mut vertex: Option<Vec<u8>> = None;
    let mut fragment: Option<Vec<u8>> = None;
    for (name, stage) in [(vs_name, naga::ShaderStage::Vertex), (fs_name, naga::ShaderStage::Fragment)] {
        let pipe = spv::PipelineOptions {
            shader_stage: stage,
            entry_point: name,
        };
        let words = spv::write_vec(module, info, &opts, Some(&pipe))
            .map_err(|e| format!("SPIR-V 落地失败（{stage:?}）：{e:?}"))?;
        match stage {
            naga::ShaderStage::Vertex => vertex = Some(to_bytes(words)),
            naga::ShaderStage::Fragment => fragment = Some(to_bytes(words)),
            _ => {}
        }
    }
    Ok((vertex.unwrap(), fragment.unwrap()))
}
