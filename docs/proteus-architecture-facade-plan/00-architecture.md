# Proteus Architecture（全局缝合规约）

> **本文件是 18 份落地文档的唯一顶层规约（Single Source of Truth）。**
> 任何层级的命名、scope、依赖方向、分批编号，均以本文件为准；各 plan 只允许引用、不得重定义。

---

## 0. 文档体系版本

- **框架对外名称**：Proteus
- **npm scope**：`@proteus-vue`（与 GitHub org `proteus-vue` 对齐，避开被占用的 `@proteus`）
- **文档版本**：v3.4（全局缝合 + 新 plan 追加）
- **规约文档数**：18 份原始 plan（G-01~G-20）+ 14 份新增 plan（G-21~G-34 追加）+ 本规约 + 1 份原则补充（design-principle）

---

## 1. 分层（L0 地基 → L5 门面）

```
L0 类型契约 : types            ← 所有层的依赖根，不得依赖任何业务层
L1 编译内核 : compiler
L2 运行时   : pinia / router / api / component / platform / lifecycle / module
L3 基建      : cli / testing / devtools / build
L4 横切      : security / i18n
L5 验证+门面 : blueprint / website / test-framework
```

**依赖方向铁律（单向，禁止回边）**：
- `L(n)` 只能依赖 `L(<n)`；同层之间**只允许通过 `contracts.ts` 通信**
- `types` 是纯类型层（`import type` only），**零运行时依赖**
- 业务层**禁止 import `types/internal/*`**，只消费 `@proteus-vue/types` 公开 API

---

## 2. 包名注册表（唯一，全量统一为 @proteus-vue）

> 18 份文档中所有包名 **已全量统一为 `@proteus-vue/*`**（共 120 处 token，v3.0 批量回填完成；校验：`grep -rE "@proteus/"` 零残留）。

### L0 类型契约
| 包名 | 职责 | 对应 plan |
|------|------|-----------|
| `@proteus-vue/types` | 全局类型 Registry + Zod schema + Platform 判别联合 | types |
| `@proteus-vue/contracts` | 跨层共享 DTO（`RouteRecord`/`StoreSnapshot`/`ApiResponse`/`CapabilityDescriptor`） | types §07 |

### L1 编译内核
| 包名 | 职责 |
|------|------|
| `@proteus-vue/compiler` | SFC parser → IR → 三端 codegen |
| `@proteus-vue/css-compat` | CSS 跨端兼容（G-21）：--strict-css 校验 CSS001-012 + 编译期重写 + css-compat-report（纯逻辑零运行时依赖） |
| `@proteus-vue/source-map` | 源码映射（DevTools 跳转用） |

### L2 运行时
| 包名 | 职责 |
|------|------|
| `@proteus-vue/pinia` | 全局状态 + 分片 + 持久化 |
| `@proteus-vue/router` | 路由 + 分包 + 守卫 |
| `@proteus-vue/api` | 请求/拦截/缓存/签名 |
| `@proteus-vue/components` | `p-*` 组件库（Web ↔ Skyline 映射） | component |
| `@proteus-vue/built-in-components` | 框架内置组件（微信内置组件为基准；Web 模拟/Skyline 原生/App v0.6，决策 #162 拆包） | component |
| `@proteus-vue/platform` | 平台判别 + 能力探测 + `PlatformAPI` |
| `@proteus-vue/lifecycle` | 应用/页面生命周期编排 |
| `@proteus-vue/module` | 模块化 + 依赖图 + 循环检测 |

### L3 基建
| 包名 | 职责 |
|------|------|
| `@proteus-vue/cli` | `proteus` 命令面 |
| `@proteus-vue/vite-plugin` | Build 唯一入口 |
| `@proteus-vue/devtools-runtime` | TraceBus + 六源采集 |
| `@proteus-vue/devtools-panel` | 调试 UI（时间轴/快照/火焰图） |
| `@proteus-vue/test-utils` | wx mock / createMockContext |

### L4 横切
| 包名 | 职责 |
|------|------|
| `@proteus-vue/security` | 加密存储/凭证/权限 |
| `@proteus-vue/i18n` | ICU 消息 + Loader + Audit |

### L5 验证 + 门面
| 包名 | 职责 |
|------|------|
| `@proteus-vue/blueprint` | Proteus Music 150 页验证应用 |
| `@proteus-vue/website` | 官网（dogfooding） |
| `@proteus-vue/test-framework` | 统一测试框架 |

### 第三方类型（**不重复造**，铁律 #6）
| 用途 | 包 | 说明 |
|------|-----|------|
| 小程序 API/构造器 | `miniprogram-api-typings` | `wx.*` / `App`/`Page`/`Component` → 命名空间 `WechatMiniprogram` |
| WXML 标签属性 | **Proteus 自建 schema** | 官方 d.ts 不管模板层，归 Compiler 的 `MpComponentSchema` |

---

## 3. 全局铁律（v3.0 = 9 条，全 18 份共享）

```
#1  单一事实源（全局 Registry）
#2  Platform 判别联合（无 any）
#3  端能力静态可分析
#4  渐进式适配
#5  源码即文档（Zod + 示例）
#6  第三方类型复用（miniprogram-api-typings，不重复造）
#7  向后兼容（major 版本化 + deprecation）
#8  分层锁定（import 方向单向，types 零运行时依赖）
#9  跨层一致性（同名必同义，契约先行 → contracts.ts）
```

任何 plan 新增约束**必须追加到本列表**，禁止在本地重新编号。

---

## 4. 全局分批编排（唯一执行序，杜绝跨 plan 批次号冲突）

> **批次命名空间隔离**：每份 plan 内部仍用 B1-Bn，但**全局执行序**由下表 `G-xx` 定义。LLM 执行时按 `G` 序号推进，同一 `G` 内的批次可并行。

| G 序 | 批次 | 依赖 | 产出（地基验证点） |
|------|------|------|-------------------|
| **G-01** | types B1-B3 | — | Registry + schema + Platform 判别联合 |
| **G-02** | compiler B1-B3 | types G-01 | parser → IR → 最小 codegen |
| **G-03** | types B8（官方 typings 整合）+ platform B1 | G-01, G-02 | `wx.*` 继承官方类型 |
| **G-04** | pinia B1 / router B1 / api B1 | types G-01 | 三个运行时骨架（可并行） |
| **G-05** | lifecycle B1 + module B1 | G-04 | 生命周期 + 模块化 |
| **G-06** | component B1-B3（p-* + WXML schema） | G-02, G-04 | 组件映射 + 模板类型 |
| **G-07** | cli B1 + testing B1 + test-framework B1 | G-02 | CLI 骨架 + Vitest + wx mock |
| **G-08** | devtools B1（TraceBus） | G-04, G-07 | 唯一采集汇聚点 |
| **G-09** | security B1 + i18n B1 | types G-01 | 加密存储 + ICU catalog |
| **G-10** | compiler B4-B6 + types B4-B7 | G-02, G-06 | 优化 + 校验 + super-app |
| **G-11** | build B1-B5 | G-02, G-10, G-07 | Vite 插件 + 多入口 + 分包 |
| **G-12** | router M7.1/M8.4 + module B5 + api A1-A4 | G-04, G-06 | 强类型钩子（对齐 types §04） |
| **G-13** | devtools B2-B9 + build B6-B8 | G-08, G-11 | 面板功能 + CI 矩阵 + 缓存 |
| **G-14** | security B2-B8 + i18n B2-B7 | G-09, G-12 | 权限树 + RTL + Audit |
| **G-15** | build B9-B10 + testing 全量 | G-11, G-13 | 体积预算 + 快照 + 契约门禁 |
| **G-16** | blueprint B1-B5（骨架 + 核心模块 30 页） | G-12, G-15 | 播放器跨 5 层跑通 ✅ |
| **G-17** | blueprint B6-B10（交易/IM/内容 + 验收） | G-14, G-16 | 150 页全量 + audit < 12s |
| **G-18** | website B1-B5（文档站 + Playground） | G-15, G-16 | 官网 dogfooding |
| **G-19** | website B6-B8 + test-framework E2E | G-17, G-18 | 展示 Blueprint 成果 |
| **G-20** | 全量回归 + CrossLayerChecker + changeset 发布 | 全部 | **v1.0 可发布** |
| **G-21** | css-compat B1-B3（CSS 跨端兼容矩阵 + --strict-css + 编译期重写） | G-02/G-10（Compiler CSS 管线） | 四级兼容矩阵 + lint 规则 + 语义组件 |
| **G-22** | app-renderer M1-M6（Custom Renderer + JSI 骨架 + p-* 原生映射） | G-06（Component）、G-21 | 原生视图树 + Glass L3 + 三端一致 |
| **G-23** | safe-area M1-M5（p-safe 语义 + 灵动岛 + 五端 insets + 玻璃联动） | G-22、G-21 | 安全区/灵动岛避让 + CSS013-015 |
| **G-24** | memory-plan M1-M6（四层治理 + Owner/Disposer/Budget + 可回收视图 + JSI 引用） | G-06（Component）、G-22 | 可验证回收 + 峰值可追溯 |
| **G-25** | memorial（纪念日一键置灰） | G-21（滤镜管线） | 声明式灰度，五端同步 |
| **G-26** | skeleton（骨架屏自动生成，与 IFR 同源） | G-10（Compiler IR）、G-25 | 骨架 IR 与真实 IR 同源 |
| **G-27** | theme + fontscale（主题 token + 字体缩放） | G-21、G-25 | 语义 token + 系统联动 + 无闪屏 |
| **G-28** | cache（L0-L3 分层缓存 + 字节预算） | G-24（Memory） | 四层缓存 + 淘汰 + 防 OOM |
| **G-29** | glass（液态玻璃 L1-L3 跨端：pg-glass + 平台映射 + 降级） | G-06（Component）、G-22（App Renderer） | L1 必达 + 降级不崩溃 + L3 系统级 |
| **G-30** | performance（AOT 预编译 + IFR 静态首帧 + Worklet 隔离） | G-10（Compiler IR）、G-22（App Renderer） | 首屏 <200ms + 手势 60fps |
| **G-31** | style-safety B1-B4（样式运行时安全：白名单 + Validator + 编译期推导 + 五端闸门） | G-21（CSS 矩阵）、G-22（App Renderer patchStyle） | 非法样式值永不抵达原生 + 静态推导覆盖率 > 80% |
| **G-32** | router-plus（严格路由：配置校验 + 导航映射 + 转场事务 + deep link） | G-12（Router 强类型）、G-22 | 路由层 Style Safety 接入 + 转场不 crash |
| **G-33** | cli-plus（严格 CLI：编译管线 + dev server + strict 开关） | G-07（CLI 骨架）、G-21/G-31 | CLI 集成 strict 门禁 + 增量编译 |
| **G-34** | devtools-plus（HMR + DevTools 协议 + 可视化） | G-08（TraceBus）、G-31、G-33 | HMR 生效 + Style Safety 闸门可见 |

> **追加说明（v3.2）**：G-21~G-30 为 2026-08 新增 10 份 plan（css-compat / app-renderer / safe-area / memory-plan / memorial-skeleton / app-capabilities / test-framework / types-plus / glass / performance）的全局执行位。其中 test-framework 已并入 G-07、types-plus 已并入 G-01（B1-B2 先行），不再单独占位。各 plan 声称的旧编号（css G-04、renderer G-05、safe-area G-05/G-08、memorial G-11/G-12、app-capabilities G-13~G-15、glass 里程碑 G-04~G-18、performance G-10/G-05）与本表冲突，一律以本表为准（对应关系：css→G-21、renderer→G-22、safe-area→G-22/G-23、memorial→G-25/G-26、theme/fontscale→G-27、cache→G-28、glass→G-29、performance→G-30）。

> **追加说明（v3.3）**：style-safety（样式运行时安全，2026-08 新增 plan）并入本表 **G-31**。其文档声称的 G-16 与 blueprint（G-16 = blueprint B1-B5）撞号，**一律以本表为准：G-16 = blueprint、style-safety = G-31**。依赖关系：B1 依赖 CSS 四级矩阵（G-21 ✅ 已完成）+ Compiler IR（G-10），B4 五端闸门依赖 App Renderer（G-22）。

> **追加说明（v3.4）**：router-plus / cli-plus / devtools-plus（2026-08 新增 P0 plan，第 33-35 份）并入本表 **G-32 / G-33 / G-34**。其声称的 G-17 / G-18 / G-19 与 blueprint（G-17 = blueprint B6-B10、G-18 = website B1-B5、G-19 = website B6-B8 + test-framework）撞号，**一律以本表为准**（router-plus→G-32、cli-plus→G-33、devtools-plus→G-34；旧编号引用 G-05/G-06/G-09/G-11/G-12/G-13/G-16 同前重指向：G-05→G-22 系、G-06→G-22 系、G-09→G-23 系、G-11/G-12→G-12、G-13→G-08/G-11、G-16→G-31）。

### 执行原则
- **每批 = 1 PR = LLM 单次 ≤ 3 文件**
- **地基三联先跑通**：G-01（types B1）+ G-02（compiler B1）+ G-07（test-framework B1）是最高优先级
- 任意层改动 → `CrossLayerChecker`（types §11）即时报错
- 验收见各 plan 的 `acceptance` 章节

---

## 5. CI / 可观测（贯穿全局，不单独成层）

- `proteus audit all`：全量审计，目标 **< 12s**（Blueprint 150 页）
- `CrossLayerChecker`：CI 阶段扫描跨层一致性（同名不同义 / 重复类型 / import 深度）
- `--trace-transform` / `--explain` / `--measure`：所有层统一 flag，输出对接 DevTools TraceBus
- 体积预算 / 分包映射 / 产物快照：**四道门禁**，任一超限阻断 PR

---

## 6. 迁移记录（v2.x → v3.0）

| 变更 | 影响范围 |
|------|---------|
| scope `@proteus/*` → `@proteus-vue/*` | 全 18 份，117 处（已回填） |
| 新增 `contracts.ts` 单文件 | types §07，消除 Router/Module 各自定义 DTO |
| 全局分批改 `G-xx` 命名空间 | 各 plan 内部 B1-Bn 保留，新增本文件 G-01~G-20 |
| 第三方类型边界明确 | types §08-§11（官方 typings vs 自建 schema） |

---

## 7. 验收（全局 v3.0）

- [ ] 18 份文档 scope 100% 统一为 `@proteus-vue/*`（grep 零残留 `@proteus/`）
- [ ] 任意两份 plan 的共享类型均指向 `contracts.ts`，无重复定义
- [ ] `CrossLayerChecker` 跑通，零违规
- [ ] G-01 → G-20 执行序无环、无悬空依赖
- [ ] Blueprint 150 页全量审计 < 12s，契约测试全绿
