# 路线图与验收标准（Website v3）

> `proteus-website-v3/` 附属文档 5/6 · 配套：G-30（路线图协同）+ `proteus-roadmap/`
> 本文定义官网 v3 的分批落地节奏 + 与框架 M1/M2/M3 的对应关系 + 最终验收标准。

---

## 0. 与框架路线图的关系

官网不是「框架做完后再补的文档站」，而是**与框架同步演进的可执行资产**：

| 框架里程碑 | 官网对应产出 | 关系 |
|-----------|------------|------|
| **M1（地基）** | Website v3 重构总纲 + 首页骨架 + Playground 原型 | 官网**定义**方法论，框架**实现**方法论 |
| **M1.5（语义原语 G-31/32）** | `/primitives` 128 原语目录（自动生成） | 原语定义 = 文档来源（单一事实源） |
| **M2（能力跑通）** | Playground 四维度切换 + conformance 可视化 | 框架能力**可被演示** = 官网内容 |
| **M3（生态完整）** | `/compare` `/migrate` + Showcase + i18n | 转化与运营 |

**关键**：M1 阶段官网就要能跑——因为 dogfooding（D-1~D-4）要求官网是「第一个 Proteus App」，它的存在本身就在验证框架 API 是否可用。

---

## 1. 分批落地

### Phase 0 · 设计冻结（1-2 周）

**目标**：信息架构与设计系统定稿，不动代码。

| 任务 | 产出 | DoD |
|------|------|-----|
| 信息架构评审 | `/docs` `/primitives` `/backends` `/playground` `/compare` `/migrate` 路由表 | 团队共识 + 与 G-31/32 对齐 |
| 设计系统（语义 token） | 色板 / 字体 / 间距 / 暗色模式 token | token 可直接被 `<p-*>` 消费 |
| 首页 Hero + Mini Playground 高保真原型 | Figma | 四维度控件可点击原型 |

### Phase 1 · 骨架 + Dogfooding（M1，2-4 周）★ 最高优先级

**目标**：官网用 Proteus 自身跑起来（D-1~D-4 达标）。

| 任务 | 产出 | DoD |
|------|------|-----|
| `proteus/website` monorepo 初始化 | app.config.ts + backend.config.ts（VueDom） | `proteus dev` 可启动 |
| 迁移官网现有内容到 `<p-*>` 原语 | 全部页面源码 | AST 扫描：0 处 `<view class>` 残留 |
| 首页 Hero + Mini Playground | 四维度控件 + 降级提示 | 首屏可见，LCP < 2.5s |
| lint 规则（D-2） | `.proteus/website-lint.yaml` | pre-commit + CI 均拦截 |
| 「View Source」功能 | 每页源码展开 | 可点击看官网真实源码 |

### Phase 2 · Playground + 原语目录（M1.5-M2，4-8 周）

| 任务 | 产出 | DoD |
|------|------|-----|
| 完整 Playground（四区域 + 分屏 + IR 面板） | `/playground` | 切换 Render/Compiler/Device/Capability 均可用 |
| WebContainers 集成（Compiler Node + WASM） | 真跑编译 | Rust→WASM 编译 < 3s |
| `/primitives` 128 页自动生成 | 构建脚本 + 5 区块骨架 | 从 component-ir.schema.json 生成，0 手写 |
| conformance 报告接入 | CI → JSON → 静态页 | 数据自动更新，人工不可篡改 |

### Phase 3 · 对标 + 迁移 + 生态（M2-M3，4-6 周）

| 任务 | 产出 | DoD |
|------|------|-----|
| `/compare` 对标页 | 主表 + Lynx 专区 + 覆盖率证明 | 每条论点可点证据 |
| `/migrate` 迁移中心 | 能力扫描器 + codemod + 案例 | 三步流程可完整跑通小程序项目 |
| Showcase（含官网自身） | 案例页 | ≥ 3 个完整案例 |
| i18n 中英双语 | 双语内容 | 架构层语义天然利于翻译 |

---

## 2. 最终验收标准（对应总纲 §7，扩展为 15 条）

### 2.1 结构正确性（总纲 §7 #1-10）

| # | 标准 | 验证 |
|---|------|------|
| 1 | 首页加载 < 2.5s（LCP） | Web Vitals + CI Lighthouse |
| 2 | 首页内嵌 Mini Playground，四维度控件齐全 | 手动 + e2e 测试 |
| 3 | ≥ 3 维度可在浏览器真跑 | VueDom / Compiler / Device |
| 4 | 非真跑项全部标 `RECORDED ON DEVICE` + conformance 链接 | lint 校验 |
| 5 | Tier 降级有明确 UI 提示 | e2e（切 Car 端） |
| 6 | 七特性叙事线每站有内联 Demo | 页面快照对比 |
| 7 | 每个语义原语页含 5 区块（语义/剖面/降级/对照/demo） | AST 扫描 128 页 |
| 8 | 每个原语页有多后端实现剖面 | 同上 |
| 9 | conformance 报告从 CI 自动生成 | CI 产物校验 |
| 10 | `/migrate` 三步流程可完整跑通 | 用真实小程序项目演练 |

### 2.2 dogfooding 硬指标（本文档 §1 D-1~D-4）

| # | 标准 | 验证 |
|---|------|------|
| 11 | 官网是合法 Proteus App，`proteus dev` 可启动 | CI `proteus dev --dry-run` |
| 12 | 零 `<view class>` / div + CSS 布局残留 | AST 扫描 = 0 |
| 13 | 声明使用 VueDomBackend，可切换预览 | backend.config.ts + e2e |
| 14 | 跑与业务项目相同的 conformance test，结果公开 | CI 报告比对 |

### 2.3 说服力指标（转化相关）

| # | 标准 | 验证 |
|---|------|------|
| 15 | `/compare` 每条 ✅ 都有可点击证据 | CI 校验链接有效性 |

---

## 3. Definition of Done（全局）

**一个里程碑算完成，当且仅当**：

1. ✅ 对应 plan 的 conformance test 全绿
2. ✅ 官网文档已更新（单一事实源同步）
3. ✅ Playground 有对应可交互 Demo
4. ✅ `/compare` 对应行已填证据链接
5. ✅ CI 全绿（含 website lint + conformance）

---

*本文是 `01-website-rearchitecture.md` 的附属规范，分批与 M1/M2/M3 对齐 `proteus-roadmap/`。*
*Architecture: `@proteus/architecture` · Status: v2 (2026-09-02)*
