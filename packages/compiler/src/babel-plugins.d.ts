// packages/compiler/src/babel-plugins.d.ts
// ★#504 babel plugin 包无内置类型（仅 CJS lib）——模块声明兜底（plugin 本体是 function，兼容 { default } 互操作）
declare module '@babel/plugin-transform-nullish-coalescing-operator' {
  const plugin: any
  export default plugin
}
declare module '@babel/plugin-transform-optional-chaining' {
  const plugin: any
  export default plugin
}
declare module '@babel/plugin-transform-logical-assignment-operators' {
  const plugin: any
  export default plugin
}
declare module '@babel/plugin-transform-object-rest-spread' {
  const plugin: any
  export default plugin
}
