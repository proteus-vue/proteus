# M4 — 状态快照与时间旅行

> **★实现状态（2026-08-31）**：**数据层已落地**——`@proteus-vue/devtools-runtime` 新增 `createStateSnapshotter`（export 收集非 volatile store + redact 敏感键 + route/meta；import 校验 version + 按 id 还原；recordPatch 记录 before/after + 环形缓冲 1000；timeTravel(i) 各 store 取 steps[0..i] 最后一条 after 回放）+ `serializeState/deserializeState`（Date/Map/Set/BigInt type tag 还原 + 循环引用标记降级），11 用例全绿；Pinia 适配插件（$patch 拦截）与 UI（快照列表/滑块）待面板工程（v1.0+）。

## 目标

对接 Pinia M8.2：导出/导入完整 state，并按 `$patch` 序列做时间旅行。

## 快照格式

```ts
interface StateSnapshot {
  version: 1
  takenAt: number
  stores: Array<{
    id: string                     // 'user', 'cart' ...
    state: Record<string, unknown> // 序列化后
  }>
  route?: { path: string; query: Record<string, unknown> }
  meta?: { userAgent: string; platform: Platform }
}
```

序列化走 Pinia M8.2 的带 type tag 方案（Date/Map/Set/BigInt 可还原），对齐 `persisted` 持久化层。

## API

```ts
const devtools = createDevTools({ /* ... */ })

devtools.snapshot.export()        // → StateSnapshot
devtools.snapshot.import(snap)    // 还原所有 store
devtools.snapshot.timeTravel(index) // 回放到第 index 个 patch
```

## 时间旅行原理

- Pinia 安装 devtools 插件，拦截每次 `$patch` / mutation，记录 `{ storeId, type, payload, before, after }`
- 保留环形缓冲（默认 1000 步）
- `timeTravel(i)`：从初始快照重放 `patches[0..i]`，用 `store.$patch()` 批量应用

## UI 交互

- **快照列表**：时间 + 触发来源（手动 / 路由变化 / 请求完成）
- **导出 .json**：下载文件，可邮件/IM 发给协作方复现 bug
- **导入**：校验 `version` + stores schema，不兼容提示 migration
- **滑块**：拖动回放 patch 序列，组件高亮差异

## 安全

- 导入前 redact（同 M1 脱敏规则）；敏感 store（标记 `volatile`）不参与导出
- 序列化循环引用检测，避免栈溢出

## 验收

- 导出 → 刷新 → 导入，UI 状态完全一致（快照 diff 为空）
- 1000 步 time travel 回放 < 1s
- 含 Date/Map/Set 的 store 可正确还原
