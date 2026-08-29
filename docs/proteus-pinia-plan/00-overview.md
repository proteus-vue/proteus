# Proteus × Pinia 多端适配 — 执行总览

> **版本**：v1.0（对应 Proteus v2.47 基线）
> **目标**：让同一份 Pinia store 源码在 Web SPA / 微信小程序 Skyline / App（Custom Renderer）/ SSR 四端行为一致，持久化层统一可插拔。
> **核心原则**：延续 Proteus「透明编译 + AI-native + 规则可审计」哲学 —— 适配层**零黑盒**，每条适配规则独立模块、JSDoc 契约、产物可追溯。

---

## 1. 适配总览

| 端 | 运行环境 | Pinia 核心 API | 持久化后端 | 关键差异点 |
|----|---------|---------------|-----------|-----------|
| Web SPA | 浏览器（DOM） | ✅ 完整 | localStorage / IndexedDB | 基准实现 |
| 微信小程序 Skyline | 逻辑层 JS | ✅ 完整（同 V8） | `wx.setStorageSync` | 无 `window`、单线程受限、SSR 不需要 |
| App（Custom Renderer） | JSC/Hermes + 原生桥 | ✅ 完整 | 原生 KV / MMKV | 序列化边界、跨线程 |
| SSR | Node.js | ⚠️ 需实例隔离 | 无（服务端不持久化） | `createPinia()` 每请求一份 |

**设计原则**：Pinia 核心（state / getters / actions / storeToRefs）四端**完全共用同一份 `.ts` 源码**，差异**只**集中在：
1. `createPinia()` 的插件注册方式
2. 持久化存储适配器（Storage Adapter）
3. DevTools 连接（仅 Web / 开发模式）
4. SSR 的实例注入与注水（hydration）

---

## 2. 目录结构（建议）

```
src/
  stores/                      ← 业务 store（四端共用，禁止写平台判断）
    user.ts
    player.ts                  ← 音乐播放器示例（全局控制条配套）
    ...
  platforms/
    web/
      pinia.ts                 ← createWebPinia()
    mp/
      pinia.ts                 ← createMpPinia()
    app/
      pinia.ts                 ← createAppPinia()（未来）
    ssr/
      pinia.ts                 ← createSsrPinia()
  shared/
    storage/
      types.ts                 ← StorageAdapter 接口
      memory.ts                ← 内存版（SSR / 测试）
      localStorage.ts          ← Web
      wxStorage.ts             ← 小程序
      nativeKV.ts              ← App 端（占位）
    persistence/
      plugin.ts                ← 兼容 pinia-plugin-persistedstate
      lightweight.ts           ← 自研极薄方案
      serialize.ts             ← 统一序列化（含 Date / Map / Set / 循环引用）
  ssr/
    context.ts                 ← SSR 请求上下文（避免跨请求污染）
```

**铁律**：`stores/` 目录内**禁止出现 `if (platform)` 分支**。所有平台差异收敛在 `platforms/*/pinia.ts` 和 `shared/storage/*`。

---

## 3. 模块拆分索引（每个文件独立，可分批喂 LLM）

| 文件 | 内容 | 依赖 |
|------|------|------|
| `01-storage-adapter.md` | Storage 抽象层设计 + 各端实现规范 | — |
| `02-persistence-plugin.md` | 兼容 `pinia-plugin-persistedstate` 的适配 | 01 |
| `03-lightweight-persistence.md` | 自研极薄持久化 API | 01 |
| `04-create-pinia-per-platform.md` | 四端 `createXxxPinia()` 工厂 | 01-03 |
| `05-ssr-isolation.md` | SSR 实例隔离 + hydration | 04 |
| `06-devtools.md` | DevTools 连接（Web only） | 04 |
| `07-testing.md` | 单元测试 / 跨端矩阵测试 | 01-06 |
| `08-migration-guide.md` | 从原生 Pinia 迁移到 Proteus 的步骤 | 全部 |

---

## 4. 里程碑（粗粒度，细节见各模块文档）

```
M1 ── Storage 抽象层 + 各端实现 + 序列化            (01)
M2 ── 持久化：社区插件兼容 + 自研轻量方案            (02, 03)
M3 ── 四端 createPinia 工厂 + 统一入口              (04)
M4 ── SSR 隔离 + hydration                          (05)
M5 ── DevTools（Web）                               (06)
M6 ── 测试矩阵 + 迁移文档                           (07, 08)
```

**依赖关系**：M1 → M2 → M3 → {M4, M5} → M6

---

## 5. 核心设计决策（已锁定）

### 5.1 Storage 适配器模式
所有持久化后端实现统一接口：
```ts
interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}
```
- 同步（`localStorage` / `wx.setStorageSync`）和异步（`AsyncStorage` / `MMKV`）**统一为 async**，调用方不区分。

### 5.2 序列化统一
`shared/persistence/serialize.ts` 处理：
- `Date` ↔ ISO 字符串
- `Map` / `Set` ↔ 数组 / 对象标记
- `BigInt` ↔ 字符串（需标记）
- 循环引用 → 报错（开发模式）/ 丢（生产）
- 自定义 class 实例 → 需提供 `toJSON` / `fromJSON`

### 5.3 SSR 隔离
- **绝不**在模块顶层 `createPinia()`
- 每个请求创建独立实例，通过 `app.runWithContext()`（Vue 3.3+）注入
- 客户端 hydration 时**只恢复**被持久化的 store，避免注水不匹配

---

## 6. 不做的事（明确排除，防止 scope creep）

- ❌ 不实现 Redux DevTools 协议（仅 Pinia 官方 DevTools）
- ❌ 不实现时间旅行（SSR 下无意义）
- ❌ 不做跨 store 事务（保持 Pinia 原子性）
- ❌ 不修改 Pinia 内部源码（全部走插件 / 适配器）

---

## 7. 验收标准（Done Definition）

- [ ] 同一份 `stores/player.ts` 在四端运行，行为一致
- [ ] 持久化配置一处声明，四端生效（自动选对应 Storage）
- [ ] SSR 压测 1000 QPS 无跨请求状态污染
- [ ] 单元测试覆盖率 ≥ 80%（`stores/` + `shared/`）
- [ ] `--trace-storage` 可打印每次持久化读写（对齐 `--trace-transform`）
- [ ] 迁移文档：原生 Pinia 项目 ≤ 10 行改动即可接入 Proteus

---

## 下一步
→ 按顺序阅读 `01-storage-adapter.md` 起，每个模块独立实现、独立测试、独立 PR。
