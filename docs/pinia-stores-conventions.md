# stores/ 协作规范（AI 必读，CI 硬卡口）

> 来源：docs/proteus-pinia-plan 11-m8-sync-observability.md §M8.4（B8.4 落地）
> 适用范围：`stores/` 目录（业务 store 源码）+ 任何修改 store 的 PR

## 铁律（AI 必须遵守）

1. **stores/ 下禁止平台判断**：`process.env` / `wx.` / `window.` / `plus.` / `my.` / `typeof window` 一律不得出现（平台差异收敛到 `@proteus/runtime` 工厂与 `@proteus/shared` storage）
2. **新增 store → 必须同时在 `stores/registry.ts` 追加类型**（否则 `useStore()` 类型注册表漏项，CI 门禁拦截）
3. **持久化配置只能写在 `defineStore` 第 3 参数**（`persistence: persisted({...})` / `persist: {...}`），不得运行时动态拼接
4. **跨平台差异 → 收敛到 shared/ 或平台工厂**，不在 store 里写分支
5. **不得直接调用 storage adapter**（`localStorage.setItem` 等），一律走 persist 配置（平台自动选后端）

## 禁写清单（CI grep 拦截）

| 模式 | 说明 |
|------|------|
| `wx\.setStorage` / `localStorage\.setItem` / `sessionStorage` | stores/ 下禁止直连存储 |
| `if.*process\.env` | stores/ 下禁止环境分支 |
| `window\.` / `typeof window` | stores/ 下禁止浏览器假设 |
| `getPlatform\(` | stores/ 下禁止平台分支（仅供框架层使用） |

## 持久化配置速查

```ts
export const useUserStore = defineStore('user', () => {...}, {
  persistence: persisted({
    pick: ['token'],           // 只持久化指定字段
    keys: ['token'],           // hydrate 只恢复指定字段（M7.1 分片）
    eager: false,              // 惰性 hydrate：store.$hydrate()（M7.1）
    volatile: ['phone'],       // 不落盘（M7.6）
    encrypted: ['token'],      // 加密存储（M7.6）
    version: 2,                // schema 版本迁移（M7.4）
    migrations: [...],
    scope: 'page',             // 页面级，onUnload 自动 dispose（M7.5）
  }),
})
```

## 变更审计（--trace）

- 任何 store 改动跑 `npm test`（含 `stores-purity` 平台纯净性校验 + `stores-registry` 类型校验）
- AI 批量改 store 后：跑 `npm test` 确认 stores-purity 全绿（证明无平台分支泄漏）

## 新增 store 流程（Checklist）

```
1. stores/<name>.ts        —— 纯 store（无平台分支，defineStore 第 3 参数写持久化）
2. stores/registry.ts      —— 追加类型（StoresRegistry 接口）
3. tests/stores-*.test.ts  —— 纯逻辑测试（原生 createPinia，不依赖平台）
4. npm test                —— stores-purity（平台纯净性）全绿
```
