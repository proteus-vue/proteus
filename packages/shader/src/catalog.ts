// packages/shader/src/catalog.ts
// 材质目录（从生成物读取）+ 落地后端选择。
//
// 【为什么目录单独成文件】宿主/编译器要按"有哪些材质、uniform 怎么填"来建缓冲与设值；
//   目录 = 生成物 `MATERIAL_CATALOG`（Rust 真源导出）⇒ 单一事实源，不手抄。
import { MATERIAL_CATALOG } from './generated/materials'
import type { MaterialId, UniformField } from './spi'

export interface MaterialInfo {
  id: MaterialId
  entry: string
  uniformStruct: string
  uniformSize: number
  uniformLayout: UniformField[]
}

/** 全部材质（Rust 真源目录的只读视图）。 */
export const MATERIALS: readonly MaterialInfo[] = MATERIAL_CATALOG.materials.map((m) => ({
  id: m.id,
  entry: m.entry,
  uniformStruct: m.uniformStruct,
  uniformSize: m.uniformSize,
  uniformLayout: m.uniformLayout.map((f) => ({ name: f.name, offset: f.offset, size: f.size })),
}))

/** 按 id 查材质信息。 */
export function material(id: MaterialId): MaterialInfo | undefined {
  return MATERIALS.find((m) => m.id === id)
}
