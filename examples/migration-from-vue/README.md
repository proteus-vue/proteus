# examples/migration-from-vue —— 原生 Vue + Pinia → Proteus 迁移示例（diff 对照）

> 本目录是**文档式对照示例**（不参与构建）：展示原生 Vue 项目接入 Proteus 多端持久化的逐行 diff。
> 完整指南见 `docs/pinia-migration.md`。

## Before：原生 Vue 3 + Pinia + pinia-plugin-persistedstate（Web only）

```ts
// stores/user.ts
import { defineStore } from 'pinia'
import { persistedstatePlugin } from 'pinia-plugin-persistedstate'

export const useUserStore = defineStore('user', {
  state: () => ({ token: '', profile: null }),
  persist: { key: 'user', storage: localStorage }, // ← Web only，小程序/SSR 会炸
})

// main.ts
import { createPinia } from 'pinia'
const pinia = createPinia()
pinia.use(persistedstatePlugin) // ← 社区插件
app.use(pinia)
```

## After：Proteus 多端（diff = 2 个文件）

```diff
 // stores/user.ts（0 行改动——兼容层兜底）
 export const useUserStore = defineStore('user', {
   state: () => ({ token: '', profile: null }),
-  persist: { key: 'user', storage: localStorage }, // ← 删 storage 字段（可选；不删也能跑）
+  persist: { key: 'user' },                         // storage 由平台工厂自动注入
 })

-// main.ts
-import { createPinia } from 'pinia'
-import { persistedstatePlugin } from 'pinia-plugin-persistedstate'
-const pinia = createPinia()
-pinia.use(persistedstatePlugin)
-app.use(pinia)
+// main.web.ts（替换）
+import { createWebPinia } from '@proteus/runtime'
+app.use(createWebPinia())

+// main.mp.ts（新增）
+import { createMpPinia } from '@proteus/runtime'
+createMpPinia()
```

**改动统计**：main.ts 替换 1 行 + 新增 main.mp.ts 3 行；store **0 行**（或按场景 B 每 store 1 行换自研 `persistence: persisted()`）。

## 迁移后验证

```sh
npm test                    # 含 cross-platform 矩阵（web/mp/ssr 同一组用例）
npm run build:web           # Web 端 Vue DevTools 可查 store
PROTEUS_DEBUG=1 npm run build:mp   # 小程序端 [pinia] trace + __PROTEUS_STORES__() 快照
```
