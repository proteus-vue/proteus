# M8 — 协同 + 可观测

> 依赖：M7（可靠性，尤其 M7.4 迁移、M7.6 加密）、M6（DevTools / trace）
> 目标：让 Proteus × Pinia 在「多端状态协同 + 线上异常复现 + 千人千机调试」下可追、可回放、可收敛
> 范围：多端 sync engine、快照/时间旅行、状态变更埋点、类型注册表、AI 协作规范

---

## M8.1 多端状态协同（可选 sync engine）

### 问题
超级应用要"一处改、处处同步"：购物车、登录态、播放进度（手机改 → 桌面端即时更新）。

### 设计（可选模块 `@proteus-vue/pinia-sync`，不强制核心依赖）
```ts
import { createSyncEngine } from '@proteus-vue/pinia-sync'

const sync = createSyncEngine({
  pinia,
  transport: websocketTransport,  // 用户自备：ws / socket.io / 自研长连
  stores: ['cart', 'player'],     // 参与协同的 store
  strategy: 'crgt',               // 'lww'(默认 last-write-win) | 'crgt'(Yjs)
})
```

### 两种策略
| 策略 | 适用 | 实现 |
|------|------|------|
| **LWW**（last-write-win） | 登录态、设置项等无冲突字段 | 每条变更带 `{value, timestamp, clientId}`，取最新 |
| **CRDT**（Yjs / Automerge） | 协同编辑、草稿、多人操作 | 字段用 `Y.Map`/`Y.Array`，自动合并无冲突 |

### 行为
1. **oplog**：每次 mutation 生成 op → 本地立即应用 + 入队待发
2. **广播**：transport 发送 op 到其他端
3. **应用**：接收远端 op → 转换 → apply（CRDT 自动合并，LWW 按时间戳）
4. **离线缓冲**：断线时 op 本地持久化（M7.3 存储），重连后重放
5. **冲突解决**：LWW 时间戳相同 → clientId 字典序兜底；CRDT 无冲突

### 边界 case
- encrypted 字段（M7.6）不参与协同（密文无法合并）→ sync 自动跳过并告警
- 协同 store 必须声明 `sync: true`，默认不参与（避免误同步隐私数据）
- 首次连接：服务端下发全量快照，客户端 diff 后对齐

### 编译期映射（`--trace-transform`）
```
defineStore(id, setup, { sync: true })
  → runtime: 注册到 syncEngine.trackedStores
  → mutation → op → transport.send
```

### 测试
- L4：两浏览器 + 小程序三端，购物车并发增减 → 最终一致
- L1：断线 30s 后重连 → 离线 op 全部重放、无丢失

---

## M8.2 快照 / 时间旅行（收回 M6 的"不做"）

### 问题
超级应用状态错乱（播放列表乱序、金额计算偏差），没有快照/回放根本查不动。

### 设计
```ts
import { createSnapshotManager } from '@proteus-vue/pinia-devtools'

const snapshot = createSnapshotManager({ pinia })

snapshot.take('beforePay')           // 手动打点
const snap = snapshot.capture()       // 全量快照序列化
snapshot.restore(snap)                // 回滚到某刻
snapshot.timeTravel(-3)               // 回退 3 步 mutation
```

### 行为
1. **capture**：遍历所有 store state → 序列化（复用 M1 的 Date/Map/Set/BigInt tag）→ 返回快照对象
2. **restore**：清空当前 state → 按快照逐 store hydrate
3. **timeTravel**：维护 mutation 历史栈（生产环境默认关闭，仅开发/调试模式），按步撤销/重放
4. **序列化**：同 M7.4（type tag 往返）

### 开发 vs 生产
- 开发：`take`/`restore`/`timeTravel` 全开
- 生产：默认禁用，通过 `enableSnapshotInProd: true`（仅内部灰度/复现包）开启

### `--trace-transform`
```
[snapshot] capture 12 stores → 3.2KB
[snapshot] restore @beforePay 完成
```

### 测试
- L1：capture → mutate → restore → state 等于快照
- L3：大 state（10MB 模拟）→ capture < 50ms

---

## M8.3 状态变更埋点 + 远程复现

### 问题
千人千机，线上状态异常没法复现。需要可上报的变更轨迹。

### 设计
```ts
pinia.use(createStateTracer({
  onTrace: (event) => {
    // event: { store, mutation, payload, timestamp, stateDiff }
    reporter.report('pinia:trace', event)
  },
  filter: ['cart', 'order'],   // 只追踪关键 store，避免噪音
  sample: 0.1,                 // 线上采样率 10%
}))
```

### 行为
1. **拦截 mutation**（`pinia._p` 插件机制），构造 `StateTraceEvent`
2. **stateDiff**：计算变更前后差异（结构化克隆 + diff），只上报 changed paths（如 `cart.items[2].qty`）
3. **上报**：节流 + 批量，接入用户已有埋点 SDK
4. **远程复现包**：后端按 userId + timestamp 拉取 trace → 前端 DevTools 导入 → 还原现场

### 隐私
- volatile/encrypted 字段（M7.6）自动从 trace 中剔除
- filter 默认空（不上报），显式声明才追踪

### `--trace-transform`
```
[trace] store=cart mutation=addItem payload={id:1} diff=cart.items[+1]
[trace] 上报批量 (3 events) → reporter
```

### 测试
- L1：mutation 触发 onTrace，diff 正确、敏感字段被剔除
- L4：采样率 0.1 → 1000 次 mutation 实际上报 ≈ 100

---

## M8.4 类型注册表 + AI 协作规范

### 问题
千级 store 靠字符串 id（`useStore('user')`）拼错无声失败；AI 批量改 store 容易写出平台分支污染 `stores/`。

### 设计 A：全局类型注册表
```ts
// stores/registry.ts
export interface StoresRegistry {
  user: ReturnType<typeof useUserStore>
  cart: ReturnType<typeof useCartStore>
  player: ReturnType<typeof usePlayerStore>
  // ... 新增 store 在此追加
}

// 组合函数里类型安全
export function useStore<K extends keyof StoresRegistry>(id: K): StoresRegistry[K] {
  return getActivePinia()._s.get(id) as any
}

// 使用：自动补全 + 类型检查
const user = useStore('user')  // ✅ 补全 'user' | 'cart' | 'player'
const x = useStore('usr')      // ❌ 编译错误
```

### 设计 B：AI 协作规范（`stores/CONVENTIONS.md`，CI 硬卡口）
```
## 铁律（AI 必须遵守）
1. stores/ 下禁止出现平台判断：process.env / wx\. / window\. / plus\. / my\.
2. 新增 store → 必须同时在 registry.ts 追加类型
3. 持久化配置只能写在 defineStore 第 3 参数，不得运行时动态
4. 跨平台差异 → 收敛到 shared/ 或 platforms/*/pinia.ts
5. 不得直接调用 storage adapter，一律走 persist 配置

## 禁写清单（CI grep 拦截）
- `wx\.setStorage|localStorage\.setItem|sessionStorage`  ← stores/ 下禁止
- `if.*process\.env`                                    ← stores/ 下禁止

## transform 审计钩子
- 每条 store 改动 → CI 跑 `--trace-transform --store=<id>` → diff 产物
- AI PR 必须附带 trace 输出，证明无平台分支泄漏
```

### CI 门禁
```yaml
# .github/workflows/stores-gate.yml
- name: stores 铁律检查
  run: |
    grep -rE "wx\.|window\.|process\.env|my\." src/stores/ && exit 1 || true
    pnpm trace-transform --all --assert-no-platform-branch
```

### 边界 case
- 动态 store id（如 `draft:page1`）→ registry 用 `Record<string, DraftStore>` + 类型断言，静态 id 仍走字面量类型

### 测试
- L4：CI 在 PR 中注入 `wx.setStorageSync` → 门禁拦截并报错
- L1：`useStore('typo')` 编译失败

---

## M8 分批执行（追加到 09-execution-batches）

| Batch | 内容 | 依赖 | 产物 |
|-------|------|------|------|
| B8.1 | sync engine（LWW + CRDT 适配） | M7.4, M7.6 | `packages/pinia-sync/` |
| B8.2 | 快照 + 时间旅行 | M7.4 | `runtime/devtools/snapshot.ts` |
| B8.3 | 状态埋点 + 远程复现 | M7.6 | `runtime/tracer.ts` |
| B8.4 | 类型注册表 + AI 规范 + CI 门禁 | M6 | `stores/registry.ts` + `CONVENTIONS.md` + CI workflow |

每批一个 PR，喂 LLM 上下文 = `overview + 本模块 + 直接依赖（M7）`，不超 3 文件。

---

## 验收标准（M8 完成）
- [ ] 三端（web + mp + app）购物车并发操作最终一致
- [ ] capture → restore 完整还原，时间旅行按步撤销
- [ ] 线上 trace 上报（采样、节流、敏感字段剔除）可用
- [ ] 远程 trace 导入 DevTools 可复现现场
- [ ] `useStore('typo')` 编译期报错
- [ ] CI 门禁拦截 `stores/` 下任意平台分支代码
- [ ] AI 按 CONVENTIONS.md 改 store → trace 无平台泄漏

---

## 与整体文档的关系
- M7 加固「**单机可靠性**」：分片、性能、配额、迁移、生命周期、敏感数据
- M8 加固「**多端 + 工程化**」：协同、回放、可观测、类型安全、AI 协作
- 两者都依赖 M1-M6 已有骨架，**追加式插入，不重构**
- 分批策略沿用 `09-execution-batches.md`：每批 ≤ 3 文件喂 LLM，独立 PR 合并
