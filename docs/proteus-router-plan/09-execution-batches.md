# 分批执行策略（防上下文撑爆）

> **原则**：LLM 一次只吃 `overview + 当前模块 + 直接依赖`，永远不全量塞 9 份。每份 `.md` = 一个独立上下文单元。

---

## 1. 分批总览

| 批次 | 文件（LLM 输入） | 依赖 | 产出 PR | 状态 |
|------|------------------|------|---------|------|
| **B1** | `00-overview` + `01-m1-route-parser` | — | `scan.ts` 骨架 + Schema | ✅（scan/schema/rules）|
| **B2** | `00-overview` + `01` + `02-m2-route-tree` | B1 | tree + merge + 扫描完成 | ✅（tree/merge + trace）|
| **B3** | `00-overview` + `02` + `03-m3-web-codegen` | B2 | Web codegen + 快照 | ✅（codegen/web）|
| **B4** | `00-overview` + `02` + `04-m4-mp-codegen` | B2 | mp codegen + app.json | ✅（codegen/mp + 合并）|
| **B5** | `00-overview` + `02` + `05-m5-app-codegen` | B2 | App codegen + 栈操作 | ⬜ 待 v0.6（NativeKV/渲染器同批）|
| **B6** | `00-overview` + `03/04/05` + `06-m6-guards-tabbar` | B1-B5 + Pinia M1-M2 | 守卫 + tabBar + redirect | ⬜ 待执行（守卫已部分存在，tabBar/redirect 规划）|
| **B7** | `00-overview` + `07-testing` + `08-migration` | B1-B6 | 测试套件 + 迁移工具 | ⬜ 待执行（router-codegen 等测试已先落地）|

**顺序依赖（企业级）**：B1 → B2 → (B3 ∥ B4 ∥ B5) → B6 → B7

**超级应用加固批次**（追加，追加式不重构）：

| 批次 | 文件（LLM 输入） | 依赖 | 产出 PR |
|------|------------------|------|---------|
| **B8** | `00-overview` + `12-m7-scale-lazy-animations` (M7.1/M7.6) | B1,B2 | chunk 分块 + 分包/懒加载 |
| **B9** | `00-overview` + `12` (M7.2/M7.3) | B8 | 预加载 + 层级降级 |
| **B10** | `00-overview` + `12` (M7.4/M7.5) + `05` | B3-B6 | 转场调度器 + 栈管理 |
| **B11** | `00-overview` + `13-m8-auth-observability` (M8.1/M8.2) | B6 + Pinia M2 | 权限树 + 动态权限 |
| **B12** | `00-overview` + `13` (M8.3-M8.6) | B8-B11 | trace + DevTools + CI 审计 |

**完整依赖图**：
```
B1 → B2 → (B3 ∥ B4 ∥ B5) → B6 → B7    [企业级：路由可用]
                        ↘ B8 → B9 → B10 → B11 → B12   [超级应用加固]
```
- B8 是 M7 地基（chunk manifest），必须先于 B9-B12
- B11 依赖 Pinia M2（权限读 store）
- B10、B12 超限时拆子任务（见下文预算）

**上下文预算（超级应用批次）**：

| 批次 | 输入 token 估算 | 输出 | 说明 |
|------|----------------|------|------|
| B8 | 18k | 25k | chunk 分块 + manifest + 三端 codegen 改造 |
| B9 | 15k | 18k | 预加载策略 + 层级降级 |
| B10 | 20k | 25k | ⚠️ 拆 B10a(调度)/B10b(栈) |
| B11 | 16k | 18k | 权限树 + 自动守卫生成 |
| B12 | 18k | 20k | ⚠️ 拆 B12a(trace/DevTools)/B12b(CI) |

单批 ≤ 30k tokens；超限按 B10/B12 拆子任务。

## 2. 上下文预算

| 批次 | 输入 token 估算 | 输出 token 估算 | 合计 | 安全边际 |
|------|-----------------|-----------------|------|----------|
| B1 | 8k | 10k | 18k | ✅ 充足 |
| B2 | 12k | 12k | 24k | ✅ |
| B3-B5 | 15k | 12k | 27k | ✅ |
| B6 | 20k | 15k | 35k | ⚠️ 拆 guard / tabBar 两个子任务 |
| B7 | 18k | 15k | 33k | ⚠️ 拆 test / migration 两个子任务 |

**超限时**：把单个 `.md` 再拆半（如 `06` 拆 `06a-guards` + `06b-tabbar`），永远保持单批 ≤ 30k tokens。

## 3. Prompt 模板（复用范式）

### B1 Prompt
```
你是 Proteus Router 项目的核心开发者。请只基于以下两份文档实现代码：
1. /data/workspace/proteus-router-plan/00-overview.md（架构总览）
2. /data/workspace/proteus-router-plan/01-m1-route-parser.md（本批规格）

【任务】实现 packages/router/src/scan.ts + schema.ts：
- 用 @vue/compiler-sfc 的 parse 提取 <route> 块
- Schema 校验（见 01 第4节表格）
- RouteBlock 类型（见 01 第3节）
- 错误含 loc（文件:行号）

【约束】
- 不写 codegen（那是 B3-B5）
- 测试用 fixtures/pages/*.vue
- 产物必须可复现（排序稳定）
- 遵循"透明编译"原则：所有映射可追踪

请输出完整代码 + 测试 + 简要说明。
```

### B3 Prompt（含直接依赖引用，不重述）
```
你是 Proteus Router 项目的核心开发者。请只基于以下三份文档实现：
1. 00-overview.md（架构总览）
2. 02-m2-route-tree.md（依赖：RouteNode[] 数据结构）
3. 03-m3-web-codegen.md（本批规格）

【任务】实现 packages/router/src/codegen/web.ts：
- 输入：RouteNode[]（已由 tree.ts 构建完成，直接用类型，不需重实现）
- 输出：vue-router RouteRecordRaw[] 的字符串（生成 .ts 文件）
- 映射规则见 03 第2、3节
- lazy → () => import()

【约束】
- mock RouteNode[] 输入，不接真实 scan
- 快照测试（toMatchFileSnapshot）
- transition 映射先只放 slideUp/slide，枚举扩展留口子

请输出完整代码 + 快照测试。
```

### B6 Prompt（最复杂，拆子任务）
```
【子任务 B6a：路由守卫】

只基于：00-overview.md + 03-m3-web-codegen.md + 06-m6-guards-tabbar.md（第2节）

【任务】实现守卫抽象：
- createRouter().beforeEach / afterEach（三端 API 一致）
- Web：delegate 到 vue-router.beforeEach
- mp：polyfill wx.beforeRouteChange（劫持 navigateTo 系列）
- App：NativeBridge.willPushScreen 拦截
- 守卫内可 useStore（Pinia，假设已就绪）

输出：guards.ts + 三端 delegate + 单测（mock store）
```

## 4. 执行节奏建议

- **1 批/天**：每批一个独立 PR，review 后再进下一批
- **先骨架后细节**：B1/B2 跑通 scan + tree 后再并行 B3-B5
- **测试先于集成**：每批先写 L1 单测，L2/L3 在 B7 统一补
- **`--trace-router` 贯穿始终**：每批实现都顺手加 trace 点，避免最后补

## 5. 进度追踪

```
[ ] B1 scan + schema
[ ] B2 tree + merge
[ ] B3 Web codegen
[ ] B4 mp codegen
[ ] B5 App codegen
[ ] B6a guards
[ ] B6b tabBar + redirect
[ ] B7a tests
[ ] B7b migration
```

## 6. 验收（全部完成 = 路由管理透明化达成）

- [ ] 任意页面改 `<route>` → 三端配置自动同步，无手改
- [ ] `--trace-router` 能反查到源码 `文件:行号`
- [ ] 嵌套路由（tab + 二级页）path 推导 / `parent` 均可
- [ ] transition 枚举三端映射一致（L4 矩阵全绿）
- [ ] App 页面栈 push/pop 对应原生导航
- [ ] 守卫可读 Pinia 登录态并拦截
- [ ] 现有 examples `<route>` 零改动迁移
- [ ] CI 全绿 + 快照 stable

---

## 一句话收

> 这份文档 = "路由管理透明化"的**可执行规格说明书**，不是设计稿。每份 `.md` 独立喂 LLM，每批一个 PR，`transforms/` 模块化 + `--trace-router` 可追踪，对齐 Proteus "AI-native 透明编译 + 自我成长" 的总定位。
