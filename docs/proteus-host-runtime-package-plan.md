# Proteus 宿主运行时 · 独立发布包（规划态 · 2026-10-07 登记，未启动）

> **定位**：把三端 **runtime**（当前"从框架 checkout 同源复制 / 构建期产出 AAR"）拆成**可发布、可依赖的独立包**，
> 使 **L2 宿主仓不改框架源码即可依赖**——对齐铁律 **G-42.6**（宿主仓严禁 fork 框架源码，定制走官方扩展点/依赖替换）。
> **本文件是登记件，不是实施计划**：结论 = **现阶段不适合做**，登记触发条件与设计清单，待条件满足再启。
>
> **关联**：三端样板 `决策 #564（harmony HAR）/ #565（iOS 源集）/ #566（Android AAR）` ·
> `hosts/README-LAYERS.md` §4 · `docs/proteus-cli-plus-plan/01-cli.md` §10 · 铁律 G-42.6 / G-45（ABI 版本管理）· G-39（host-runtime SPI）

---

## 1. 现状：三端"可依赖单元"已成，但发布形态仍是**框架内**

三端样板已把"runtime 抽为可依赖单元 + 最小壳 + CLI `create host`/`build --package` + 真机验证"跑通
（harmony / iOS / Android）。**功能闭环已达成**——差的是把该单元从"框架内复制"升级为"对外发布"：

| 端 | runtime 载体（现状） | 当前分发方式 | 目标发布形态（候选） |
|---|---|---|---|
| harmony | HAR（`proteus_render/`，携带 C++ 源 + CMake + Rust 核） | 从框架 checkout **复制目录** | HAR → ohpm |
| iOS | **源集单元**（`runtime/*.swift` + `platform/*.swift`） | 从框架 checkout **复制源** | SwiftPM 包（源/二进制） |
| android | **AAR**（`proteus-runtime.aar`，构建期产出） | 从框架 checkout **复制产物** | AAR → Maven / registry |

> ★**注意**：当前"复制"对**框架自己的 CLI 生成宿主**成立（框架工具链的内部行为）；但对**外部 L2 宿主仓**，
> 逐字复制框架 runtime 源码/产物即落在 G-42.6 的"复制/内嵌框架源码"禁忌内 ⇒ **独立发布包是 G-42.6 落地时的必然动作**。

## 2. 为什么不现在做（四条阻塞项）

1. **三端分发面各不相同且都未就绪**
   - **Android**：AAR 需 Maven 仓或 registry（或骑 npm 传文件——消费方仍要手接 Gradle）；本仓无 Gradle 模型（手工链）。
   - **harmony**：HAR 需 **ohpm registry**（OpenHarmony/AGC 账号）——尚未接入。
   - **iOS**：**有真实设计分叉**——发布**二进制** xcframework 会逼 runtime 全部 API `public` 化（正是"源集单元"方案刻意规避的，见 #565）；发布**源** SwiftPM 包则无法自建 Rust `.a`（SwiftPM 不跑 cargo，需构建插件）。两条路都需新决策。
2. **runtime API 尚未冻结**——每批 CSS 特性（justify-self / word-break / overflow / 逐边 border …）都改 runtime。
   发布即冻结一个 beta 公共面 ⇒ 版本 churn。需先定"稳定面"与"内部面"。
3. **现有发布机制假设 npm**——`check:pkg` / `check:publish-contents` / `check:internal-versions` / changesets
   全按 `@proteus-vue/*` **npm 包**设计；AAR/HAR（原生二进制载体）非 npm ⇒ 要扩机制 + 交叉编译矩阵 + 二进制托管。
4. **runtime ↔ 壳 的 ABI/版本契约未定义**——G-45 已有 dev-host 的 ABI 版本化（ABI-01~08 + 兼容矩阵），
   但 **runtime 包的公共面**（`VaporRenderHost` / `ProteusHostController` / HAR 导出面）需要自己的冻结/兼容保证，属新设计。

**当前无消费者被阻塞**：CLI 生成的宿主从框架仓复制 runtime 即可用，三端真机全绿；
"外部项目不 clone 框架就依赖 runtime"这一 L2 场景尚未发生 ⇒ 这是**未来需求，不是当前瓶颈**。

## 3. 触发条件（满足其一即评估启动）

- **A. 出现真实外部 L2 消费者**：某项目要用 `proteus create host`，且**不能**携带框架 checkout（G-42.6 落地的时点）；
- **B. runtime API 宣布冻结**：进入某个对外发布线，公共面不再随批次变动；
- **C. 特性流收敛**：一个发布周期内 `hosts/*/runtime` 无功能性改动（CSS 逐项对齐收官或转入维护）。

★**不建议"先只发一端"**（如 android 最便宜）：会在未经 ABI/版本契约的情况下冻结**单端**不稳定面，
与"三端一致发布"的目标相悖，且制造版本漂移。

## 4. 启动时的设计清单（待决项）

| 维度 | 待决 |
|---|---|
| **载体** | harmony：HAR 里 **Rust 核随包**（体积）还是**消费方编译**（现状）？· iOS：二进制 xcframework vs 源 SwiftPM 包（+ 构建插件跑 cargo）· android：AAR + Rust `.so` 随包 |
| **渠道** | ohpm（harmony）· Maven 或 npm-携带（android）· SwiftPM/git tag（iOS）；**命名**（`@proteus-vue/host-runtime-<platform>`） |
| **版本/ABI** | 复用 G-45 的 major/minor/patch + 兼容矩阵思想；定义 runtime 包**公共面**（冻结什么、什么可内部流动） |
| **机制** | 扩 `check:pkg` / `check:publish-contents` / `check:internal-versions` / changesets 覆盖非 npm 载体 |
| **流水线** | CI 交叉编译矩阵（Android arm64/armv7；harmony arm64；iOS device+sim）+ 二进制托管/校验 |

## 5. 前置依赖

① ABI/版本契约设计（可参照 G-45）→ ② 发布渠道与凭据（ohpm/Maven 账号）→ ③ CI 交叉编译矩阵 →
④ 发布机制扩展（门禁 + 打包脚本）。

## 6. 关联

- **G-42.6**（宿主仓严禁 fork 框架源码）——本规划是其"依赖替换"路径的落地载体；
- **G-45**（ABI 版本管理：三态生命周期 + 兼容矩阵）——runtime 包版本契约可直接复用其思路；
- **G-39**（host-runtime SPI）——本规划是 native 侧 runtime 的**分发形态**，与 G-39 的 SPI 职责边界互补；
- **三端样板**：`hosts/README-LAYERS.md` §4（各端落地形态）· `docs/proteus-cli-plus-plan/01-cli.md` §10（`create host`/`--package`）；
- **决策 #564 / #565 / #566**（三端 runtime 抽包 + 最小壳 + CLI）。
