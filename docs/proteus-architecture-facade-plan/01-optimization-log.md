# 优化日志（Optimization Log）

> 记录 `proteus-architecture` 规约层的演进。每次结构性改动在此留痕，便于回滚。
> 配套：`00-architecture.md`（当前规约）、`ARCHITECTURE.md`（一页全景）、`scripts/check-consistency.js`（校验）、`.github/workflows/consistency.yml`（CI 门禁）。

## 一、改动记录（按版本）

| 版本 | 主题 | 关键改动 | 影响范围 |
|------|------|---------|---------|
| v3.0 | 全局缝合 | scope 全量统一为 `@proteus-vue/*`；新增 `proteus-architecture` 规约层；G-01~G-20 全局执行序；18 份 plan 全部锚定全局规约；落地 `scripts/check-consistency.js` 跨层校验 | 18 份 plan · 61 文件 · 120 处 scope 修正 |
| v3.1 | 规约→工程 | 跨层校验接入 GitHub Actions（`.github/workflows/consistency.yml`：scope 扫描 + 分层锁定 `tsc -b` + contracts 变更聚焦）；新增 `ARCHITECTURE.md` 一页全景（分层 / monorepo / 依赖图 / G-01~G-20 / 9 铁律 / v1.0 验收） | 规约从「文档」升级为「CI 硬门禁」 |
| v3.2 | 新 plan 追加 | 新增 10 份 plan 追加 G-21~G-30（css-compat G-21 / app-renderer G-22 / safe-area G-23 / memory-plan G-24 / memorial G-25 / skeleton G-26 / theme+fontscale G-27 / cache G-28 / glass G-29 / performance G-30）；各新 plan 声称的旧编号（G-04/G-05/G-08/G-10~G-18）一律重指向本表；`check-consistency.js` 落地（scope 扫描 + G 表跨文件一致 + 包注册表对照 + contracts 检查） | 规约表 G-01~G-30 · 10 份新 plan 文档 · 遗留 `@proteus/` scope 修正（types-plus/test-framework） |
| v3.3 | style-safety 追加 | 新增 style-safety（全端样式运行时安全）plan 并入 **G-31**；其声称的 G-16 与 blueprint 撞号 → 一律以本表为准（G-16 = blueprint B1-B5、style-safety = G-31）；依赖 G-21（CSS 矩阵 ✅）/ G-22（App Renderer patchStyle）/ G-10（Compiler IR） | 规约表 G-01~G-31 · style-safety 12 文档 G-16→G-31 重指向 |
| v3.4 | plus 系列追加 | 新增 router-plus / cli-plus / devtools-plus（P0，第 33-35 份）并入 **G-32 / G-33 / G-34**；声称的 G-17/G-18/G-19 与 blueprint/website 撞号 → 一律以本表为准（重指向 + 交叉引用同步：router-plus G-17→G-32、cli-plus G-18→G-33、devtools-plus G-19→G-34、Style Safety 引用 G-16→G-31、CLI 引用 G-18→G-33、Router 引用 G-17→G-32；cli-plus 的「G-07~G-16 横切区间」保留原编号） | 规约表 G-01~G-34 · plus 三 plan 文档编号重指向（46 处） |
| v3.5 | app-config 追加 | 新增 app-config（应用全局配置：运行时配置 + 远端更新 + 五端存储）并入 **G-35**；声称的 G-20（v1.0 发布）撞号 → 一律以本表为准；旧编号引用重指向：Theme/Font G-13/G-15→G-27、Memorial G-11→G-25、Style Safety G-16→G-31、Cache G-14→G-28、CLI G-18→G-33、DevTools G-19→G-34、Router G-17→G-32、Glass G-12→G-29 | 规约表 G-01~G-35 · app-config 9 文档编号重指向（42 处） |
| v3.6 | website-v3 同批四 plan 追加 | website-v3 未跟踪目录/zip 的新内容（决策 #312/#313/#314）抽离并入 **G-36（ai-agent）/ G-37（render-backend-spi）/ G-38（compiler-backend-spi）/ G-39（host-runtime-spi）**；原稿声称的 G-33/G-34/G-35/G-36 与已实现 plan（CLI/HMR/app-config/AI-Agent）撞号 → 一律以本表为准；原则 #11→#13（含 #13.5-10 编译/运行时子原则）、铁律 G-36~39.1-6、规则 CMP017-043 合并进 `proteus-architecture` L0 规约；同步删除冗余 `proteus-types-plan`（v1 并入 types-plus v2.0）+ `proteus-llm-rules-plan`（并入 website-v3）+ 3 `.DS_Store` | 规约表 G-01~G-39 · 四 plan 文档编号重指向（G-36→G-39 系列）+ board-inventory 登记 |
| v3.7 | execution-carrier 追加 | 新增 execution-carrier（执行载体抽象 + JSI 边界治理：JSICarrier/AOTCarrier 双载体 + 批处理差分 + 零拷贝通道 + 实时逃逸 + conformance 42）并入 **G-40**（决策 #340）；原稿声称 G-37/G-36/G-35/G-34 撞号 → 一律以本表为准（G-37→G-40、G-36→G-39、G-35→G-38、G-34→G-27 系）；原则 #13.11-13.14、铁律 G-40.1-6、规则 CMP044-050 合并进 `proteus-architecture` L0 规约 | 规约表 G-01~G-40 · execution-carrier-plan 编号重指向 + board-inventory 登记 |
| v3.8 | 宿主层三 plan 追加 | 新增宿主层三份 plan（决策 #341）并入 **G-41（host-integration）/ G-42（host-container）/ G-43（ownership）**；原稿声称 G-38/G-39/G-40 与 compiler-backend-spi / host-runtime / execution-carrier 撞号，内部沿用 execution-carrier 原稿旧编号体系（宿主运行时 G-36 / 执行载体 G-37 / 渲染 G-34 / 编译 G-35 / AI-Agent G-33）→ 一律以本表为准（G-38→G-41、G-39→G-42、G-40→G-43、G-37→G-40、G-36→G-39、G-35→G-38、G-34→G-27 渲染本体/G-37 渲染 SPI、G-33→G-36）；原则 #13.15-24、铁律 G-41/42/43.1-6、规则 CMP051-073 合并进 `proteus-architecture` L0 规约；三份参考实现 CJS 改 .cjs（type:module 兼容） | 规约表 G-01~G-43 · 三 plan 文档编号重指向 + board-inventory 登记 |
| v3.9 | testing-framework 追加 | 新增自动化测试框架 plan（第八次泛化：Test IR + TestBackend SPI，决策 #364）并入 **G-44**；原稿声称 G-41 与 host-integration 撞号、CMP067-074 与 ownership（G-43）撞号 → 一律以本表为准（G-41→G-44、CMP067-074→CMP074-081）；原稿旧编号引用（宿主运行时 G-36/执行载体 G-37/接入 G-38/容器 G-39/所有权 G-40/编译 G-35/渲染 G-34）全量重指向；原稿「第七次泛化」漏计所有权修正为第八次；原则 #13.25-13.27、铁律 G-44.1-6、规则 CMP074-081 合并进 `proteus-architecture` L0 规约；陈旧 00-12 副本删除（repo proteus-test-framework-plan 版本更新——含 #204/#205 TestDriver 落地增量） | 规约表 G-01~G-44 · plan 编号避让 + board-inventory 登记 |
| v3.10 | dev-host 追加 | 新增调试基座 plan（原则 #0 第九次投影：不绑定基座形态，决策 #369）并入 **G-45**——打破 uni-app 式「自定义基座循环」：插件 = DynamicBackendModule 动态装载（签名 + conformance 快检门禁）+ 转发桩 pending 语义 + 双层产物（基座 cacheKey 与业务规模无关）；三端分级 Android/鸿蒙 Tier A 全热替换 / iOS Tier B 增量重签（2.5.2 诚实边界）/ Tier C 模拟先行；原则 #13.28-13.30、铁律 G-45.1-6、规则 CMP082-088 合并进 `proteus-architecture` L0 规约；参考实现 dev-host-reference.cjs 12 自检 PASS | 规约表 G-01~G-45 · board-inventory L2 登记 |
| v3.11 | 七 plan + 白皮书追加 | 新增七份 plan（决策 #385）并入 **G-46（resource-pool，宿主级统一资源池，第十次投影：不绑资源容器形态）/ G-47（combined-conformance，组合一致性，第十一次投影：不绑测试层级）/ G-48（miniprogram-runtime，兼容式小程序运行容器，第十二次投影）/ G-49（sandbox-isolation，进程级沙箱隔离，第十三次投影：不绑隔离强度）/ G-50（developer-platform，开发者平台 A+B，第十四次投影：不绑平台/生态形态）/ G-51（test-ir-runner，验证执行环境插拔，第十五次投影）/ G-52（cross-device-verification，跨设备一致性，第十六次投影）** + 白皮书（docs/proteus-whitepaper-plan，不占 G 序）；编号避让：七包原稿 execution-carrier 旧号体系全量重指向官方位（G-36→G-39、G-37→G-40、G-39→G-42、G-40→G-43、G-41→G-44）+ 原稿 CMP 高位段互相撞号（G-48 110-116 vs G-49 109-117）→ 定案全库连续段 CMP089-146（G-46=089-096 / G-47=097-102 / G-48=103-109 / G-49=110-117 / G-50=118-131 / G-51=132-139 / G-52=140-146）+ 泛化序修正（G-51/G-52 原稿误作 12/14 → 15/16）；原则 #13.31-56、铁律 G-46~G-52.1-x、规则 CMP089-146 合并进 `proteus-architecture` L0 规约；跨包去重（G-48 沙箱/能力桥 → G-49 权威化 + 引用；白皮书方法论章节 → 引用 spi-first/methodology SSOT）；spi-first 映射表登记第 10~16 次泛化 | 规约表 G-01~G-52 · 七 plan 编号重指向 + CMP 平移 + board-inventory 登记 |

---

## 二、G-01 ~ G-52 全局执行序（权威版）

| 序号 | 内容 | 前置 | 备注 |
|------|------|------|------|
| G-01 | types B1（Registry + Platform + contracts） | — | **地基**（types-plus B1-B2 并入） |
| G-02 | compiler B1-B3（parser/IR/后端） | G-01 | SFC → IR |
| G-03 | platform B1 + types B8（typings 整合） | G-01,G-02 | 官方 d.ts |
| G-04 | pinia/router/api B1 | G-01 | 运行时三联（并行）|
| G-05 | lifecycle + module B1 | G-04 | 生命周期 + 模块化 |
| G-06 | component B1-B3 | G-02,G-04 | p-* + WXML schema |
| G-07 | cli + testing + test-framework B1 | G-02 | CLI + Vitest + wx mock |
| G-08 | devtools B1 (TraceBus) | G-04,G-07 | 采集汇聚点 |
| G-09 | security + i18n B1 | G-01 | 加密 + ICU |
| G-10 | compiler B4-B6 + types B4-B7 | G-02,G-06 | 优化 + 校验 |
| G-11 | build B1-B5 | G-02,G-10,G-07 | Vite 插件 + 分包 |
| G-12 | router M7.1/M8.4 + module B5 + api A1-A4 | G-04,G-06 | 强类型钩子 |
| G-13 | devtools B2-B9 + build B6-B8 | G-08,G-11 | 面板 + CI + 缓存 |
| G-14 | security B2-B8 + i18n B2-B7 | G-09,G-12 | 权限 + RTL |
| G-15 | build B9-B10 + testing 全量 | G-11,G-13 | 门禁 + 快照 |
| G-16 | blueprint B1-B5（核心 30 页）| G-12,G-15 | 播放器跨 5 层 ✅ |
| G-17 | blueprint B6-B10（150 页）| G-14,G-16 | audit < 12s |
| G-18 | website B1-B5 | G-15,G-16 | 官网 dogfooding |
| G-19 | website B6-B8 + test-framework E2E | G-17,G-18 | Blueprint 成果展示 |
| G-20 | 全量回归 + changeset 发布 | 全部 | **v1.0** |
| G-21 | css-compat B1-B3（CSS 兼容矩阵 + --strict-css） | G-02/G-10 | CSS 管线（原声称 G-04，重指向） |
| G-22 | app-renderer M1-M6（Custom Renderer + JSI） | G-06,G-21 | 原生渲染后端（原声称 G-05，重指向） |
| G-23 | safe-area M1-M5（p-safe + 灵动岛） | G-22,G-21 | 安全区（原声称 G-05/G-08，重指向） |
| G-24 | memory-plan M1-M6（四层治理 + Owner） | G-06,G-22 | 内存（JSI 部分随 G-22） |
| G-25 | memorial（纪念日置灰） | G-21 | 灰度（原声称 G-11，重指向） |
| G-26 | skeleton（骨架屏） | G-10,G-25 | 骨架（原声称 G-12，重指向） |
| G-27 | theme + fontscale（主题 + 字体） | G-21,G-25 | 主题（原声称 G-13/G-14，重指向） |
| G-28 | cache（L0-L3 缓存） | G-24 | 缓存（原声称 G-15，重指向） |
| G-29 | glass（液态玻璃 L1-L3） | G-06,G-22 | 玻璃（原里程碑标号 G-04~G-18，统一为 M1-M6） |
| G-30 | performance（AOT/IFR/Worklet） | G-10,G-22 | 性能（原声称 G-10/G-05，重指向 G-30/G-22） |
| G-31 | style-safety B1-B4（样式运行时安全） | G-21,G-22,G-10 | 样式安全（原声称 G-16 与 blueprint 撞号，重指向 G-31） |
| G-32 | router-plus（严格路由） | G-12,G-22 | 路由（原声称 G-17 与 blueprint 撞号，重指向 G-32） |
| G-33 | cli-plus（严格 CLI） | G-07,G-21,G-31 | CLI（原声称 G-18 与 website 撞号，重指向 G-33） |
| G-34 | devtools-plus（HMR + 协议 + 可视化） | G-08,G-31,G-33 | DevTools（原声称 G-19 与 website 撞号，重指向 G-34） |
| G-35 | app-config（应用全局配置） | G-27,G-28,G-25 | 应用配置（原声称 G-20 与 v1.0 发布撞号，重指向 G-35） |
| G-36 | ai-agent（AI Agent 接入） | G-29,G-31,G-32 | AI 代码生成 SPI（原稿 G-33 与 cli-plus 撞号，重指向 G-36，决策 #312） |
| G-37 | render-backend-spi（G-27 RenderBackend SPI 规范） | G-27,G-29,G-32 | 渲染插头标准（原稿 G-34 与 devtools-plus 撞号，重指向 G-37，决策 #312） |
| G-38 | compiler-backend-spi（G-29 CompilerBackend SPI 规范） | G-29,G-32 | 编译插头标准（原稿 G-35 与 app-config 撞号，重指向 G-38，决策 #312） |
| G-39 | host-runtime-spi（宿主运行时 SPI + L0-L4 职责矩阵） | G-27,G-28,G-29,G-30 | 运行载体插头（原稿 G-36 与 ai-agent 撞号，重指向 G-39，决策 #314） |
| G-40 | execution-carrier（执行载体 SPI：JSI/AOT 双载体 + 批处理 + 零拷贝 + 实时逃逸） | G-39,G-37,G-38 | 执行载体插头（原稿 G-37 与 render-backend-spi 撞号，重指向 G-40，决策 #340） |
| G-41 | host-integration（宿主接入契约 + Vue 绑定架构） | G-27,G-39,G-40,G-38 | 宿主接入插头（原稿 G-38 与 compiler-backend-spi 撞号，重指向 G-41，决策 #341） |
| G-42 | host-container（容器 SPI + 页面生命周期 + 严禁 fork） | G-39,G-41,G-40,G-27 | 容器插头（原稿 G-39 与 host-runtime 撞号，重指向 G-42，决策 #341） |
| G-43 | ownership（资源所有权 SPI + 借用检查 + 确定性 Drop） | G-42,G-40,G-39,G-38 | 所有权插头（原稿 G-40 与 execution-carrier 撞号，重指向 G-43，决策 #341） |
| G-44 | testing-framework（Test IR 可序列化断言 + TestBackend SPI 五后端 + 八次泛化统一 runner） | G-27,G-29,G-39,G-40,G-41,G-42,G-43,G-25 | 验证层插头（原稿 G-41 与 host-integration 撞号、CMP067-074 与 ownership 撞号 → G-44 + CMP074-081，决策 #364） |
| G-45 | dev-host（调试基座即宿主：Install-Once + 动态后端 + 转发桩 pending + 双层构建 + 装载即验证） | G-39,G-42,G-28,G-38,G-44 | 基座插头（打破自定义基座循环：baseRebuildCount=0 + 构建 O(改动)，决策 #369） |
| G-46 | resource-pool（宿主级统一资源池：登录态/凭证三层池 + 双轨降级 + 跨页所有权 + RSC） | G-27,G-39,G-42,G-43,G-44,G-45 | 资源池插头（内一致性 = G-27 对偶；原稿建议顺延 G-47 → 定案 G-46 + CMP089-096，决策 #385） |
| G-47 | combined-conformance（组合一致性：G-27×G-46 交界 + 接缝层 + 六不变量） | G-27,G-44,G-45,G-46 | 组合验证插头（不绑测试层级；原稿 CMP103-108 → CMP097-102，决策 #385） |
| G-48 | miniprogram-runtime（兼容式小程序运行容器 + PlatformAdapter SPI + 兼容矩阵） | G-27,G-28,G-39,G-42,G-43,G-44,G-45,G-46,G-47 | 小程序运行时插头（不绑运行时形态；原稿 CMP110-116 → CMP103-109，决策 #385） |
| G-49 | sandbox-isolation（进程级沙箱隔离：IsolationLevel L1-L4 + CapabilityBridge） | G-42,G-43,G-45,G-46,G-47,G-48 | 隔离强度插头（机制强制；原稿 CMP109-117 去重 → CMP110-117，决策 #385） |
| G-50 | developer-platform（开发者平台：A 工具链 + B 生态 + AppPackage 双签名） | G-48,G-49,G-44,G-45 | 平台插头（不绑平台/生态形态；CMP118-131，决策 #385） |
| G-51 | test-ir-runner（验证执行环境：L0 文档/L1 模拟/L2 真机 + NativeAdapter） | G-44,G-46,G-47,G-48,G-49,G-50 | 验证执行插头（不绑验证执行环境；CMP132-139，决策 #385） |
| G-52 | cross-device-verification（跨设备一致性：等价类 + 指纹归因 + ε diff） | G-51,G-44,G-25,G-46~G-50 | 跨设备插头（不绑设备形态；CMP140-146，决策 #385） |

---

## 三、验收清单

- [x] scope 100% 统一为 `@proteus-vue/*`（grep 零残留）
- [x] 18 份 plan 均已锚定全局规约
- [x] `CrossLayerChecker` 跑通，零 err
- [x] G-01~G-20 执行序无环、无悬空依赖
- [x] 包名注册表覆盖全部 18 个包
- [x] CI 集成 `.github/workflows/consistency.yml`（scope 扫描 + 分层锁定 tsc -b + contracts 聚焦）
- [x] `ARCHITECTURE.md` 一页全景（L0-L5 / monorepo / 依赖图 / G-01~G-20 / 9 铁律 / v1.0 验收）
- [ ] 第三方类型边界文档（types §08-§11）已与 platform/api 对齐

---

## 四、回滚

若需回退 scope 改动：
```bash
git checkout -- 'proteus-*/**/*.md'
```
新增的 `proteus-architecture/` 与 `scripts/` 直接删除即可。

CI 工作流回滚：删除 `.github/workflows/consistency.yml` 即可，不影响业务代码。
