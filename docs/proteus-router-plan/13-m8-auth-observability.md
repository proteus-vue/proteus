# M8 — 路由超级应用加固：权限、可观测、调试

> 依赖：M6（guards）、M7（chunk/栈）、Pinia M2（store 可读）
> 目标：让路由层在「复杂权限 + 线上异常」下可治理、可复现、可审计

---

## M8.1 权限树 + 路由级声明

### 问题
超级应用权限矩阵庞大：角色（游客/普通/会员/管理员）× 业务域（trade/user/content）× 操作（read/write/manage）。守卫里写一堆 `if (role === 'admin' && ...)` 不可维护。

### 设计：权限树（Permission Tree）

`proteus.config.ts` 声明全局权限树：

```ts
export default defineConfig({
  router: {
    permissions: {
      // 权限标识 = 业务域:操作
      'trade:read': ['guest', 'user', 'vip', 'admin'],
      'trade:write': ['user', 'vip', 'admin'],
      'trade:refund': ['admin'],
      'content:publish': ['vip', 'admin'],
    }
  }
})
```

`<route>` 块直接声明所需权限：

```vue
<route>
  name: 'order-refund'
  path: '/order/:id/refund'
  meta:
    requiresAuth: true
    permissions: ['trade:refund']   # ← 要求具备此权限
    redirect: '/403'                # 无权限时跳转
</route>
```

### 守卫自动读取权限树（M6 升级）

```ts
// guards/permission.ts（CLI 生成 + 开发者可扩展）
router.beforeEach((to) => {
  const required = to.meta.permissions as string[]
  if (!required?.length) return true

  const userStore = useUserStore()   # 读 Pinia（依赖 Pinia M2）
  const userPerms = userStore.permissions   # string[]

  const hasAll = required.every(p => userPerms.includes(p))
  if (!hasAll) {
    return to.meta.redirect || '/403'
  }
})
```

**关键**：权限树是**单一真相源**，守卫逻辑自动生成，开发者不在守卫里手写角色判断——**避免散落各处的 `if (role === ...)`**。

### 权限继承
嵌套路由子页面自动继承父级权限：

```ts
# 父路由 meta.permissions = ['trade:write']
# 子路由未声明 → 继承 ['trade:write']
# 子路由声明 permissions: ['trade:refund'] → 覆盖（不合并）
```

M2 的 `metaMerge` 策略升级：权限字段用 `replace` 语义，其他 meta 用 `merge`。

### transform 契约

```
输入：<route> 的 permissions + config 的权限树
输出：guard 代码（自动生成）+ 权限校验表（manifest）
trace：
  guard:permission  route=order-refund  required=[trade:refund]  user=[trade:read]  result=redirect:/403
```

---

## M8.2 动态权限 + 运行时注册

### 问题
权限树写死在 config 里 → 后端新增角色/权限需发版。超级应用需要**运行时拉取权限配置**。

### 设计：权限源可插拔

```ts
export default defineConfig({
  router: {
    permissions: {
      source: 'remote',   # 'static' | 'remote'
      fetch: async () => {
        # 从后端拉取当前用户的权限列表
        const res = await fetch('/api/permissions')
        return res.json()   # { permissions: ['trade:refund', ...] }
      },
      fallback: 'static'   # 拉取失败时回退到静态树
    }
  }
})
```

### 时序
```
App 启动
  → Pinia 初始化 userStore
  → 路由守卫注册（此时权限树可能是空的）
  → userStore.fetchUser() 触发 permissions.fetch()
  → 权限树填充完成
  → 后续导航守卫正常校验
```

**竞态保护**：权限未加载完成时，所有需权限路由**暂存**到队列，加载完成后重放。避免首屏白屏。

### trace 输出
```
guard:permission-source  type=remote  status=loading
guard:permission-source  status=ready  perms=12
guard:permission  route=order-refund  result=allow
```

---

## M8.3 路由可观测性（trace + 上报）

### 问题
千人千机，线上「导航异常 / 白屏 / 转场卡顿」无法复现。M6 的 `--trace-transform` 是**构建期**，这里要**运行期 trace**。

### 设计：RouterTracer

```ts
// runtime/router-tracer.ts
class RouterTracer {
  private logs: RouteTrace[] = []

  record(event: RouteTrace) {
    this.logs.push(event)
    if (import.meta.env.DEV) {
      console.debug('[router]', event)
    }
    # 生产环境：上报到监控平台（采样率 1%）
    if (Math.random() < 0.01) this.flush()
  }

  flush() {
    # 上报 this.logs（脱敏后）
  }
}
```

### 采集的事件

| 事件 | 字段 | 用途 |
|------|------|------|
| `route:enter` | name, path, from, chunk, depth | 页面 PV / 栈深度监控 |
| `route:leave` | name, duration | 页面停留时长 |
| `guard:result` | route, guard, result, redirect | 权限拦截率 |
| `transition:start` | type, duration, platform | 转场性能基线 |
| `transition:end` | type, actualDuration, fps | **掉帧检测** |
| `chunk:load` | name, size, duration | 分包加载耗时 |
| `stack:overflow` | depth, action | 栈溢出告警 |
| `error:not-found` | path | 404 监控 |

### 敏感字段脱敏
trace 自动剔除：`path` 中的 query 参数（可能含 token/手机号）、`meta` 中的敏感标记。

```ts
# 脱敏规则（可配置）
sanitize(path: string) {
  return path.replace(/token=[^&]+/, 'token=***')
             .replace(/phone=[^&]+/, 'phone=***')
}
```

### 远程复现包
线上异常时，收集最近 20 条 trace + 当前路由快照 + 设备信息，生成可导入 DevTools 的 JSON：

```json
{
  "trace": [...],
  "currentRoute": { "name": "order-detail", "params": {...} },
  "stack": ["home", "order-list", "order-detail"],
  "platform": "skyline",
  "userAgent": "..."
}
```

开发者本地导入后，**DevTools 可一键复现当时的导航栈 + 转场过程**（对应 Pinia M8.2 快照能力）。

---

## M8.4 路由调试器（DevTools 集成）

### 设计：可视化路由树 + 实时操作

DevTools Panel（开发/灰度环境）：

```
┌─────────────────────────────────────────┐
│  Route Tree                              │
│  ├─ tab-home (root)                     │
│  ├─ order-list [trade]                  │
│  │  └─ order-detail [trade] (lazy)      │
│  └─ user-center (root)                  │
│                                         │
│  Current Stack: [home → order-list]     │
│                                         │
│  [Force Navigate] [Pop To Root] [Reset] │
└─────────────────────────────────────────┘
```

### 功能
- **路由树可视化**：展示嵌套关系、chunk 归属、懒加载状态
- **当前栈操作**：`popTo`、`reset`、`replace` 一键触发（对应 M7.5）
- **转场录制**：记录最近 N 次转场，可逐帧回放（FPS 曲线 + 动画曲线）
- **权限模拟**：临时切换角色，观察守卫行为变化（对应 M8.1/M8.2）
- **chunk 加载瀑布图**：哪些 chunk 预加载了、耗时多少

### trace 桥接
DevTools 通过 `window.__PROTEUS_ROUTER__` 访问 tracer：

```ts
window.__PROTEUS_ROUTER__ = {
  getTree(): RouteNode,
  getStack(): string[],
  trace: RouterTracer,
  forceNavigate(name: string, params?: any),
}
```

**生产环境**：`__PROTEUS_ROUTER__` 不暴露（通过 `import.meta.env.PROD` 剔除）。

---

## M8.5 路由级错误边界（Error Boundary）

### 问题
页面组件渲染异常 → 整个导航失败。超级应用需要**路由级兜底**。

### 设计：`<RouteErrorBoundary>`

`<route>` 块声明错误页：

```vue
<route>
  name: 'order-detail'
  path: '/order/:id'
  meta:
    errorBoundary: 'OrderError'   # 指定错误组件
    fallback: '/error/500'        # 兜底跳转
</route>
```

运行时捕获：

```ts
# 三端统一：路由组件渲染异常 → 触发错误边界
try {
  await route.component()   # 懒加载 + 渲染
} catch (err) {
  const boundary = route.meta.errorBoundary
  if (boundary) {
    # 渲染 OrderError 组件，传入 err
  } else {
    router.replace(route.meta.fallback || '/error/500')
  }
}
```

### trace
```
error:boundary  route=order-detail  boundary=OrderError  error=TypeError:...
```

---

## M8.6 CI 路由审计（对应 Pinia M8.4 grep 门禁）

### 问题
超级应用多人协作，有人写了「绕过守卫」「硬编码跳转」「权限字符串拼错」的代码 → 线上事故。

### 设计：CI 静态检查

`proteus audit`（CLI 命令，CI 集成）：

```bash
$ proteus audit route
✓ 所有 <route> 块 schema 合法
✓ 无硬编码 wx.navigateTo / location.href
✓ permissions 均在权限树中注册
✓ 无循环重定向（A → B → C → A）
✓ 所有 chunk 页面数 ≤ 30
✓ 主包页面数 ≤ 30
✓ tabBar 页均在 root chunk
✗ [error] pages/order/Refund.vue: permissions=['trade:refund'] 未注册
```

### 检查规则清单

| 规则 | 严重级 | 说明 |
|------|--------|------|
| `no-hardcoded-navigation` | error | 禁止 `wx.navigateTo`、`location.href`、直接 `wx.switchTab` |
| `permissions-declared` | error | `<route>` 的 permissions 必须在权限树注册 |
| `no-redirect-loop` | error | 检测重定向循环 |
| `chunk-size-limit` | warn | 单 chunk 页面数 > 30 |
| `root-chunk-tabbar` | error | tabBar 页必须进 root chunk |
| `route-name-unique` | error | 路由 name 全局唯一 |
| `param-type-valid` | warn | `:id` 是否有类型声明（string/number） |
| `meta-serializable` | error | meta 字段必须可序列化（不能存函数） |

### grep 门禁（package.json）
```json
{
  "scripts": {
    "audit:route": "proteus audit route --strict",
    "precommit": "npm run audit:route && npm run lint"
  }
}
```

对应 Pinia M8.4 的 `stores/` 铁律——**路由层也用 CI 自动化守门，不靠人工 review**。

---

## M8 验收标准

| 指标 | 目标 |
|------|------|
| 权限校验覆盖率 | 100%（所有需权限路由均有声明） |
| 权限变更生效 | 不发版（远程拉取） |
| 转场掉帧率（<50fps） | < 1% |
| 路由 trace 上报成功率 | > 99% |
| 线上导航异常复现率 | > 90%（通过 trace 包） |
| CI 审计耗时（300 页） | < 10s |
| 硬编码导航违规 | 0（门禁阻断） |

---

## 执行批次（追加到 09）

```
B8.1 = M8.1 + M8.2（权限树 + 动态权限）  [依赖 M6 + Pinia M2]
B8.2 = M8.3（可观测性）                  [依赖 M7]
B8.3 = M8.4（DevTools）                  [依赖 B8.2]
B8.4 = M8.5（错误边界）                  [依赖 M3/M4/M5]
B8.5 = M8.6（CI 审计）                   [依赖全部]
```

**B8.1 优先**：权限树 + 自动守卫是超级应用最核心的治理需求，先落地静态权限 + 自动生成守卫代码，动态远程权限（M8.2）可作为 v2 迭代。
