# Proteus × Pinia 多端适配 — 执行总览

> **版本**：v1.0（对应 Proteus v2.47 基线）
> **目标**：让同一份 Pinia store 源码在 Web SPA / 微信小程序 Skyline / App（Custom Renderer）/ SSR 四端行为一致，持久化层统一可插拔。
> **定位**：M1-M6 构成「企业级标准骨架」；M7-M8 在此基础上覆盖「超级应用」场景（千级 store / 长期运行 / 多端协同 / 千人千机调试）。
> **核心原则**：延续 Proteus「透明编译 + AI-native + 规则可审计」哲学 —— 适配层**零黑盒**，每条适配规则独立模块、JSDoc 契约、产物可追溯。

### 两档交付

| 档位 | 里程碑 | 适用 | 状态 |
|------|--------|------|------|
| **企业级** | M1 - M6 | 中等规模 App、四端一致、长期维护 | ✅ 基础规划（01-09） |
| **超级应用** | M7 - M8 | 千级 store、高频写入、配额/迁移/内存、多端协同、线上可观测 | 🔧 本文追加（10-11） |

> 升级路径：先完成 M1-M6（骨架 + 测试 + 迁移），再按需插入 M7/M8。M7/M8 追加式依赖 M1-M6 已有接口，**不重构骨架**。

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
| `10-m7-reliability.md` | 超级应用可靠性（分片/性能/配额/迁移/生命周期/敏感数据） | M1, M2, M3, M6 |
| `11-m8-sync-observability.md` | 超级应用协同 + 可观测（sync/快照/埋点/类型/AI 规范） | M6, M7 |

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

### 超级应用加固（追加，可选按需）

```
M7 ── 超级应用可靠性                                  (10)
  M7.1 状态分片 + 按需 hydrate
  M7.2 持久化性能（防抖 / 分层 / 高频合并）
  M7.3 存储配额 + eviction 策略
  M7.4 状态版本迁移（migrations）
  M7.5 store 生命周期 + dispose
  M7.6 字段级敏感标记（volatile / encrypted）
M8 ── 协同 + 可观测                                   (11)
  M8.1 多端 sync engine（LWW + CRDT）
  M8.2 快照 + 时间旅行（收回 M6 的「不做」）
  M8.3 状态变更埋点 + 远程复现
  M8.4 类型注册表 + AI 协作规范 + CI 门禁
```

**依赖关系**：M1 → M2 → M3 → {M4, M5} → M6 → {M7 → M8}

> M7/M8 为追加里程碑；只做企业级可只走 M1-M6，超级应用再插入 M7/M8，无需回头改骨架。

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
- ⚠️ 时间旅行：M6 基线**不内置**；由 M8.2（`@proteus/pinia-devtools` 快照/时间旅行）按需提供，仅开发/调试 + 灰度复现包启用，生产默认关闭
- ❌ 不做跨 store 事务（保持 Pinia 原子性）
- ❌ 不修改 Pinia 内部源码（全部走插件 / 适配器）
- ❌ M8.1 sync engine 不作为核心依赖（可选子包 `@proteus/pinia-sync`）

---

## 7. 验收标准（Done Definition）

- [ ] 同一份 `stores/player.ts` 在四端运行，行为一致
- [ ] 持久化配置一处声明，四端生效（自动选对应 Storage）
- [ ] SSR 压测 1000 QPS 无跨请求状态污染
- [ ] 单元测试覆盖率 ≥ 80%（`stores/` + `shared/`）
- [ ] `--trace-storage` 可打印每次持久化读写（对齐 `--trace-transform`）
- [ ] 迁移文档：原生 Pinia 项目 ≤ 10 行改动即可接入 Proteus

### 超级应用追加验收（M7 + M8 完成后）

- [ ] 千级 store 冷启动 hydrate < 100ms（仅 eager）
- [ ] 高频写入（1000 次/秒）实际落盘 ≤ 3 次/秒
- [ ] 存储满时 protected key 保留、淘汰可观测
- [ ] 跨版本迁移链自动执行、失败不崩溃
- [ ] 页面级 store dispose 后内存回归基线
- [ ] 敏感字段不在明文存储中出现
- [ ] 三端（web + mp + app）购物车并发操作最终一致（LWW / CRDT）
- [ ] capture → restore 完整还原，时间旅行按步撤销
- [ ] 线上 trace 上报（采样、节流、敏感字段剔除）可用
- [ ] `useStore('typo')` 编译期报错
- [ ] CI 门禁拦截 `stores/` 下任意平台分支代码

---## 下一步
→ 按顺序阅读 `01-storage-adapter.md` 起，每个模块独立实现、独立测试、独立 PR。
