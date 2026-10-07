# Proteus 项目记忆（PROJECT_MEMORY.md）

> **项目本地记忆文件**：新会话入口 —— 当前进度 + 关键点 + 阅读指引（详细历史在 `docs/project-memory-archive/`）。
> 新会话的 LLM **必须先读顶部「当前状态速览」**，再按 §「会话恢复指引」顺序阅读。
> **维护规则见 §《收纳规范》**（门禁 `pnpm check:memory`）——新里程碑的详细叙事**直接写进当月归档**，主文件只加一行速览。

---

## 项目概览

- **名称**：Proteus（普罗透斯）—— Vue 跨端编译框架
- **核心理念（架构方向已定案，决策 #290）**：**一份标准 Vue 源码 → 语义 IR（C-IR/CompilerIR）→ 可插拔渲染后端**（Render anywhere, on any engine）；不再是「小程序编译器」——小程序降级为 Layer 1 兼容层
- **四层可插拔（原则 #10 终极形态）**：编译（G-29 CompilerBackend）/ 逻辑（JS 引擎）/ UI（G-27 RenderBackend）/ 能力（G-28 NativeBackend）
- **技术栈**：Vue 3.4+ / Vite 5 / TypeScript 5.4+ / 微信基础库 2.29.2+（Skyline + wx.router）
- **包规模**：**45 个 @proteus-vue/* npm 包**（+ `packages/layout-core-rust` = **cargo crate，非 npm 包**，故不计数）（★2026-09-29 layout-core = App 排版核心）（check:pkg 0 error · `pnpm check:stats` 校验 ✓；31→38 修正 → G-07 glass 39 → Skyline 收口 worklet 40 → ★2026-09-14 组件库拆包 `@proteus-vue/components` 41 → ★Vapor 线新增 `@proteus-vue/slot-runtime` 42 + `@proteus-vue/layout-core` 43 → ★2026-09-30 MA1 新增 `@proteus-vue/animation` 44；版本统一 0.3.0-beta.8，见「当前状态速览」）
- **文档**：`docs/proteus-architecture.md`（L0 规约·真理来源）→ `docs/board-inventory.md`（全景索引）→ `docs/roadmap.md`（版本线）→ `roadmap-2-plan`（里程碑线）→ 各 plan

## 当前状态速览（最近一次更新：**2026-10-08·（二七九）· ★★★鸿蒙 effects C/D 盒位移 + 阴影单位错配**（决策 #633）——用户「这个还是没修复完啊，鸿蒙的案例C和案例D。还有鸿蒙的阴影还是和其他端差异太大」。★**C/D 位移真根因 = 变换二次绕枢轴**：ArkUI `SetTransform` 的矩阵**绕 RenderNode.pivot 施加**（缺省 (0.5,0.5)，SDK `RenderNode.d.ts` 明确），而 #632 修 D 案时**枢轴已烘焙进矩阵**（`C=Aa∘Lo`）⇒ **二次施加** ⇒ 实际绕点 (1.0w,1.0h)。量化铁证：`scale(1.2)` 盒左移 −16.8（正确应 −8.4，**恰 2 倍**）；`rotate 10°` 绕中心与图心重合**视觉不可辨**（=骗过上一轮的原因）。修：SetTransform 前 `SetPivot(0,0)`。★**阴影差异过大 = 单位错配（方向与批 48 相反）**：ArkUI shadow `offset`/`radius` **都取物理 px**，而批 48 把 radius **÷density 当 vp** ⇒ blur 缩到 **1/3.5** ⇒ 只剩"盒下一坨硬块"、无侧向晕。修：两者都按物理 px 传。★**证伪批 48 注释**（"radius 取 vp"的推断错了）。★**验证（真机四端量化）**：C 绿 x[117.7..218.0]（Web 118.0..217.5）· C 蓝 x[22.9..112.9]（Web 23.0..112.5）· D 橙 x[16.9..113.7]（Web 17.0..113.5）；B 阴影 decay 与 Web 同量级、侧向 halo 逐点吻合；**superapp fab 光球未回归**（over-glow 消失）。★**教训**：三家平台变换锚点语义不同（**ArkUI pivot / iOS anchorPoint / Android 绝对点**）⇒ 枢轴烘焙进矩阵后**必须**把平台 pivot 归零；**"改对了注释"≠"注释对"**（错误理由会让方向反向——批 48 就是实例）；旋转绕中心时二次枢轴不显 ⇒ 只用 rotate 的案例**测不出**，须用 scale/origin 案。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二七八）· **安卓/鸿蒙「父 transform 未级联到子树」（effects D 案文字不随盒旋转）+ 安卓阴影柔化（B）**（决策 #632）——用户「我测试感觉还是有问题，安卓的投影明显有差异。还有鸿蒙和安卓的案例D文字位置不对」。★**① D 案「文字位置不对」= 父 `transform` 在扁平绘制模型下未级联（Android+鸿蒙）**：`.to-box` 旋 12° 而**盒内文字不跟着转**（Web/iOS 正确——CALayer transform 级联到 sublayer）。根因：App 端**扁平**绘制（Android 每节点一条 Cmd、鸿蒙每节点 `AddChild(g_rootNode,·)` 绝对定位），CSS「transform 作用于整棵子树」须**显式级联**——此前只施加本节点变换。修：**Android** 注入 `parentId` + `drawCmds` 绘制前先施加**祖先链**变换（外→内）；**鸿蒙** cmd 增发 `id`/`parentId` + 预扫描合成祖先链矩阵（`C=Aa∘Lo`）。★**防环**（父链 visited+限深）：首版无防护 → 父链遍历**死循环** → 真机 `THREAD_BLOCK_6S`、**整屏空白**；加 guard 后稳定。★**② B 案「安卓投影明显有差异」**：旧实现 6 层同心矩形（每层外扩达整 blur）⇒ **色带+中部过重**；改 **14 环高斯近似**（σ=blur/2）——平滑、量与 Web 同。★**验证（真机量化）**：D 文字倾角 WEB 9.9° / iOS 10.3° / **Android 10.1°** / **鸿蒙 10.2°**（修前 Android −1.9°/鸿蒙 −1.6°）四端一致；B Android 柔和同 Web；鸿蒙 effects 连跑 2 轮零 freeze。★**教训**：**扁平绘制模型缺"变换级联"这一 CSS 语义**——凡"容器加样式、子元素该跟着变"的特性（transform/opacity/filter/clip…）扁平端都要**显式级联**（**跨端架构级差异面，不止 D 案**）；**遍历父链必须防环/限深**（否则打死主线程、整屏空白、构建期看不出）；**量化分歧先自证测量方法**（粗糙中位数掩码曾把"对齐"误报成"缺陷 −0.0°"，换"盒内白字+左右邻接橙"限制后四端一致）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二七七）· **iOS 变换绕错锚点（漏减 `CATransform3D` 的 anchorPoint 偏移）——effects 案例 C/D 仍偏差**（决策 #631）——用户「再继续查，案例B、案例C和案例D还有问题」。★**C/D 真缺陷（子代理逐角量化 + 真机 TRACE）**：iOS `CATransform3D` 是绕 **layer.anchorPoint**（缺省 = 层中心 c）施加，而 `applyTransform` 用了 `T(q)·M·T(−q)`——**漏减 anchorPoint 偏移 c**（应为 `T(q−c)·M·T(−(q−c))`）⇒ 等效绕点偏 `(I−M)·c`：**案例 C** 的 `scale(1.2)` 绿盒**左移 ~9css**（与蓝盒重叠、挤掉 16css 间隙）；**案例 D** 的 `transform-origin:0 0` **未生效**（实际绕中心，左上角 (14,12)→(19,3)；四角逐一对上"中心旋转"）；**Web/Android/鸿蒙均正确**（Android 用 `canvas.rotate(θ,qx,qy)` 绕绝对点）。★**真机 TRACE 证实 origin 取值本身正确**（`org=(0,0)`/`(0.5,0.5)` 都到了）⇒ 问题在**合成**、非取参（上一轮 `styleOf` 透传没错，但合成公式错）。★**修**：`px=w*(org.x−0.5)` · `py=h*(org.y−0.5)`（= `q−c`）。**验证**：修后橙(D) x[17..113.7] · 绿(C) x[117.7..218] · 蓝 x[23..112.7] 与 Web [x17..113 / x118..217.5 / x23..112.5] **逐项吻合**。★**B（box-shadow）：复查未发现明确缺陷**——四端阴影均**存在且柔和**、下偏移/模糊量级与 Web 相当（峰值 α：Web .129 / iOS .132 / Android .133 / 鸿蒙 .165）；仅 Android（6 层近似）略有**可辨色带**、鸿蒙略深（~28%）——**均属次要、未改**，等用户确认具体现象。★**教训**：**`CATransform3D` 的锚点是 layer.anchorPoint（跨端语义不同：Android 是绝对点）**——逐端核必须**量角点位置**而非只看"有没有转"；**"字段传到了"≠"变换算对了"**（要验证**结果几何**，光验参数到达不够）；**逐角坐标量化**是抓锚点偏差的关键手段。★新会话以此为准。

## ★《收纳规范》（2026-10-03 立 · 门禁 `pnpm check:memory`）

**为什么立这条**：本文件曾达 **11,118 行 / 2.4 MB**（每轮里程碑的详细叙事都内联插 H3），
「新会话先读顶部」的成本被历史内容淹没。⇒ 改为「**主文件 = 当前态薄入口；历史与长表全文在 `docs/project-memory-archive/`**」。

**主文件只放六类内容**（其余一律归档）：
1. 项目概览（要点，不放过程）
2. 当前状态速览——**只保留最近 3 条**；插入新条时，第 4 条起移入当月归档
3. 关键决策与文档偏差——**全文在 `decisions.md`**；主文件只留指针 + 锚点（决策号只增不改号）
4. 待办 / 注意事项（已完成项移归档）
5. 会话恢复指引（阅读顺序；指向归档而非内联历史）
6. 归档索引（归档文件清单 + 检索方式）

**新里程碑的写法**（替代旧习惯——详细叙事不再内联）：
1. **详细叙事**（交付 / 缺陷 / 验证 / 诚实边界）追加到 `docs/project-memory-archive/<YYYY-MM>.md`（当月文件；新月份新建）；
2. 主文件顶部加**一行**状态速览（`## 当前状态速览（…）`，含「下一步」）；
3. 需长期记住的教训 → 决策条目（号 +1）追加到 `decisions.md`，架构级同时在主文件「锚点」登记一行；
4. 跑 `pnpm check:memory` 自检（主文件上限 / 结构齐备 / 速览条数 / H3 泄漏）。

## 归档索引（历史在归档——**勿整读，按关键词 grep**）

| 文件 | 内容 |
|---|---|
| `docs/project-memory-archive/2026-10.md` | 里程碑详细叙事（三十九～一四五）+ 状态速览历史栈（约 4.5k 行） |
| `docs/project-memory-archive/2026-09.md` | 09 月全部叙事 + 柔性系统重组历史 + 2026-08 进度快照 + 已落地文件 + 09-19 验证状态（约 6.5k 行） |
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#507——按号检索 |

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#507 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

- ⚠ **★CDP 视觉验收纪律（2026-09-04 晚用户强反馈「你懂什么叫居中吗」「上下间距不一致」）**：官网改完样式必须 CDP 截图 + **数值级核对**再提交——①「居中」要真居中（上下/左右间隙一致、偏差 <4px，不许目测）；② 上下间距对称（如按钮上下 padding 等值）；③ **布局壳禁用带默认布局语义的组件**（p-view 默认 flex-column 同特异性级联靠后会覆盖 justify-content:center——同源坑三次），只用语义中立容器；详见今晚速览首条 #390iii 记录
- ✅ **仓库目录重命名为 `proteus`**（用户本地执行）
- ✅ **文档体系**：根 `README.md` + `docs/`（getting-started / configuration / compiler / routing / roadmap / board-inventory）
- ✅ **开源协议**：Apache-2.0（LICENSE + package.json license 字段 + README 章节）
- ✅ **git 仓库**：已关联 https://github.com/proteus-vue/proteus（main 分支）
- **小程序真机/开发者工具实测（唯一剩余验收项）**：`npm run build:mp` 后用微信开发者工具导入 `dist/mp-weixin`（需真实 AppID + 基础库 ≥2.29.2）
- **Skyline iOS 真机白屏关注**：微信平台已知问题，已入 roadmap v0.5；真机实测时记录复现路径（决策 #69）
- **框架本体拆包（C 类）**：✅ 全部完成（决策 #98-#105，docs/packages.md 8 步）——14 个 @proteus-vue/* 包 + create-proteus 模板 npm 化；**npm 已发布**（2026-08-31：22/22 beta 上线，决策 #215，发布记录见 docs/packages.md）
- **组件库 P0（component-plan B1-B8）**：✅ 2026-08 全批收官——16 组件 + 4 runtime 共享模块 + components:audit + 编译器 4 增强（script/watch-props props 源 watch→observers / ref-write 多行 RHS 修复 / 组件 onUnmounted→detached / 未映射 onXxx 钩子警告）；业务组件（player-bar/payment-sheet/login-gate）标注依赖 appBar/支付（v0.6+）
- **i18n-plan（B1-B3）**：✅ 2026-08——@proteus-vue/i18n（ICU 子集：插值/复数/=N/select/#）+ i18n:check 门禁 + demo；分包加载/完整 ICU/Intl/RTL 标后续
- **devtools-plan（B1-B2）**：✅ 2026-08——@proteus-vue/devtools-runtime（TraceBus 协议/环形缓冲/脱敏/采样/零开销门控）+ lifecycle/component 两源接入（type-only 注入）；面板 B3-B8 标 v1.0+
- **npm 发布**：✅ 2026-08-31 完成——**22 包 beta 全部上线**（granular Automation token；create-proteus 收口 @proteus-vue scope，决策 #215）；**✅ 2026-09-04 pnpm 迁移后全量 38 包正式发布完成**（16 个此前缺失包补齐上架：docs/component-ir/fluid/render-backend/desktop/mcp/agent/test-ir/gesture/style-safety/hmr/devtools/compat-miniprogram/dev-host——publish-all.mjs 并发预检 + 串行发布；日后再发布直接复用该脚本）；正式版流程（pre exit → changeset:version → 同步 examples/templates → publish）见 docs/packages.md
- **security-plan（M1-M3）**：✅ 2026-08——@proteus-vue/security（M1 SecretStorage 加密存储：WebCipher/DemoCipher/volatile/redact/migrate；M3 PermissionRegistry + withPermission + PermissionDenied）+ M3 §3 Router 权限守卫自动生成（RouteMeta.permissions + createRouter options.permissions，与 requiresAuth 守卫同层）；M4-M8 标后续
- **app-plan（B1 核心）**：✅ 2026-08——@proteus-vue/renderer-app（Vue createRenderer + NativeAdapter 抽象 + mock adapter，无需真机验证渲染器接线）；B2-B5（原生视图/样式 rpx→dp/路由桥/能力桥/demo）标 v0.6 正式启动（需 npm 发布 + 原生工程）；Vapor 双模式标后续
- **build-plan M8 缓存**：✅ 2026-08——编译缓存（compileCacheKey 全入参哈希 + 磁盘/内存双层）+ esbuild bundle 缓存（输入快照 mtime+size 指纹）；examples 真实构建 100% 命中 + 产物逐字节一致 + 单文件精确失效；PROTEUS_NO_CACHE 关闭；详见 02-optimize-cache.md
- **types-plan（B3-B7 全批）**：✅ 2026-08——@proteus-vue/types 独立包（Platform/PlatformTarget + JSON Schema + generate types --check 防漂移）+ B4 平台守卫（matchPlatform/assertPlatform/exhaustiveCheck，铁律 #4）+ B5 validateConfig（config:check CLI 错误码）+ B6 加固（品牌类型 Brand/配置迁移 migrateConfig/Schema Registry extendConfigSchema）+ B7 migrate types codemod + CI 门禁；四层测试矩阵随批落地
- **组件类型齐全**：✅ 2026-08——GlobalComponents 模板标签类型注册（16 组件 Pascal+kebab 双名）+ @vue-expect-error 断言 fixture（防退化）；examples vue-tsc 0 错误
- **类型收口（T1-T4）**：✅ 2026-08——公共类型全部统一到 @proteus-vue/types（compiler-types/capabilities/router-types/api-types/config/index-shared），各实现包 types.ts 为 re-export 兼容层（消费方零改动）；runtime 值（ApiError/CapabilityError class、createTrace）留实现包；CapabilityPlatform = Platform alias；type-only 擦除验证 + 无环依赖；方案见 docs/proteus-types-plus-plan/11-type-consolidation.md
- ⚠ **根 vue-tsc 零错误**（2026-08-31 清理 web-button multiSelector 既有错误后清零；持续保持——见「当前状态速览」build:web vue-tsc 零错误）
- 文档版本号已到 v2.53（git 仓库关联）
- ⚠ **★已按用户要求整合（决策 #312/#313/#314）**：`docs/proteus-website-v3-plus/` + `docs/proteus-website-v3-final/`（未跟踪）中的**新内容 G-33（AI Agent）与 G-34（RenderBackend SPI）已抽离**，按编号避让纪律重编号为 **`docs/proteus-ai-agent-plan/`（G-36）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37）** 入库（原 G-33=CLI、G-34=HMR 均已实现占用）；**同批还发现 `proteus-compiler-backend-spi.zip`（内含原稿 G-35，与 app-config 冲突）与 `docs/proteus-host-runtime-plan/`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟 G-34/G-35）——一并抽离为 G-38/G-39 plan**；两份未跟踪目录 + zip 已删（其余 01-06 内容与已跟踪 `proteus-website-v3/` 重复，无独家内容）；`docs/proteus-website-v3.zip` 先前用户已删，尊重偏好未跟踪；另按用户指示删除冗余文档：`proteus-types-plan`（v1.0 并入 types-plus v2.0）+ `proteus-llm-rules-plan`（并入 website-v3）+ 3 个 `.DS_Store`（决策 #313）。详情见「后续规划」#312-#314。

## 后续规划（更新于 2026-09-02，★以「当前状态速览」为准）

**主路线（G-32 完整语义落地，决策 #303-#311 链）**：
- **G-32 B3 续**：⑤ Capability **50/50 收官**（七/八期 12 能力：map(C4)/sms(C22)/background(C25)/socket-task(C28)/data-channel(C31)/cookie(C32)/face-id(C39)/in-app-purchase(C46)/mini-program(C47)/embedded(C48)/live(C49)/extension(C50)——web 真实 document.cookie·visibilitychange·WebSocket·WebAuthn + wx 原生 createMapContext·navigateToMiniProgram·startSoterAuthentication facial·onAppHide/Show·SocketTask·storage Cookie + 宿主桥 data-channel/embedded/live/extension 诚实降级，决策 #323）
- **G-32 B5**：⑥ 工程原语 28（**★★28/28 收官：首期 E1 useState/E2 useComputed/E3 useWatch/E6 useLifecycle/E7 useReady/E9 usePageParam（决策 #319）+ 续 E10-E17 路由语义化（决策 #320）+ 续二 E19-E23 动画（决策 #321）+ 续三 E24-E28 工程化（决策 #322）——`createEngineering`/`createRouterEngineering`/`createAnimationEngineering`/`createToolingEngineering` 注入式四工厂 + 组件形态 p-transition/p-animate（E19/E20 已 implemented）+ 纯声明工具 defineComponent/defineCapability**；B5 收官——唯一剩余 E18 router-link（声明式导航组件形态）待后续批次）；与 G-17 路由/G-34 HMR 协同
- **G-32 B6**：对照矩阵自动化（miniprogram-mapping 与 catalog 自动同步）+ codemod 完善（scroll-view/swiper AI 语义还原 + 路由名表）

**并行候选（按顺序）**：
- **G-29 B2**：RustBackend（SWC 生态 → 同一 CompilerIR——conformance IR Golden Test 已就绪，接入即可验证）
- **G-27 B6**：混合渲染（Texture Sharing 抽象 + 页面级切后端 + DevTools 可视化）
- **G-31 收尾**：B7 续（useFetch/useStorage 已收口——剩 router 语义化对齐）

**★已整合（决策 #312-#314）**：`docs/proteus-website-v3-plus/` 与 `docs/proteus-website-v3-final/`（未跟踪）的新内容 G-33/G-34 已抽离入库为 **`docs/proteus-ai-agent-plan/`（G-36 AI Agent）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37 RenderBackend SPI）**（编号避让：G-33=CLI、G-34=HMR 已实现占用）；**另发现同批 zip `proteus-compiler-backend-spi.zip`（pack.sh 产物）内含第三个新 plan——CompilerBackend SPI 原稿 G-35（与 app-config 冲突）→ 一并整合为 **`docs/proteus-compiler-backend-spi-plan/`（G-38，含 verify.sh/pack.sh/MANIFEST/conformance-runner.js 自检工具链）**；原稿引用 G-34（RenderBackend SPI）→ G-37、原则 #11（可插拔可验证）→ #13（含 #13.5-7 编译器专项子原则）同步重指向**；MCP Server（AI B1）、SPI 套件（G-37 B2）、编译器 SPI（G-38 B1）、宿主运行时 SPI（G-39 B1）可与既有 `@proteus-vue/render-backend`·`@proteus-vue/compiler-backend`·`@proteus-vue/renderer-app` 实现互为印证。**另发现第四 plan `proteus-host-runtime-plan`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟引用旧编号）→ 按 #312 同法整合为 **`docs/proteus-host-runtime-plan/`（G-39，编号避让 G-36→G-39 / G-34→G-37 / G-35→G-38 / 原则 #11→#13，决策 #314）**。

**遗留已知限制**（★2026-09-19 复核）：~~tabBar 100vh 遮挡~~ **已实测关闭**（Skyline 的 100vh **按页面类型解析**——tabBar 页得 `windowHeight`=762（底边恰在 tabBar 顶边）、非 tabBar 页得 `screenHeight`=844 满屏 ⇒ 不存在遮挡；已加几何回归锁）。**仍存**：半屏页 / 长列表 list-view 摊平 / 下拉刷新 Web 端未桥接；其余 roadmap 大项（v0.5 多端 / v0.6 App+Vapor / v1.0 生产可用）见 docs/roadmap.md。

## 会话恢复指引（新 LLM 按此顺序阅读）

0. **★★★先挂载效率规范 Skill（每会话强制）**：执行 `Skill(ai-efficiency-rules)`
   （文件 `.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用——
   约束固定 `sleep` 盲等 / 重复拉取远程资源 / 重复读文件 / 无归因重试 / 该并行却串行 / 输出爆炸。
   同规则见根目录 `AGENTS.md` §0。
1. `PROJECT_MEMORY.md`（本文件）—— **★先读顶部「当前状态速览」**（只保留最近 3 条）：架构方向 / 最近里程碑 / 当前数量 / 路线图位置 / 待决项；**详细历史与决策链全文在 `docs/project-memory-archive/`（按月归档 + decisions.md，勿整读、按号/关键词 grep）**。
2. `docs/proteus-architecture.md` —— **L0 规约（真理来源）**：原则 #0-#12 + 铁律 + 十系规则总表（G-31.1-4/CMP005-8/RND001-005 等）
3. `docs/board-inventory.md` —— **架构规划全景（v2）**：六层 plan 分层索引 + 双路线对照 + 资产对照（改新增 plan/包后同步此表）
4. `docs/proteus-positioning-v3.md` —— 对外门面（slogan One semantic model. Any render engine.）
5. `docs/roadmap.md` + `docs/roadmap-2-plan/` —— 版本线 + 里程碑线（M1 双 SPI 原型 → M2 能力 → M3 生态）
6. `LLM_IMPLEMENTATION_GUIDE.md` —— §0 痛点对照 + 阶段任务指令
7. `packages/compiler/src/transforms/registry.ts` + `README.md` —— 编译规则注册表（AI 说明书，改动编译器前先查）
8. `proteus.config.ts` —— 当前配置；`examples/pages/` 是 Playground 演示

**关键包地图（决策 #314 后）**：`@proteus-vue/render-backend`（G-27 五后端 + conformance）· `@proteus-vue/component-ir`（G-31 C-IR + G-32 128 原语 SSOT + audit）· `@proteus-vue/compiler-backend`（G-29 编译器 SPI + NodeBackend）· `packages/compiler-backend-rust`（G-29 B2 RustBackend cargo crate——同一 CompilerIR）· `@proteus-vue/gesture`（G-32 ④）· `@proteus-vue/api/capability.ts`（G-32 ⑤ useXxx 50/50——传感器/WebAuthn/useAuth/近场媒体/收官 12 能力）· `@proteus-vue/api/router-engineering.ts`（G-32 B5 续 E10-E17 路由语义化）· `@proteus-vue/api/animation-engineering.ts`（G-32 B5 续二 E21-E23 动画 Hook）+ `src/components/p-transition`·`p-animate`（E19/E20 组件形态，IR engineering.transition/animate implemented）· `@proteus-vue/api/tooling-engineering.ts`（G-32 B5 续三 E24-E28 工程化 Hook + define 工具）· `@proteus-vue/api/request-engineering.ts`（请求数据层 R1-R4：策略请求/useQuery SWR/enqueue/去重）· `@proteus-vue/compat-miniprogram`（G-31 B6 迁移）· `@proteus-vue/desktop`（G-24 B1 桌面交互原语——v-p-hover/-shortcut/-focus-trap/-context-menu）· `src/components/p-*`（57 组件聚合导出）；规划 SPI（同批四 plan：G-36 AI Agent / G-37 RenderBackend SPI / G-38 CompilerBackend SPI / G-39 Host Runtime SPI，均有规约 + conformance 套件 + 参考实现，与既有包互为印证）

