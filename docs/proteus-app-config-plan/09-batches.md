# 分批策略（G-35）

## 依赖图

```
G-35 App Config
  ├─ depends: Architecture 原则 #10
  ├─ depends: Style Safety (G-31) — 校验哲学
  ├─ depends: Cache (G-28) — L1 缓存
  ├─ supports: Theme (G-27) / Font (G-27) / Memorial (G-25)
  └─ integrates: CLI (G-33) / DevTools (G-34)
```

**无外部阻塞**：M1 可立即启动。

## 批次

| 批次 | 内容 | 依赖 | 可单测 | 产出 |
|------|------|------|--------|------|
| **M1** | Schema + 合并逻辑 + 校验器 | 无 | ✅ 纯逻辑 | 100% 单测覆盖 |
| **M2** | `defineAppConfig` + `useAppConfig()` 响应式 | Vue runtime | ✅ | 基础 API 可用 |
| **M3** | 多环境加载 + 平台覆盖 | M1 | ✅ | env/platform 生效 |
| **M4** | 远端下发（https source）+ L1 缓存 | Cache G-28 | ⚠️ mock | 热更新可用 |
| **M5** | 五端原生持久化 + CLI `check`/`gen` | CLI G-33 | ⚠️ 需原生 | 全端闭环 |

## M1 最小验证（推荐先动手）

**纯 TS、零依赖、100% 单测覆盖**：

```typescript
// config-merger.test.ts
describe('config merge', () => {
  it('深合并保留未覆盖字段', () => { /* ... */ })
  it('平台覆盖优先级正确', () => { /* ... */ })
  it('数组替换不拼接', () => { /* ... */ })
})

// config-validator.test.ts
describe('config validation', () => {
  it('拒绝非法 semver', () => { /* ... */ })
  it('拒绝超时超范围', () => { /* ... */ })
  it('非法值降级不抛错', () => { /* ... */ })
})
```

**最快出可演示效果**：`proteus check config` CLI 原型。

## Prompt 模板（G-35 M1）

```
你在实现 Proteus 框架的应用全局配置系统（G-35）。

## 背景
区别于 proteus.config（工程构建配置），应用全局配置解决应用级运行时配置：
- 应用标识、版本、环境
- API 域名、超时、缓存策略
- 功能开关、实验分组
- 多端差异化
- 远端下发热更新

## 原则
- 单一事实源、类型安全、运行时校验、远端下发
- 与 Style Safety (G-31) 共用校验哲学：宁可降级，也不崩溃
- 原则 #10：统一语义 + 原生实现

## 任务（M1）
实现：
1. AppConfigSchema（zod 或自研）
2. 合并逻辑（默认 < env < platform < remote）
3. 校验器（合法→生效，非法→降级+告警）

## 约束
- 纯 TypeScript，零依赖（不强制 zod，可用自研轻量校验）
- 100% 单测覆盖
- 不依赖 Vue / JSI / 任何运行时

## 验收
- pnpm vitest run → 全绿
- 性能：合并 1000 字段 < 1ms
```

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| zod 增加包体积 | M1 可用自研轻量校验器（仅 ~2KB） |
| 远端下发延迟 | 首屏不阻塞，用 L1 缓存 |
| 配置过度复杂 | 保持扁平，嵌套 ≤ 3 层 |
| 类型推导失败 | 显式声明 `declare module` |
