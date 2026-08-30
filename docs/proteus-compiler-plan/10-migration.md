# 迁移指南

> 从"手写多入口 / 直接 wx.*"迁移到 Proteus 透明编译。

## 一、渐进式迁移

不要求一步到位，支持**混合模式**：

```
阶段 1：源码仍手写 main.mp.ts / 页面 JSON
         ↓ 接入 @proteus-vue/compiler 只做 SFC → 四件套
阶段 2：逐步把平台差异抽成 <route> / defineApp / app.component
         ↓ 编译器接管全局注册、分包、转场
阶段 3：全量透明编译，产物可审计
```

## 二、从 uni-app / Taro 迁移

| 现状 | 迁移动作 |
|------|---------|
| `#ifdef MP-WEIXIN` 条件编译 | 抽成 capability adapter，业务代码去分支 |
| `App()` / `Page()` 手写注册 | → `defineApp` / `definePage` |
| `pages.json` 手写 | → `<route>` 块就近声明 |
| `usingComponents` 每页写 | → `app.component()` 编译期注入 |
| `wx.xxx` 直调 | → `useCapability()` / `@proteus-vue/api` |

## 三、codemod 脚本

提供 AST 转换工具：
- `wx.navigateTo` → `useNavigator().push`
- `#ifdef MP-WEIXIN` 块 → adapter 文件
- `pages.json` 条目 → `<route>` 块

基于 `@babel/core` + `@vue/compiler-sfc`，可安全回滚。

## 四、兼容保证

- v1 → v2：旧写法仍可跑（deprecation warn，不报错）
- 每个 breaking change 有 codemod + 迁移文档
- 产物结构稳定（`.proteus/manifest.json` schema 版本化）

## 五、验收

- [ ] 存量项目可在 1 天内接入编译器
- [ ] codemod 覆盖 Top 20 常见写法
- [ ] 迁移前后产物行为一致（snapshot diff 可解释）
