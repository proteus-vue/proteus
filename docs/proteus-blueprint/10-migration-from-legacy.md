# 迁移对比：从传统跨端框架到 Proteus

> **目标**：用真实数据证明"透明编译"相比黑盒框架的维护优势

---

## 10.1 对比对象

| 框架 | 编译模型 | 全局组件方案 | 调试体验 |
|------|---------|------------|---------|
| uni-app (Vue3) | 黑盒 CLI | `App()` 隐式改写 | 需翻 CLI 源码 |
| Taro 4 | 编译 + 运行时混合 | 条件编译 | 中等 |
| **Proteus** | **透明编译** | **`mountMpApp({ appBar })` 显式** | **`--trace-transform` 可审计** |

## 10.2 迁移场景：播放条需求

### uni-app 方案

```ts
// main.ts (uni-app)
export default defineApp({
  // ❌ 无 appBar 概念，需手动在每个 page 写 <player-bar>
  // 或用自定义 tabBar（限制多：只能是 tab 页）
})
```

**痛点**：
- 要在 150 页每个 `pages.json` 配置 + 每个 WXML 写标签
- 切页播放条重建，音频中断
- 官方无"全局常驻组件"方案

### Proteus 方案

```ts
// main.ts (Proteus)
export default defineApp({
  appBar: PlayerBar,  // ✅ 写一次，编译期确定性注入
})
```

**优势**：
- 产物里 `app-bar/` 清晰可见
- `--trace-transform` 看到注入过程
- AI 可直接修改（规则在 `transforms/` 明文）

## 10.3 量化对比（150 页应用）

| 维度 | uni-app | Proteus | 改善 |
|------|---------|---------|------|
| 全局组件声明次数 | 150（每页） | 1 | **99.3% ↓** |
| 编译产物可追溯性 | 黑盒 | `--explain` | ✅ |
| 分包配置行数 | ~300 (pages.json) | 15 (chunk 字段) | 95% ↓ |
| 权限守卫生成 | 手写 150 if | 权限树自动 | 100% ↓ |
| 调试编译 bug 路径 | 读 CLI 源码 | 看 transform 规则 | 透明 |

## 10.4 迁移路径（渐进式）

```
阶段 1：新功能用 Proteus（播放器模块）
阶段 2：存量页面逐步迁移（codemod 脚本）
阶段 3：全量切换 + 旧框架移除
```

**codemod 示例**：
```bash
# 自动将 uni-app 的 pages.json 转 Proteus <route>
proteus migrate from-uni-app --pages-json ./src/pages.json
# → 生成 pages/**/*.vue 的 <route> 块
```

---
