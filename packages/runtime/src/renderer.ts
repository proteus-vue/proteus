// src/runtime/renderer.ts
// Vue3 自定义渲染器 → glass-easel（P5-2）
//
// ⚠ 可选扩展：MVP 不做（见 PROJECT_MEMORY 决策 #10）。
// 原因：glass-easel 运行时动态创建节点的 API 支持有限；"编译期为主"路线已覆盖 95% 场景，
// 实现运行时渲染器等于重走 Taro 3 运行时 DOM 模拟的老路（§0.2 痛点 #4）。
//
// 动态内容一律走"模板 + setData 数据驱动 + WXS（局部计算）"，不依赖本模块。
//
// 若后续实现（基于 @vue/runtime-core 的 createRenderer）：
// - createElement(tag) → glass-easel 节点描述（tag 映射同 src/compiler/template.ts）
// - insert(child, parent, anchor) → 父组件实例 appendChild / 插入节点
// - remove(child) → 父组件实例 removeChild
// - patchProp(el, key, prev, next) → 属性/事件映射（onClick → bindtap 等）
// - setText / setElementText → 文本节点处理
export {}
