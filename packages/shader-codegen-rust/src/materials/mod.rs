// packages/shader-codegen-rust/src/materials/mod.rs
// ★★★材质目录 —— 每个材质 = 一份 WGSL（算法真源）+ 一个 uniform 布局（宿主设值的契约）。
//
// 【为什么用目录而不是散落的文件】宿主/TS 侧需要知道"有哪些材质、各自的 uniform 怎么填"；
//   把它集中在一处，并由 `proteus-shader-gen --list`（JSON）导出 ⇒ 单一事实源、可被脚本消费。
//
// 【扩容】加一个 `MaterialSpec` 条目 + 一份 `.wgsl`，再跑 `node scripts/gen-shaders.mjs` 即可（下游数据驱动：
//   TS 目录 / conformance / 三端生成物 / 宿主管线派发**全自动**纳入）。现有：glass · backdropBlur · frosted · vibrancy。
//   （gradient/glow/mask 不作为 WGSL 材质——保留原生图元，只把几何/曲线数学下沉内核，见 shader-backend-plan B4。）

/// 一种材质的 WGSL 源 + 元信息。
pub struct MaterialSpec {
    /// 稳定标识（宿主/TS 侧按此引用；亦是与 `<pg-glass>` 等编译期折叠结果对接的键）。
    pub id: &'static str,
    /// 片元入口名（naga 落地时用）。
    pub entry: &'static str,
    /// WGSL 源码（`include_str!` 于编译期嵌入——无需运行时读盘）。
    pub wgsl: &'static str,
    /// uniform 结构体名（各端落地后以此为常量缓冲名）。
    pub uniform_struct: &'static str,
    /// uniform 字节布局（字段名, 字节偏移, 字节长度）——宿主按此写常量缓冲。
    pub uniform_layout: &'static [(&'static str, u32, u32)],
    /// uniform 结构总字节长。
    pub uniform_size: u32,
}

/// ★共享的四边形顶点着色器 WGSL（所有材质复用；见 quad.wgsl）。
pub const QUAD_WGSL: &str = include_str!("quad.wgsl");

/// ★液态玻璃材质（当前唯一；B4 扩容）。
pub const GLASS: MaterialSpec = MaterialSpec {
    id: "glass",
    entry: "fs_glass",
    wgsl: include_str!("glass.wgsl"),
    uniform_struct: "GlassUniforms",
    // 与 glass.wgsl 顶部 struct 注释逐行对应（vec4 先放，避免 std140/16 字节对齐陷阱）。
    uniform_layout: &[
        ("tint", 0, 16),
        ("size_px", 16, 8),
        ("origin", 24, 8),
        ("tex_bias", 32, 8),
        ("tex_scale", 40, 8),
        ("light_dir", 48, 8),
        ("radius", 56, 4),
        ("blur", 60, 4),
        ("refract_depth", 64, 4),
        ("specular", 68, 4),
        ("saturation", 72, 4),
        // ★2026-10-17 补登：本槽自 #911 起语义化为 `bg_lum`（区域背景亮度；WGSL/三端宿主均按此名写），
        //   布局表此前仍写 `_pad` ⇒ 契约与真源不同名（生成物跟着错）。
        ("bg_lum", 76, 4),
        // ★★★决策 #905：触控形变（touch 盒局部 px / press 0..1）
        ("touch", 80, 8),
        ("press", 88, 4),
        ("overlay", 92, 4),
        // ★★★决策 #1004：内层/预模糊模式（0/1 锐背板 · 2 外层预模糊 · 3 内层复合帧；见 glass.wgsl struct）
        ("nest", 96, 4),
        // ★★★决策 #1027：形变域端部锥化（signed；0=身份）。★2026-10-17 补登：WGSL/三端宿主自 #1027
        //   起就有 `shp_a`（iOS glass-metal.swift 显式声明 `shp_a: Float // 100`），但本布局表漏了这条
        //   ⇒ 生成物 materials.ts 的布局末端停在 100 而 uniformSize=112，**宿主常量缓冲契约不完整**。
        ("shp_a", 100, 4),
    ],
    // 112 = 104 字节结构按 WGSL uniform 16 字节对齐上取整（shp_a 之后有 8 字节尾部填充）。
    uniform_size: 112,
};

/// ★★★背板模糊材质（backdropBlur）——玻璃的基座（只模糊 + tint，无折射/高光）。
pub const BACKDROP_BLUR: MaterialSpec = MaterialSpec {
    id: "backdropBlur",
    entry: "fs_backdrop_blur",
    wgsl: include_str!("backdrop_blur.wgsl"),
    uniform_struct: "BlurUniforms",
    uniform_layout: &[
        ("tint", 0, 16),
        ("size_px", 16, 8),
        ("origin", 24, 8),
        ("tex_bias", 32, 8),
        ("tex_scale", 40, 8),
        ("blur", 48, 4),
        ("saturation", 52, 4),
        ("_pad", 56, 8),
    ],
    uniform_size: 64,
};

/// ★★★磨砂材质（frosted · 决策 #900）——模糊 + 程序化颗粒（同 `BlurUniforms` 布局 ⇒ 宿主零改）。
pub const FROSTED: MaterialSpec = MaterialSpec {
    id: "frosted",
    entry: "fs_frosted",
    wgsl: include_str!("frosted.wgsl"),
    uniform_struct: "BlurUniforms",
    uniform_layout: &[
        ("tint", 0, 16),
        ("size_px", 16, 8),
        ("origin", 24, 8),
        ("tex_bias", 32, 8),
        ("tex_scale", 40, 8),
        ("blur", 48, 4),
        ("saturation", 52, 4),
        ("_pad", 56, 8),
    ],
    uniform_size: 64,
};

/// ★★★通透材质（vibrancy · 决策 #900）——模糊 + 大幅提饱和（同 `BlurUniforms` 布局 ⇒ 宿主零改）。
pub const VIBRANCY: MaterialSpec = MaterialSpec {
    id: "vibrancy",
    entry: "fs_vibrancy",
    wgsl: include_str!("vibrancy.wgsl"),
    uniform_struct: "BlurUniforms",
    uniform_layout: &[
        ("tint", 0, 16),
        ("size_px", 16, 8),
        ("origin", 24, 8),
        ("tex_bias", 32, 8),
        ("tex_scale", 40, 8),
        ("blur", 48, 4),
        ("saturation", 52, 4),
        ("_pad", 56, 8),
    ],
    uniform_size: 64,
};

/// 全部材质（顺序即 `--list` 输出顺序）。
pub const MATERIALS: &[MaterialSpec] = &[GLASS, BACKDROP_BLUR, FROSTED, VIBRANCY];

/// 按 id 查材质。
pub fn material(id: &str) -> Option<&'static MaterialSpec> {
    MATERIALS.iter().find(|m| m.id == id)
}

/// 导出材质目录为 JSON（供 `proteus-shader-gen --list` 与 TS 侧消费）。
pub fn catalog_json() -> String {
    let items: Vec<serde_json::Value> = MATERIALS
        .iter()
        .map(|m| {
            let layout: Vec<serde_json::Value> = m
                .uniform_layout
                .iter()
                .map(|(n, o, l)| serde_json::json!({ "name": n, "offset": o, "size": l }))
                .collect();
            serde_json::json!({
                "id": m.id,
                "entry": m.entry,
                "uniformStruct": m.uniform_struct,
                "uniformSize": m.uniform_size,
                "uniformLayout": layout,
            })
        })
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({ "materials": items })).unwrap()
}
