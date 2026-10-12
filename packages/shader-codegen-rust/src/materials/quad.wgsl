// packages/shader-codegen-rust/src/materials/quad.wgsl
// ★★★共享的**四边形顶点着色器**（所有材质复用）——把盒内 quad 顶点映射到裁剪空间。
//   ★无 varying 输出：材质片元用 `@builtin(position)` 自取像素坐标（见 glass.wgsl 契约说明），
//     故顶点只负责几何（Metal 需要它；AGSL 由框架提供几何，不用本文件）。
struct VsOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_quad(@builtin(vertex_index) vi: u32) -> VsOut {
    // 两个三角形覆盖 [0,1]²：uv.y=0 在顶 ⇒ clip.y=+1
    var x = 0.0; var y = 0.0;
    if vi == 0u { x = 0.0; y = 0.0; }
    else if vi == 1u { x = 1.0; y = 0.0; }
    else if vi == 2u { x = 0.0; y = 1.0; }
    else if vi == 3u { x = 0.0; y = 1.0; }
    else if vi == 4u { x = 1.0; y = 0.0; }
    else { x = 1.0; y = 1.0; }
    var o: VsOut;
    o.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return o;
}
