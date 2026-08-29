# M7 — 超级应用可靠性

> 依赖：M1（Storage 抽象层）、M2（持久化层：pinia-plugin-persistedstate 兼容 + 自研 persisted）
> 目标：让 Proteus × Pinia 在「千级 store / 长期运行 / 高频写入 / 小程序存储配额」下不崩、不卡、不丢数据
> 范围：状态分片、按需 hydrate、持久化性能、配额淘汰、版本迁移、生命周期、字段级敏感标记

---

## M7.1 状态分片 + 按需 hydrate

### 问题
千级 store 全量 hydrate → 冷启动秒级卡顿。播放器 store（常驻）和用户信息 store（首屏必需）和订单历史 store（按需）生命周期完全不同，不能一刀切。

### 设计
```ts
// stores/player.ts
export const usePlayerStore = defineStore('player', () => {
  const currentTrack = ref<Track | null>(null)
  const progress = ref(0)
  // ...
  return { currentTrack, progress }
}, {
  persisted: {
    // 关键：控制条常驻，App 启动即 hydrate
    eager: true,
    keys: ['currentTrack'],  // 只恢复关键字段，progress 不恢复
  },
})

// stores/order-history.ts
export const useOrderHistoryStore = defineStore('orderHistory', () => {
  // ...
  return { ... }
}, {
  persisted: {
    // 进入订单页时才 hydrate + 注册持久化
    eager: false,
    lazy: true,
  },
})
```

### 契约
- `eager: true`（默认）→ App 启动 `pinia.stateHydrate()` 时恢复
- `lazy: true` → 首次 `useStore()` 时触发该 store 的 hydrate（异步，await 可选）
- `keys?: string[]` → 只 hydrate 指定字段，其余保持初始值（减少反序列化量）

### 编译期 / 运行时映射（`--trace-transform` 可见）
```
defineStore(id, setup, { persisted: { eager:false } })
  → runtime: 注册为 lazyStoreRegistry[id]
  → 首次 useStore(id) → ensureHydrated(id) → resolve 后再返回 store
```

### 边界 case
- lazy store hydrate 完成前，组件读到初始值 → 必须暴露 `store.$hydrated: Ref<boolean>`，组件自行处理 loading
- 同 store 并发 useStore → hydrate 只触发一次（promise 缓存）
- eager store hydrate 失败 → 不阻塞 lazy store，单 store 告警

### 测试
- L1 单测：lazy store 首次 useStore 前后 `$hydrated` 变化
- L3 跨端：小程序冷启动 eager store 数量 vs 首屏耗时曲线（< 100ms 阈值）

---

## M7.2 持久化性能：防抖 + 分层 + 高频合并

### 问题
每次 action 都 `setItem` → Skyline 下 `wx.setStorageSync` 同步写会掉帧（音乐进度条 seek 高频、输入草稿实时存）。

### 设计
```ts
interface PersistSchedulerOptions {
  debounce?: number        // 默认 100ms，所有平台统一 async
  maxWait?: number         // 默认 1000ms，超时强制 flush
  highFrequencyKeys?: string[]  // 如 ['player/progress']，走 requestAnimationFrame 合并
}
```

### 行为
1. **内存缓冲 + 防抖**：action 触发 state 变更 → 写入内存镜像 → 调度器 debounce 后批量 `flush()`
2. **高频 key**：`player/progress` 这类每帧变的 → 合并到一帧一次写，丢弃中间值只留最新
3. **maxWait**：防抖期间持续变更 → 超 1s 强制落盘，避免崩溃丢数据
4. **flush 串行**：同一 adapter 的 flush 队列串行，避免竞态覆盖

### 平台差异（Storage 抽象层已统一 async，此处只调节奏）
| 平台 | 写时机 |
|------|--------|
| web | `localStorage.setItem` async 包装，debounce 100ms |
| mp-wechat | `wx.setStorage`（异步）debounce；避免 sync 版本 |
| app | native bridge async，同 web |
| ssr | 内存 store，不落盘 |

### `--trace-transform` / trace 输出
```
[persist] store=player key=progress高频 → raf合并 → flush @16ms
[persist] store=user 防抖 100ms → flush (keys: [profile, token])
[persist] store=order maxWait 1000ms 强制 flush
```

### 测试
- L1：连续 1000 次 `progress++` → 实际 `setItem` 调用 ≤ 3 次
- L3：小程序真机 seek 拖动 → 无掉帧（Performance 面板 frame 稳定）

---

## M7.3 存储配额与 eviction 策略

### 问题
小程序 storage 有大小上限（通常 10MB 级别），长期运行爆了就丢数据。

### 设计
```ts
interface QuotaOptions {
  warnAt?: number        // 默认 0.8（80%）
  strategy?: 'lru' | 'lfu' | 'protected'  // 默认 'protected'
  protectedKeys?: string[]  // 永不淘汰：['user/token','player/currentTrack']
}
```

### 行为
1. **配额感知**：每次 flush 后 adapter 估算已用字节（`JSON.stringify` 长度），超阈值触发淘汰
2. **protected 策略（默认）**：只淘汰「非 protected 且最久未访问」的 key；protected key 满了 → 抛 `QuotaExceededError`，由业务决定是否清历史
3. **LRU/LFU**：按访问时间戳/计数排序淘汰
4. **溢出告警**：`pinia.onQuotaWarning((used, max) => ...)`，上报埋点

### 边界 case
- 单次写入单 key 超限（如大 JSON）→ 直接抛错，不走淘汰（避免误删其他数据）
- 淘汰时触发 `store.$onEvict(key)`，store 可自行清理内存镜像

### 测试
- L1：mock adapter 限 1KB，写入超阈值 → 触发淘汰，protected key 保留
- L4：小程序开发者工具「清除存储」后重建，无白屏

---

## M7.4 状态版本迁移（migrations）

### 问题
超级应用迭代快，store schema 改版后用户本地旧数据必须能升级，否则白屏/崩溃。

### 设计
```ts
export const useUserStore = defineStore('user', () => {
  // ...
  return { ... }
}, {
  persisted: {
    version: 3,
    migrations: [
      { from: 1, to: 2, up: (state: any) => { state.name = state.userName; delete state.userName } },
      { from: 2, to: 3, up: (state: any) => { state.vip = false; return state } },
    ],
  },
})
```

### 行为
1. 读取持久化数据时比对 `version`
2. 逐条执行 `from → to` 迁移链（支持跨多版本，如 1→3 = 1→2→3）
3. 迁移后按最新 schema 正常 hydrate
4. 迁移失败 → 丢弃该 store 数据，走初始值 + 告警（不崩溃）

### 序列化：Date/Map/Set/BigInt 带 type tag 往返（M1 已有，此处复用）
```json
{ "__type": "Map", "value": [["k","v"]] }
```

### `--trace-transform`
```
[persist] store=user 持久化 version=3
[persist] store=user 迁移 1→2→3 完成
```

### 测试
- L1：构造 v1 旧数据 → hydrate → 断言结构等于 v3 schema
- L4：升级包前后数据兼容性矩阵（v1..vN × 当前版本）

---

## M7.5 store 生命周期 + dispose

### 问题
页面级 store 在 MPA 小程序里不主动销毁 → 内存只涨不跌。

### 设计
```ts
// 页面级 store：绑定路由
export const usePageDraftStore = defineStore('draft:page1', () => {
  // ...
  return { ... }
}, {
  scope: 'page',  // 'app'(默认) | 'page'
})
```

### 行为
1. `scope: 'page'` → 注册到 `pageStoreRegistry`
2. `mountMpApp` 在页面 `onUnload` 时自动 `$dispose()` 该页所有 page-scoped store
3. `$dispose()`：清空 state、停止持久化调度、解绑订阅、弱引用待 GC
4. `scope: 'app'`（默认）：跟随 App 生命周期，手动 `pinia.dispose()`

### 边界 case
- 页面栈多实例（A→B→A）→ 用 `scope: 'page'` + pageId 区分，dispose 只清当前页
- store 被跨页引用 → 引用计数，归零才 dispose

### 测试
- L1：`$dispose()` 后 state 重置、订阅清空
- L3：小程序页面反复进出 100 次 → 内存平稳（DevTools heap 无持续增长）

---

## M7.6 字段级敏感标记（volatile / encrypted）

### 问题
手机号、token、身份证不能进 localStorage（合规要求）；部分字段无需持久化。

### 设计
```ts
export const useUserStore = defineStore('user', () => {
  const token = ref('')          // 敏感：加密存储
  const phone = ref('')          // 敏感：不落盘
  const nickname = ref('')       // 普通：明文持久化

  return { token, phone, nickname }
}, {
  persisted: {
    volatile: ['phone'],          // 内存保留，不落盘
    encrypted: ['token'],         // 走 secureStorage adapter
  },
})
```

### 行为
1. `volatile`：hydrate/persist 时跳过，state 内存中仍有效（会话级）
2. `encrypted`：写入前 `encrypt(value)`、读取后 `decrypt(value)`，使用平台安全存储：
   - web：`crypto.subtle` + IndexedDB（localStorage 不存明文）
   - mp-wechat：`wx.setStorageSync` + 自定义加密 key（或后端下发）
   - app：系统 Keychain / KeyStore
3. 序列化 tag：`{ "__type": "Encrypted", "value": "base64..." }`

### 边界 case
- encrypted key 失效（卸载重装）→ 降级为初始值 + 触发重新登录
- volatile 字段在 SSR hydration 时必为初始值（不序列化）

### 测试
- L1：持久化后 localStorage 不含 phone；token 为密文
- L4：合规扫描脚本（grep `volatile/encrypted` 声明完整性）

---

## M7 分批执行（追加到 09-execution-batches）

| Batch | 内容 | 依赖 | 产物 |
|-------|------|------|------|
| B7.1 | 状态分片（eager/lazy/keys） | M2 | `runtime/persist/sharding.ts` |
| B7.2 | 调度器（debounce/raf/maxWait） | M2 | `runtime/persist/scheduler.ts` |
| B7.3 | 配额 + 淘汰 | M1, M2 | `runtime/persist/quota.ts` |
| B7.4 | 版本迁移 | M2 | `runtime/persist/migrate.ts` |
| B7.5 | 生命周期 dispose | M3 | `runtime/scope.ts` |
| B7.6 | volatile / encrypted | M1 | `runtime/persist/secure.ts` |

每批一个 PR，喂 LLM 上下文 = `overview + 本模块 + 直接依赖（M1/M2）`，不超 3 文件。

---

## 验收标准（M7 完成）
- [ ] 千级 store 冷启动 hydrate < 100ms（仅 eager）
- [ ] 高频写入（1000 次/秒）实际落盘 ≤ 3 次/秒
- [ ] 存储满时 protected key 保留、淘汰可观测
- [ ] 跨版本迁移链自动执行、失败不崩溃
- [ ] 页面级 store dispose 后内存回归基线
- [ ] 敏感字段不在明文存储中出现
