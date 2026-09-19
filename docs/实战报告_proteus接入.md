# 用 proteus 重写创作台前端 · 实战报告

> 目的：拿真实项目验证 proteus 作为**跨端框架**的可用性。
> 结论先行：**架构可用，发布链路有 3 处会绊住外部用户**。

---

## 一、结论速览

| 项 | 结果 |
|---|---|
| 工具链能否跑通 | ✅ 需 1 处工程侧桥接（见下） |
| 应用层写法 | ✅ 标准 Vue 3 SFC，无侵入、无私有 DSL |
| 路由 | ✅ 按目录约定自动生成，懒加载自动生效 |
| dev proxy 接后端 | ✅ 正常（vite 透传配置可用） |
| 生产构建 | ✅ 每页独立 chunk |
| 组件跨端约定 | ✅ 必须放 `components/<kebab-name>/index.vue` |
| **路由参数传值** | ⚠️ **Web 端拿不到**（见问题 4） |

---

## 二、三处会让外部用户绊住的落差

### 1. CLI 依赖了未发布的包导出（**阻断级**）

`@proteus-vue/cli@0.3.0-beta.2` 顶层 import：

```js
import { createTraceBus, createFlamegraphCollector, createTimelineCollector }
  from "@proteus-vue/devtools-runtime";
```

而 npm 上的 `@proteus-vue/devtools-runtime@0.1.0` **只导出 3 个符号**，
缺 8 个（`createFlamegraphCollector` / `createTimelineCollector` /
`createStoreTracer` / `createRouteBacktracker` / `createErrorDiagnoser` /
`createStateSnapshotter` / `serializeState` / `deserializeState`）。
本地源码版有这些导出 → **包没重新发布**。

后果：CLI 一启动就 `SyntaxError`，任何外部用户都装不起来。
临时绕过：降到 `@proteus-vue/cli@0.2.1-beta.0`。

### 2. CLI 不组装 vite 配置（**阻断级**）

`cli@0.2.1-beta.0` 的 `dev/build --target` 只是 `spawn('vite')`，
不带 proteus 配置 → vite 读不到 `@vitejs/plugin-vue`，`.vue` 无法解析。

本地源码版 `packages/cli/src/build.ts` 里有：

```ts
const resolved = await resolveProteusViteConfig({ root, command, mode }, config)
```

`configFile: false`（不读 vite.config.ts，CLI 是唯一驱动）。
**这段能力在 npm 版缺失。**

临时绕过：工程侧写 `vite.config.ts` 调 `resolveProteusViteConfig()`。
（该函数在 npm 包的 dist 里**存在**，只是 CLI 没调它。）

### 3. CLI 不生成路由表

`gen-routes` 同为 CLI 职责，npm 版未触发。
后果：`auto-routes.ts` 恒为空 → 所有页面 404。
临时绕过：工程侧跑 `runGenRoutes({ config, root })`。

> 2 与 3 实际上是一个问题的两面：**编排逻辑（vite 配置组装 + 路由生成）
> 没有随包发布。**已发布的 CLI 更像"编译命令包装器"。

---

## 三、框架设计层面的两个发现

### 4. 路由参数在 Web 端拿不到（**易踩**）

proteus 是**小程序语义**——参数本该走 `onLoad(options)`。
但：

- `packages/runtime/src/pageLifecycle.ts`：
  「Web 端为 no-op 兼容（回调不执行，参数在 RouterView/路由层处理，MVP 不注入）」
- `examples/router/RouterView.vue`：`<component :is="view" />` —— **不传 props**

于是 Web 端**两条路都拿不到参数**：`onLoad` 不执行、props 没传。
实测表现：写作页显示"第 0 章"。

本项目绕过：把当前章号放 pinia store（跨端一致）。
**建议**：Web 端 RouterView 至少把 query 透传为 props，或实现 `onLoad` 注入。

### 5. 组件必须放 `components/<kebab-name>/index.vue`

`gen-routes` 会扫页面里用到的组件并生成 `component.json`，
但它按**固定路径约定**查找（`components/<kebab>/index.vue` 或 `<kebab>.vue`）。
放别处会打 warning 且不生成声明——小程序端会找不到组件。
（约定本身合理，但错误提示只说"未找到"，没说"该放哪"，可更友好。）

---

## 四、用得顺手的地方

- **标准 Vue SFC**：整份前端零私有语法，现有 Vue 经验直接迁移
- **路由自动生成 + 自动懒加载**：构建产物按页分 chunk，**一行配置没写**
- **vite 配置透传**：`vite.server.proxy` 直接接上后端，开发期同源免跨域
- **`__MP__` 平台宏**：同一份源码里写平台差异，不清不脏
- **设计令牌 SSOT**：MCP 的 `get_design_token` 直接给出合法值，业务不硬编码

---

## 五、验证记录

| 项 | 命令 | 结果 |
|---|---|---|
| 构建 | `vite build --mode web` | 61 模块 → 5 chunk，3.3s |
| dev + 代理 | `vite --mode web --port 5273` | `/api/projects` 返回 3 个项目 |
| 页面渲染 | 浏览器实测 | 作品列表 / 工作台 16 幕 / 写作页 2516 字 |
| 路由跳转 | 点"写作" | `/pages/editor`，正确载入第 41 章 |

---

## 六、给 proteus 的建议（按优先级）

1. **重发 `devtools-runtime`**（0.1.0 的 dist 与源码不符）——否则 CLI 不可用
2. **把编排逻辑打进 CLI**（vite 配置组装 + gen-routes），或提供
   `create-proteus` 模板里带上 `vite.config.ts` 桥接
3. **Web 端补路由参数注入**（onLoad 或 props 任一条）
4. 组件查找失败的报错里**带上"应放哪"**

---

## 七、proteus 侧处理回执（2026-09-19）

> 本报告的三条阻断项已全部处理，两条设计发现也已完成核实与修复。

| 报告条目 | 处理结果 |
|---|---|
| 1. CLI 依赖未发布导出（阻断） | ✅ **已修**——发布链路根因修复（`publish-all.sh` 的「已存在版本即跳过」无法区分幂等重跑与「改了没 bump」，已改为 integrity 内容校验 + 新增 `check-publish-drift` 门禁）；36 包重新发布后干净目录实测：**CLI 启动 exit 0**，devtools-runtime 原缺失的 8 个导出全部到位 |
| 2. CLI 不组装 vite 配置（阻断） | ✅ **已修**——本地模板早已是 CLI 驱动新形态（`proteus build --target web`，不再手写 `vite.config.ts` / `scripts/gen-routes.ts`），已随本次发布上线 |
| 3. CLI 不生成路由表 | ✅ **已修**——根因 `needsGenRoutes: isMp` 让 Web 目标跳过 gen-routes，而 `auto-routes.ts` 是双端共用产物；现 web 目标以 `webOnly` 模式更新路由表（**不产 MP 专属产物、不清理 dist/mp-weixin**）。端到端实测：新增页面 → `build:web` → 路由表收录 + MP 产物完好；回归锁 ×2（含破坏性验证） |
| 4. 路由参数 Web 端拿不到（易踩） | ✅ **已修**（双路补齐）——① adapter 当前页保留 `query`（对齐 MP `Page.options`，`getCurrentPages()[0].query` 可读）；② `RouterView` 把 query `v-bind` 给页面（页面 `defineProps` 即收到）。回归锁 ×3（含破坏性验证） |
| 5. 组件查找报错不友好 | ⬜ **待办**——已记录，将在后续批次改进报错文案（补「应放 `components/<kebab-name>/index.vue`」指引） |

**报告作者的判断很准确**，特别是第 2、3 条的归纳——「编排逻辑没有随包发布，已发布的 CLI 更像编译命令包装器」正是问题本质：
编排能力早已在源码中，但 npm 上的旧版本没有它，而发布机制又让新版本发不出去（第 1 条）。三者是同一条链路上的因果。

感谢这份基于真实项目的报告——它直接推动了发布链路的内容校验门禁（此前无任何机制能发现「同版本号、内容不同」），
以及 Web 目标路由表的修复（本仓 showcase 也踩过同一坑，此前只能手工绕过）。
