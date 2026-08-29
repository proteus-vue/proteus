# 迁移指南 — 存量项目平滑升级

> **里程碑**：M6（B7）
> **目标**：现有 examples 的 `<route>` 块**零改动**，删除手写路由配置，全量切到自动扫描
> **LLM 批次**：B7

---

## 1. 迁移前现状（假设）

```
examples/
├── src/pages/
│   ├── home/Home.vue        ← 已有 <route> 块 ✅
│   ├── user/User.vue        ← 已有 <route> 块 ✅
│   └── ...
├── app.json                 ← 手写 pages + tabBar（要被生成替代）
├── main.web.ts              ← 手写 vue-router routes
└── proteus.config.ts
```

## 2. 迁移步骤（≤ 改动 N 个文件，pages 零改动）

### Step 1：确认 `<route>` 块合规（M1 Schema）

跑校验器：
```bash
proteus router:check
```
- 报错项按 `文件:行号` 修正（缺 path、name 重复等）
- **页面 `.vue` 文件本身不改**

### Step 2：删除手写 `routes`（Web）

`before`：
```ts
// main.web.ts
const routes = [
  { path: '/home', component: () => import('./pages/home/Home.vue') },
  // ... 手维护
]
const router = createRouter({ routes })
```

`after`：
```ts
import { routes } from '../.proteus/routes.generated'
const router = createWebRouter({ routes, history: createWebHistory() })
```

### Step 3：让 `app.json` 由生成接管（mp）

- 删除手写 `pages` 字段（改由 `generateMpConfig` 生成）
- 保留非路由字段（`window`、`styleIsolation` 全局等）
- 合并策略：生成字段优先，用户字段保留（`mergeAppJson`）

### Step 4：声明 `router` 配置（可选）

`proteus.config.ts` 新增：
```ts
export default defineConfig({
  router: {
    defaults: { meta: { transition: 'slide' } },
    tabBar: { list: [...] },     // 从原 app.json.tabBar 搬过来
    guards: { beforeEach: (to, from, next) => {...} },
  }
})
```

### Step 5：验证

```bash
pnpm build --trace-router
# 检查输出：每个 <route> → 三端产物映射
pnpm test
```

## 3. 兼容期策略（推荐）

- **过渡期**：允许 `<route>` 与手写 `app.json.pages` 并存，手写字段作为 fallback
- 校验器提示："建议迁移"而非报错
- 稳定后（1-2 个小版本）→ 收紧为：`<route>` 是唯一真相源，手写 pages 报错

## 4. 常见问题

| 问题 | 解决 |
|------|------|
| 页面无 `<route>` 块 | 加 `<route>`；或配置 `router.include: ['**/*.vue']` 自动生成 path（按文件路径推断）|
| 手写了复杂 `children` | 改用 `parent` 或 path 推导；极端嵌套保留 `router.routes` 手动追加 |
| 转场不生效 | `--trace-router` 看 transition 映射；确认 `meta.transition` 枚举值 |
| 守卫里取不到 store | 确认 Pinia M1-M2 已完成 + app 端 store 绑定正确 |

## 5. 迁移检查清单

- [ ] 所有页面 `<route>` 块通过 Schema 校验
- [ ] `main.web.ts` 改用 `routes.generated`
- [ ] `app.json.pages` 由生成产出，手写字段保留
- [ ] `tabBar` 搬到 `proteus.config.ts`
- [ ] 守卫 `beforeEach` 可注入 Pinia store
- [ ] `--trace-router` 产物可追溯
- [ ] 现有 examples 运行结果与迁移前一致（回归测试）

---

## LLM 执行提示（B7）

> 读 `00-overview.md` + `01-06` + `07` + 本文件。迁移指南是**给用户的文档**，LLM 实现的是配套的 `router:check` CLI + 合并逻辑 + 兼容期开关。
