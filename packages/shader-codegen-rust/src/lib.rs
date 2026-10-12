// packages/shader-codegen-rust/src/lib.rs
// ★★★ShaderBackend 算法真源（决策 #834）——把材质 WGSL 单源落成各端着色器源码。
//
// 【它是什么】Proteus 的「着色器后端」：算法（WGSL）只写一次，naga 负责落地到
//   iOS Metal(MSL) 与 Android AGSL。宿主只做"编译生成物 + 设 uniform + 跑 pass"，不再手写算法。
//
// 【为什么在 Rust】① 与内核同栈（构建期用同一 cargo 工具链）；② naga 是 Rust 生态成熟的
//   WGSL↔MSL/GLSL 转译器（工业验证）；③ 算法真源与平台实现分离 = 原则 #0/#2（语义收敛、原生落地）。
pub mod land;
pub mod materials;
pub mod reference;

/// 落地目标语言/平台。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// iOS Metal Shading Language（MSL）。
    Msl,
    /// Android AGSL（`android.graphics.RuntimeShader`；由 GLSL-ES-3.10 机械改写而来）。
    Agsl,
    /// 标准 GLSL-ES-3.10（GLES3 承载/调试用；也是 AGSL 改写的中间形态）。
    Glsl,
}

impl Target {
    pub fn parse(s: &str) -> Result<Target, String> {
        match s {
            "msl" => Ok(Target::Msl),
            "agsl" => Ok(Target::Agsl),
            "glsl" => Ok(Target::Glsl),
            other => Err(format!("未知 target：{other}（可选 msl/agsl/glsl）")),
        }
    }
    pub fn id(&self) -> &'static str {
        match self {
            Target::Msl => "msl",
            Target::Agsl => "agsl",
            Target::Glsl => "glsl",
        }
    }
}

/// 落地产物：一个材质的着色器源码。
pub struct Emitted {
    /// 顶点着色器源码（MSL/GLSL 需要；AGSL 由框架提供几何 ⇒ None）。
    pub vertex: Option<String>,
    /// 片元着色器源码（主产物）。
    pub fragment: String,
}

/// 把某材质落地到某目标（核心 API）。
pub fn emit(material_id: &str, target: Target) -> Result<Emitted, String> {
    let m = materials::material(material_id)
        .ok_or_else(|| format!("未知材质：{material_id}"))?;
    // ★组合成**单一 WGSL 模块**（quad 顶点 + 材质片元）——naga 在同一模块内统一 varying 契约，
    //   MSL 才能产出**顶点/片元可对接**的一份程序（分模块编译会各自发明 varying 结构体名 ⇒ 对不上）。
    let combined = format!("{}\n\n{}", materials::QUAD_WGSL, m.wgsl);
    land::emit(&combined, m.entry, target)
}

/// 便捷：只要片元源码（AGSL / 多数场景）。
pub fn emit_fragment(material_id: &str, target: Target) -> Result<String, String> {
    Ok(emit(material_id, target)?.fragment)
}
