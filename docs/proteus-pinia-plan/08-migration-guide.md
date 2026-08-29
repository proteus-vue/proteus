# 模块 08：迁移指南

> **里程碑**：M6（后半）
> **目标**：让已有 Vue + Pinia 项目（Web / uni-app / Taro）在 ≤ 10 行改动内接入 Proteus 多端持久化。

---

## 1. 迁移场景

| 来源 | 目标 | 改动量 |
|------|------|--------|
| Vue 3 + Pinia + pinia-plugin-persistedstate（Web） | Proteus Web + 小程序 | ~5 行 |
| uni-app Vue3（pinia 已在用） | Proteus（保留 pinia，换平台入口） | ~8 行 |
| Taro 3 + Redux / zustand | Proteus + Pinia | 较大（状态库迁移，非本指南重点） |

---

## 2. 场景 A：Web 项目迁移到 Proteus 多端

### Before（原项目）
```ts
// stores/user.ts
import { defineStore } from 'pinia'
import { persistedstatePlugin } from 'pinia-plugin-persistedstate'

export const useUserStore = defineStore('user', {
  state: () => ({ token: '' }),
  persist: {
    key: 'user',
    storage: localStorage,   // ← Web only
  },
})

// main.ts
const pinia = createPinia()
pinia.use(persistedstatePlugin)   // ← 社区插件
app.use(pinia)
```

### After（Proteus）
```ts
// stores/user.ts（改动 0 行 —— 完全不变）
// ✅ 如果你的 store 已经用 pinia-plugin-persistedstate，连 store 都不用改

// main.web.ts（新增 / 改写）
import { createWebPinia } from '@/platforms/web/pinia'
app.use(createWebPinia())   // ← 替换 createPinia()

// main.mp.ts（新增）
import { createMpPinia } from '@/platforms/mp/pinia'
mountMpApp({ pinia: createMpPinia() })
```

**改动统计**：
- `main.ts` → `main.web.ts`：1 行替换
- 新增 `main.mp.ts`：3 行
- `stores/`：**0 行改动**（社区插件兼容层兜底）

---

## 3. 场景 B：从社区插件迁移到 Proteus 自研轻量 API

如果你想要更轻的方案（可选，非必须）：

```ts
// stores/user.ts
import { defineStore } from 'pinia'
import { persisted } from '@proteus/persistence'   // ← 新增 import

export const useUserStore = defineStore('user', {
  state: () => ({ token: '', profile: null }),
  // 改动 1 行：persist → persistence: persisted()
  persistence: persisted({ pick: ['token'] }),
})
```

**改动统计**：每个 store **1 行**（`persist: {...}` → `persistence: persisted({...})`）。

---

## 4. 场景 C：uni-app 项目迁移

uni-app Vue3 已支持 Pinia（通过 `pinia` 包），迁移分两步：

### Step 1：替换 Pinia 创建方式
```ts
// 原 uni-app main.ts
import { createPinia } from 'pinia'
const pinia = createPinia()
app.use(pinia)

// 改为
import { createMpPinia } from '@proteus/platforms/mp/pinia'
app.use(createMpPinia())
```

### Step 2：持久化 storage 适配
```ts
// 原：storage: localStorage  ← uni-app 小程序端会报错
// 改为：不传 storage（Proteus 自动选 WxStorageAdapter）
persist: { key: 'user' }   // ← 删掉 storage 字段即可
```

**改动统计**：~8 行（替换入口 + 删除 storage 配置 + 调整文件结构）。

---

## 5. 迁移检查清单

- [ ] `package.json` 新增 `@proteus/persistence` 依赖
- [ ] `main.ts` 替换为 `platforms/*/pinia.ts` 工厂调用
- [ ] 所有 store 的 `persist.storage` 字段移除（改为平台注入）
- [ ] `pinia-plugin-persistedstate` 仍可保留（兼容层兜底），迁移完成后再决定是否换自研 API
- [ ] 运行 `pnpm test cross-platform` 确认四端行为一致
- [ ] Web 端 Vue DevTools 正常连接
- [ ] 小程序端 `--trace-storage` 验证持久化读写

---

## 6. 不兼容项（Breaking Changes）

| 场景 | 说明 | 解决方案 |
|------|------|---------|
| 直接使用 `pinia.state.value = xxx` | 官方 API，Proteus 不屏蔽，但 SSR 需按模块 05 顺序 | 遵循 hydration 顺序 |
| 自定义 Pinia 插件 | 需在平台工厂里 `pinia.use(yourPlugin)` | 在 `createXxxPinia()` 里注册 |
| 依赖 `window.localStorage` 直接访问 | 小程序 / SSR 会炸 | 改用 `createStorage()` |

---

## 7. 渐进式迁移策略

**不建议一次性全切**。推荐顺序：

```
1. 先接入 createWebPinia()（Web 端零风险，行为完全一致）
2. 跑通 examples/ 的 Web demo
3. 加 createMpPinia()，跑小程序 demo
4. 确认跨端矩阵测试全绿
5. （可选）逐步把 store 的 persist → persistence（自研 API）
6. 最后接入 SSR
```

每一步可独立提交、独立回滚。

---

## 验收
- 提供 `examples/migration-from-vue/` 示例：原版 Vue 项目 → Proteus 多端，diff 清晰可见
- 迁移文档让新手 ≤ 30 分钟完成接入
- 社区插件兼容层保证"不迁移也能跑"
