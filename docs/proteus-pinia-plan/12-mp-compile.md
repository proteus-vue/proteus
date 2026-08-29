# 12 · Pinia MP 编译接入（★后续批次规划）

> 背景：pinia-plan M1-M8 完成（持久化/工厂/SSR/协同）——Web 端 Pinia 原生可用；MP 端目前是 **store 桥过渡**（`createStore` + `connectPageStore` 订阅 → setData）。
> 本文规划 Pinia 在 MP 端的**编译接入**（module-plan B0 后跨模块引用机制已通，B0 边界跳过含第三方依赖共享模块）——让 `pinia-demo` MP 端真正可用。

## 1. 现状与三个缺口

| 缺口 | 现状 | 根因 |
|------|------|------|
| ① 共享模块放行 | `stores/player.ts` import pinia → B0 跳过（剥离 + 警告） | 含第三方裸依赖的共享模块树跳过编译（体积 906KB minify + 主包预算） |
| ② 模板绑定 | `{{ store.current.title }}` 读 `this.data.store` = undefined | `const store = usePlayerStore()` 编译为**实例属性**（runtimeInit，B0）——模板读 data |
| ③ 事件调用 | `@click="store.play(...)"` 复杂表达式 → 警告原样 | inline handler（Batch B）仅支持自增/自减/简单方法调用 |

## 2. 方案设计（三批，独立可测）

### P1：模板 store 绑定桥（编译期，工程量中高）

`{{ store.xxx }}` 模板引用 → 编译为 data 字段 + store 变更 → setData：

```
源码：{{ store.current.title }} / {{ store.volumePercent }}
产物：data.current/title/volumePercent（映射 store 字段展开）+ onLoad:
  this.__storeUnsub = connectPageStore(this, store, (s) => ({ current: s.current, volumePercent: s.volumePercent }))
```

- **template.ts**：收集 `{{ store.<field> }}` 与 `:prop="store.<field>"` 引用 → `storeBindings: string[]`（字段清单）
- **script.ts**：onLoad 注入 `connectPageStore`（runtime 已有——订阅 → setData，M1-M8 产物）；store 由 `usePlayerStore()` runtimeInit 提供
- **产物**：模板 `{{ store.current.title }}` → `{{ current.title }}`（store 前缀剥离，字段经 setData 同步）
- 嵌套字段：`store.current.title` → data.current.title（connectPageStore map 需返回深层结构——map 函数生成）

### P2：store 方法事件调用（编译期，工程量中）

`@click="store.play({...})"` → 包装方法：

```
源码：@click="store.toggle()"
产物：proteusStoreToggle() { this.data.store.toggle() }（bindtap 指向包装）
```

- **template.ts**：`store.<method>(...)` 事件表达式 → 收集 `storeHandlers: [{ name, method, args }]`
- **script.ts**：生成 `proteusStoreXxx()` 包装（`this.data.store.method(args)`——store 实例属性含 Pinia store 方法）

### P3：放行 + 体积（编译期 + 运行时，工程量中）

- **plugin**：pinia 进入共享模块白名单？——**不放行**（体积 906KB 超预算风险）；改 **stores 专用路径放行**（`stores/` 目录下的共享模块允许第三方依赖）+ **体积门禁**（bundle-report B7a 已有——超限阻断提示分包）
- 或：**分包放行**——pinia-demo 依赖的 stores 进分包（配合 B5 分包机制）
- **验收**：pinia-demo MP 端可运行（播放/暂停/音量按钮 + 状态显示）；主包体积监控达标

## 3. 依赖

- module-plan B0（跨模块引用机制 ✅）/ B7a（体积监控 ✅）
- pinia-plan M1-M8（store 桥 connectPageStore ✅，runtime/src/store.ts）
- 编译器 inline handler 机制（Batch B ✅ 基础上扩展 store 方法调用）

## 3.5 进度

- **P1 模板 store 绑定桥 ✅**（2026-08）：template.ts `rewriteStoreRefs`（`{{ store.<field> }}` → `{{ <field> }}` + storeBindings 收集，含 :prop 绑定）+ script.ts `storeBindingLine`（onLoad：初始 setData + `store.$subscribe` → setData，store 变量 = useXxxStore() runtimeInit 实例属性）；规则 script/store-binding；测试 tests/pinia-mp-compile.test.ts
- **P3 放行 ✅**（体积惊喜）：plugin 共享模块第三方白名单加 pinia/vue-demi/@vue/reactivity 等——`stores/player.js` **仅 29.2KB**（esbuild tree-shaking 生效，此前 906KB 估测为未 tree-shake 口径）；主包 45→83KB（预算 1200KB 内）；pinia-demo MP 端 `const { usePlayerStore } = require('../stores/player.js')` + 状态显示可用
- **P2 store 方法事件包装 ⬜**（下一步）：`@click="store.play(...)"` → proteusStoreXxx 包装（inline handler 扩展）

## 4. 验收标准

- [ ] pinia-demo MP 端：`{{ store.current.title }}` 显示实时状态（P1）
- [ ] `@click="store.toggle()"` 产物可运行（P2）
- [ ] stores 编译产物 + 主包体积在预算内（P3）
- [ ] 全量测试全绿 + 双端构建
