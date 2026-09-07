// scripts/mp-entry-stub.ts
// mp 构建的 rollup 占位入口：真实 app.js 由 vite-plugin-mp-transform 在 buildStart 直出为纯文本资产
// （绕开 rollup 打包——微信 worklet 响应式重执行对打包代码不友好，见 examples/main.mp.ts 注释）
// 构建后此 chunk 会被插件在 generateBundle 中删除
export {}
