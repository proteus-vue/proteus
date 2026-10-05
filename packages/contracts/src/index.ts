// packages/contracts/src/index.ts
// @proteus-vue/contracts —— 跨层共享 DTO 契约（架构规约 L0 + types-plan §07）
// 定位：RouteRecord/RouteMeta/RouteTransition/ApiResponse/StoreSnapshot/CapabilityDescriptor
//       单一来源，消除 Router/Module 各自定义 DTO（铁律 #9 同名必同义）；零运行时依赖纯类型。
// 消费：types 包 re-export 兼容（types → contracts 单向）；各实现包经 types 或直接 import 本包。

export * from './route'
export * from './api'
export * from './store'
export * from './capability'
export * from './style'
export * from './backend'
// ★LY0（2026-10-02）：页面层级契约（四层语义模型 + 跨端映射表——单一来源）
export * from './layers'
// ★★★GP1-a（2026-10-03）：三层挂载契约（mount layer——与 layers.ts 的层内四层**正交**）
export * from './mount-layers'
// ★SC2（2026-10-02）：可停靠滚动容器契约（声明式封闭集——方案 §6）
export * from './scroll'
// ★★★G-61 B0（2026-10-05）：**StyleIR 字段注册表**（三表合一的机器推导产物）——
//   字段闭集 + scope（semantic/engine-only）+ 值类型 + 各表来源；门禁 `check:style-ir-schema`。
export * from './style-ir-registry.generated'
// ★★★G-61 B0：**SApp 宿主样式应用器 SPI** 契约（唯一样式落地点——每宿主一个实现）
export * from './style-applier'
// ★★★G-61 B0：**StyleIR 规范化编码**（跨语言逐字节确定——INV-CE-01 的编码层；golden 对拍）
export * from './style-ir-canonical'
