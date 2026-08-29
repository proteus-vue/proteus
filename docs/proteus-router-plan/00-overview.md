# Proteus Router — 路由管理透明化 LLM 落地执行文档

> **版本**：v1（对应 Proteus 核心框架 v2.47 路由现状）
> **状态**：规划冻结，可执行（B1 起每批一个 PR）
> **配套**：`proteus-pinia-plan/`（Pinia 多端适配），本计划与其共享 `platforms/*/`、`shared/`、`transforms/` 架构

---

## 0. 一句话定位

**让路由配置"就近声明 + 自动收敛 + 产物可审计"：开发者在页面 `<route>{...}</route>` 块里写页面级 meta，CLI 扫描全量标签 → 生成统一的路由表 + 各端原生导航配置（`vue-router` / Skyline `pages.json` / App 栈式导航），全程无隐式行为，`--trace-router` 可追。

对齐框架总原则：**编译层零黑盒，平台差异显式暴露，transforms AI 可读可改。**

---

## 1. 现状（起点，不改动即可运行）

- 每个页面 `.vue` 内含 `<route>` 自定义块，当前形态（示例）：
  ```vue
  <!-- src/pages/home/Home.vue -->
  <route>
  {
    "path": "/home",
    "name": "home",
    "meta": { "title": "首页", "needLogin": true, "transition": "slideUp" }
  }
  </route>

  <template><view>...</view></template>
  ```
- 现状问题（= 本次要解决的）：
  1. `<route>` 标签分散在各页面，无统一校验，**拼错字段无声失败**
  2. 没有自动扫描 → `pages.json` / `vue-router` 配置需**手写或靠旧脚本**，与 `<route>` 易漂移
  3. 嵌套路由（tab + 二级页）`<route>` 里表达不清，`children` 归属靠约定
  4. 转场 `transition` 写在 `<route>` 里，但 Skyline 端需映射到 `pages.json` 的 `routeType` + `app.json` 预设，**两端映射规则不可见**
  5. App 端（Custom Renderer）无路由抽象，页面栈语义与小程序不同

---

## 2. 目标架构（终点）

### 2.1 三端路由模型统一抽象

```
┌────────────────────────────────────────────────────┐
│  <route> 块（源码层 · 就近声明 · 唯一真相源）         │
├────────────────────────────────────────────────────┤
│  @proteus/router 编译器                             │
│   - scanRoutes()     扫描全部 <route>               │
│   - validateSchema() 校验字段（Zod / 手写）          │
│   - resolveNested()  按 path 构建嵌套树 children    │
│   - mergeMeta()       页面 meta + 全局 meta 合并     │
├──────────────┬──────────────┬──────────────────────┤
│  Web 后端     │  小程序后端   │  App 后端             │
│  vue-router  │  pages.json  │  StackNavigator      │
│  createRouter│  + routeType │  + native transitions│
└──────────────┴──────────────┴──────────────────────┘
```

### 2.2 配置收敛策略：**自动扫描 + 声明合并**

- **页面级**：`<route>` 块 → 页面自身 path / meta / transition
- **全局级**：`proteus.config.ts` 的 `router` 字段 → 路由守卫、全局 meta 默认值、tabBar、嵌套 layout
- **合并规则**：页面 `<route>` 优先于全局默认；全局 `router.guards` / `router.tabBar` 唯一来源
- **产物**：编译期生成 `dist/.proteus/routes.generated.ts`（Web）/`pages.json`（mp）/`navigation.json`（app）

---

## 3. 设计原则（铁律，CI 卡口）

1. **`<route>` 是唯一真相源**：任何端配置不得被手改后反向覆盖 `<route>`
2. **零隐式字段**：`<route>` 里没写的字段，产物里也不出现（除非全局 `router.defaults` 显式声明）
3. **可追踪**：`proteus build --trace-router` 输出 `文件:行号 → 字段 → 产物位置` 映射
4. **嵌套由 path 推导**：`/user` + `/user/profile` 自动构成父子，**不强制写 `children`**，但允许显式 `parent` 覆盖
5. **meta 扁平可序列化**：meta 只允许 JSON 可序列化值（函数/正则报错），守卫逻辑走 `router.guards` 不进 meta
6. **`pages/` 零平台代码**：路由差异只在 `platforms/{web,mp,app}/router.ts`

---

## 4. 里程碑（M1-M6）

| 里程碑 | 内容 | 依赖 | 验收 |
|--------|------|------|------|
| **M1** | `<route>` 块解析 + Schema 校验 | — | 扫描全部页面，错误定位到行号 |
| **M2** | 路由表构建（嵌套树 + meta 合并） | M1 | `routes.generated.ts` 可审计 |
| **M3** | Web 后端（vue-router 代码生成） | M2 | SPA 路由正常 + 守卫生效 |
| **M4** | 小程序后端（`pages.json` + routeType） | M2 | Skyline 页面 + 转场正确 |
| **M5** | App 后端（StackNavigator 抽象） | M2 | Custom Renderer 页面栈可用 |
| **M6** | 路由守卫 + tabBar + lazy + 测试 | M3-M5 | 四层测试 + 跨端矩阵 |

### 超级应用加固（追加，不重构 M1-M6）

| 里程碑 | 内容 | 依赖 | 验收 |
|--------|------|------|------|
| **M7** | 规模（分块/预加载/构建）+ 性能（转场/栈） | M1-M6 | 300 页首屏 <1.5s；Skyline 转场 ≥58fps |
| **M8** | 权限树 + 可观测 + DevTools + CI 审计 | M6 + Pinia M2 | 权限覆盖率 100%；CI 违规 0 |

> 详见 `12-m7-scale-lazy-animations.md`、`13-m8-auth-observability.md`；执行批次见 `09` 的 B8-B12。

---

## 5. 目录结构（新增/改动）

```
proteus/
├── packages/router/                    ← 新增：路由核心包
│   ├── src/
│   │   ├── scan.ts                     # M1 扫描 <route> 块
│   │   ├── schema.ts                   # M1 Zod schema
│   │   ├── tree.ts                     # M2 嵌套树构建
│   │   ├── merge.ts                    # M2 meta 合并
│   │   ├── codegen/
│   │   │   ├── web.ts                  # M3 → vue-router
│   │   │   ├── mp.ts                   # M4 → pages.json
│   │   │   └── app.ts                  # M5 → navigation.json
│   │   ├── guards.ts                   # M6 守卫抽象
│   │   └── index.ts
│   └── transforms/                     # 每条规则一个文件（AI 可读）
│       ├── transform-route-block.ts
│       ├── transform-nested-children.ts
│       └── transform-transition.ts
├── packages/vite-plugin-proteus/
│   └── src/router-plugin.ts            # 集成 scan + codegen 到 Vite
├── examples/
│   └── src/pages/                      # 现有 <route> 块保留
└── proteus.config.ts                   # 新增 router 字段（见 06）
```

---

## 6. 详细模块索引（每个一份独立 .md，防上下文膨胀）

| 文件 | 内容 | 喂 LLM 时依赖 |
|------|------|---------------|
| `01-m1-route-parser.md` | `<route>` 块解析 + Schema + 错误定位 | — |
| `02-m2-route-tree.md` | 嵌套树 + path 推导 + meta 合并 | 01 |
| `03-m3-web-codegen.md` | vue-router 代码生成 | 02 |
| `04-m4-mp-codegen.md` | pages.json + routeType 映射 | 02 |
| `05-m5-app-codegen.md` | App StackNavigator 抽象 | 02 |
| `06-m6-guards-tabbar.md` | 守卫 + tabBar + lazy | 03-05 |
| `07-testing.md` | 四层测试 + 跨端矩阵 | 全部 |
| `08-migration.md` | 存量迁移（保留 `<route>` + 删手写配置） | 01 |
| `09-execution-batches.md` | 分批喂 LLM 策略 + Prompt 模板 | — |

---

## 7. 分批总览（防撑爆上下文）

```
B1 = 01 + scan.ts 骨架          (M1)
B2 = 01 完成 + 02               (M1+M2)
B3 = 03                         (M3 Web)
B4 = 04                         (M4 mp)
B5 = 05                         (M5 App)
B6 = 06                         (M6)
B7 = 07 + 08                    (测试 + 迁移)
```

每批 = 1 个独立 PR = LLM 单次吃 ≤ 3 个文件（overview 快速回顾 + 当前模块 + 直接依赖）。
**规则**：永远不全量塞 9 份；已完成的模块只引用产物类型，不重新解释。

---

## 8. 与 Pinia 计划的关系

- 共享 `platforms/*/`、`shared/`、`transforms/` 架构 → router 的 `codegen/` 沿用 pinia 的 `createXxxPinia()` 工厂模式
- 路由守卫 `router.beforeEach` 可注入 pinia store（如登录态）→ **M6 依赖 Pinia M1-M2 完成**
- 执行顺序建议：**先做 Pinia M1-M6，再做 Router（本计划）**，因守卫依赖 store

---

## 9. 验收标准（全部通过 = 完成）

- [ ] 任意页面改 `<route>` 的 `path` → 三端配置自动同步，无手改
- [ ] `--trace-router` 能从产物字段反查到源码 `文件:行号`
- [ ] 嵌套路由（tab + 二级页）`<route>` 用 `parent` 或 path 推导均可
- [ ] 转场 `transition: slideUp` 在 Skyline 映射为正确 `routeType`，Web 映射为 `<Transition>`
- [ ] App 端页面栈 push/pop 对应原生导航
- [ ] 路由守卫可读 pinia 登录态并拦截
- [ ] 现有 examples 的 `<route>` 块零改动迁移成功
- [ ] 单测 + 端矩阵全绿

详见各模块文档。
