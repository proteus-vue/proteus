#!/usr/bin/env node
// scripts/check-gates-sync.mjs —— ★门禁通道一致性（2026-09-18）
//
// 背景（本会话实测挖出的结构缺口）：CI（.github/workflows/*.yml）与本地 `pnpm verify`
//   是**两套重叠但不一致**的门禁集，各自都不完整，且缺的正好是对方的强项：
//     · CI 有根 `vue-tsc` / `build-packages`，而 `pnpm verify` **没有** →
//       本地「全绿」掩盖了 tsc 构建才暴露的类型错误（实测：TS2322 漏到 CI）。
//     · `pnpm verify` 有 `check:mp-attrs`（主属性棘轮）/ `check:pkg` / `check:showcase-catalog`，
//       而 CI **没有** → 属性覆盖回退可以推上去而 CI 不拦。
//   根因是**门禁的可靠性取决于它被接在哪**，而「接线」此前靠人工记忆、无机器校验。
//
// 本脚本把「接线」变成可机器判定的门禁：
//   ① 每个 `check:*` 脚本必须被**某个 workflow** 引用（含 pages.yml 等非 ci.yml 工作流），
//      或列入下方 LOCAL_ONLY 并给理由——新增门禁时若不接线、不说明，CI 当场红。
//   ② CI 与 verify 的**覆盖差集**必须为空（互为补集即为缺口）：凡 CI 有的形态门禁，
//      verify 亦应覆盖；反之亦然（依赖 dist 的步骤用 build-packages/vue-tsc 归并判定）。
//
// 用法：node scripts/check-gates-sync.mjs
// 退出码：0 通过 / 1 存在缺口
//
// ★★★2026-10-21 收紧（缺陷来自 #1153 ⑩ 的顺手取证）：原判据有一条**假绿通道**——
//   「命令里的脚本路径出现在 CI 文本里」就算接线。后果两类：
//     ① **共享入口**：`packages/cli/src/index.ts` 被 CI 广泛提及（不同子命令各一行）⇒
//        经它实现的 `check:*`（如 `npx tsx packages/cli/src/index.ts knowledge check`）
//        **在真加 CI 步骤前就判"已接线"**；
//     ② **注释提及**：`CI_TEXT.includes(name)` 会把注释里的 `check:foo` 当接线证据——
//        实测 `check:baseline-freshness` 就是靠 ci.yml 那行「**非门禁**（…不入 CI）」的注释
//        被判已接线（而它的脚本头也写明"退出码恒 0，非门禁"）。
//   ⇒ 判定逻辑抽到 `scripts/lib/gates-sync.mjs`（纯函数、可测），口径见该文件头。
//     本脚本只负责 IO + 报告。CI 侧「关键步骤存在性」也改判 **run 命令**（注释不算）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditLocalOnly, extractRunCommands, isCovered, refsOf } from './lib/gates-sync.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WF_DIR = path.join(ROOT, '.github', 'workflows')

/**
 * 合理「仅本地」的门禁（不在 CI 跑），每条必须给理由。
 * ★判定标准：CI 无法满足其前置条件（需已部署环境 / 需人工介入 / 需真机）。
 */
const LOCAL_ONLY = {
  // ★需 macOS + Xcode 工具链（swiftc / JavaScriptCore）——CI 跑在 ubuntu-latest，无法执行。
  //   覆盖：iOS 竖切 M1 链路（Vue → Dispatcher → native 后端 → JSC 桥 → 宿主树）。
  'check:ios-host': '需 macOS + Xcode（swiftc/JavaScriptCore）；CI 为 ubuntu-latest',
  'check:ios-perf': '同上（性能基线需真实 JavaScriptCore；真机数字另需模拟器/设备）',
  'check:ios-exp-compile': '实验代码（模拟器/真机两变体）可编译性；需 Xcode 工具链（CI 为 ubuntu-latest）',
  // ★iOS 自绘宿主的类型检查（零设备、零签名）——需 macOS + Xcode（iphoneos SDK）。
  //   背景：`run-selfdraw.sh` 是唯一编译 selfdraw-scene.swift 的地方且需真机+签名
  //   ⇒ 改宿主代码本地无任何检查（实测触发：加自定义字体注册通道时）。
  'check:ios-selfdraw-compile': '需 macOS + Xcode（iphoneos SDK 做 swiftc -typecheck）；CI 为 ubuntu-latest',
  // ★决策 #1073：iOS 两份源码清单一致性 + 清单续行形态（纯静态，但检查对象是 macOS 工具链脚本）。
  //   实测事故：#1067/#1069 两轮各漏加一个 .swift 到 run-selfdraw.sh ⇒ 真机 "cannot find X in scope"；
  //   #1067 那轮还用脚本把清单续行写成了 `\\` ⇒ 后续文件全部不参与编译（bash -n 查不出来）。
  // ★玻璃像素等价门禁（决策 #834 · B6）：需 macOS Metal（xcrun swift 编译生成物 MSL 并渲染）——
  //   CI 为 ubuntu-latest、无 Metal ⇒ 归开发机（真机端另有 iOS --glass 截图取证）。
  'check:glass-pixel-parity': '需 macOS Metal（本机渲染生成物 MSL 与 Rust CPU oracle 逐像素比对）；CI 为 ubuntu-latest 无 Metal',
  // ★★鸿蒙玻璃像素等价门禁（决策 #841）：需**真机**（鸿蒙无本机 Vulkan ⇒ 只能真机渲染后拉回比对）；
  //   无设备时脚本自身**跳过并退出 0**（不假红）——与 check:harmony-host-compile 同策略。
  'check:glass-parity-harmony': '需鸿蒙真机（离屏 Vulkan 渲染生成物 SPIR-V 与 Rust CPU oracle 逐像素比对）；CI/无设备自动跳过',
  // ★Studio 投屏解码门禁（决策 #1284 登记）：要**真 Android 设备 + 已打包的 .app**，
  //   判的是"真机跑几秒、零解码错误、出帧数是正数"——CI 没有设备，接了只会得到 skip。
  //   ★它在无设备时自己打一行原因并 rc=0（不造假红），所以本地/CI 都能安全调用。
  'check:studio-live': '需真 Android 设备 + 已打包 .app（真机解码健康度）；无设备自动跳过',
  // ★Studio 设备源抓帧门禁（决策 #1340 登记）：判的是"镜像窗口/模拟器窗口**真的能抓到帧**"。
  //   前置是 macOS + 屏幕录制权限 + 已连接镜像/已启动模拟器；CI 全都没有。
  //   ★而且**同一窗口不能被两个 SCK 客户端同时抓** ⇒ Studio 在跑时脚本自动跳过（不造假红）。
  'check:studio-capture': '需 macOS + 屏幕录制权限 + iPhone 镜像已连/模拟器已启动；占用或缺失自动跳过',
  // ★CLI iOS 宿主模板编译检查（2026-10-08，check:ios-selfdraw-compile 的姊妹盲区）：
  //   它检查**框架参考宿主**；CLI 生成宿主的**壳模板**（templates-host/ios/shell/*.swift）此前无任何本地判据
  //   ⇒ 改模板只能等真机打包才发现编译错。同样需 macOS + Xcode。
  'check:ios-cli-host-compile': '需 macOS + Xcode（iphoneos SDK 做 swiftc -typecheck）；CI 为 ubuntu-latest',
  // ★★★iOS 工具链解析门禁（2026-10-22 · 决策 #1179）：判「有能力完备的 Xcode 时是否选中它」
  //   + 「候选清单是否覆盖非默认安装位」+ 「hosts/ios 下不得绕过解析器手写 Xcode 路径」。
  //   ★为什么归 LOCAL_ONLY：判据对象是**本机的 Xcode 安装布局**——CI 上根本没有 Xcode
  //     （ubuntu-latest），跑它只会得到"未找到任何 Xcode"这种与结论无关的失败。
  //   背景（这条门禁存在的原因）：我手写 `/Volumes/data1/applications/Xcode.app`（14.2，无 devicectl）
  //   ⇒ 据此断言"本机没有 devicectl"，而 26.5 一直装在 `/Volumes/data1/work/office-applications/`
  //   ⇒ 这条教训在 AGENTS.md 表格里**早就写着**我还是重犯 ⇒ 必须做成能跑的命令。
  'check:ios-xcode': '判本机 Xcode 安装布局（能力完备优先 + 非默认卷覆盖）；CI 无 Xcode，跑它只会得到无关失败',
  // ★★「提交 ≠ 交付」门禁（2026-09-28 新增，背景：一天 111 个提交漏推送 —— 用户指出）。
  //   CI 里跑它**没有意义**：CI 的 checkout 是 detached HEAD（或 `refs/pull/*`），
  //   "本地领先 upstream N 个提交"这个状态在 CI 中天然为 0 ⇒ **恒绿，属假门禁**。
  //   它的作用域是**开发机收尾**：`pnpm verify` 结束时提醒；收尾用 `check:pushed:strict` 强制。
  //   ⇒ 归入 LOCAL_ONLY 而非接 CI（接了反而给人"CI 在管这件事"的错觉）。
  'check:pushed': '面向开发机收尾；CI 的 detached HEAD 下恒为 0 ⇒ 接 CI 是假门禁',
  'check:pushed:strict': '同上（strict 只是把提醒改为 exit 1，供收尾显式调用）',
  // ★★「含官网改动 ≠ 官网已上线」门禁（2026-09-29 新增，背景：9 个 website 提交无 [deploy] 标记，
  //   线上停在 2026-09-27 —— 用户指出）。CI 里跑它**没有意义**：CI 的 checkout 正是"被部署的那棵树"，
  //   "[deploy] 之后有无 website 改动"在 CI 视角天然自洽（且 dev 分支形态下结论失真）⇒ 假门禁。
  //   它的作用域是**开发机收尾**：`pnpm verify` 末尾提醒；发布收尾用 strict 强制。
  'check:deploy-pending': '面向开发机收尾（本地 git 历史中 [deploy] 之后 website/** 是否仍有改动）；CI 视角天然自洽 ⇒ 假门禁',
  'check:deploy-pending:strict': '同上（strict 只是把提醒改为 exit 1，供发布收尾显式调用）',
  // ★★lockfile 同步门禁（2026-10-08 新增，背景：lockfile 与某 workspace package.json 失同步 ⇒
  //   **官网/CI 已连续多轮静默未部署**——pages.yml 安装步 `--frozen-lockfile` 直接失败、
  //   后续 step 全 skipped，而 run conclusion 仍常显示 success）。
  //   ★CI 的「安装」步（`pnpm install --frozen-lockfile`）**已是同一判据** ⇒ 接 CI 是重复执行。
  //   本条补的是**本地 pre-push 盲区**：本地 `pnpm install`（非 frozen）会**静默把 lockfile 改对**，
  //   开发机永远看不到漂移 ⇒ 只有在 `verify` 里显式跑一次，才在推送前拦下。
  'check:lockfile-sync': '判据 = CI 安装步同一条命令（`pnpm install --frozen-lockfile`）⇒ CI 已覆盖；本条补本地 pre-push 盲区（本地非 frozen install 静默修正 lockfile）',
  // ★★★G-61 B5 基准守护（2026-10-05）：`:strict` 变体是**收尾显式调用**（与 check:pushed:strict 同族）——
  //   CI 侧跑的是**非 strict** 版（有 diff 才判审批留痕）；strict 供发布收尾强制。
  'check:baseline-approval:strict': '同上（strict 只是把提醒改为 --require，供收尾显式调用）',
  // ★G-61 后批：App 端 IR 影子对账——测量装置（非门禁：它**产出对账数据**供切换决策，
  //   不对"是否一致"判红——两路不一致是**待切换项**，不是缺陷）。切换执行后它会自然收敛。
  'check:app-ir-shadow': '测量装置（切换决策取数）：输出两路差异分类，不判红（plan §2.2 切换期语义）',
  // ★CSS 全量能力清单（用户指定）：mdn-data 源在**本机依赖树**（node_modules/.pnpm）——
  //   CI 上 install 后同样存在 ⇒ 本可接 CI；但它是**超大产物**（949 项），与"改一次刷一次"的
  //   生成物同族（沿 check:binding-matrix / gap-report 先例）：改编译器/能力面后本地跑一次即可。
  'check:css-inventory': '生成物基线类（949 项清单；mdn-data 源在依赖树）+ 改能力面后本地刷一次，避免 CI/本地各红一次',
  // ★卡 I2「平台层零舍入」静态门禁（2026-09-29 新增）。扫描面是 **hosts/**（Android/iOS 宿主源码）——
  //   那部分不参与 CI 的 TS 构建（真机宿主需 NDK/Xcode），CI 上跑它只会扫到空集 ⇒ 假门禁。
  //   它的作用域是**开发机**：改宿主代码后立刻拦下"平台侧再舍入一次"。
  'check:host-rounding': '扫描 hosts/（Android/iOS 宿主源码）★2026-10-22 复核更正：原文"CI 不构建宿主 ⇒ 扫不到文件"不成立——hosts/** 是入库源码，本机实测扫 117 个文件；CI 也能扫，留本地属政策（扫源码 ≠ 构建宿主）',
  // ★★★宿主内核键门禁（2026-10-06 · css:next justify-self 项配套）：从内核 style_from_dto 推出消费键，
  //   断言 Android 宿主白名单覆盖（漏登记 = 请求树不带 = 内核静默用默认——本仓已三次踩同款）。
  //   与 check:host-rounding 同族：宿主侧门禁，开发机跑（CI 无宿主构建语境）。
  'check:host-kernel-keys': '宿主侧键契约门禁（内核 ffi.rs ↔ Android 宿主白名单）——与 check:host-rounding 同族（开发机跑）',
  // ★★★iOS styleOf 透传覆盖门禁（决策 #650）：宿主侧门禁（扫 selfdraw-scene.swift 的 styleOf 白名单 ↔ 消费键）
  //   ——与 check:host-kernel-keys 同族（hosts/ 宿主源码，CI 无宿主语境不跑）。
  //   ★与 check:ios-selfdraw-compile（需 Xcode）不同：本门禁是**纯静态文本扫描**（零 Xcode/零设备）——
  //     本可入 CI，但为与 host-kernel-keys 同族语义一致（命门在宿主源码），统一归开发机 verify 链。
  'check:ios-style-keys': 'iOS 宿主 styleOf 白名单 ↔ 消费键覆盖门禁——与 check:host-kernel-keys 同族（开发机跑；纯静态扫描，零 Xcode）',
  // ★★★内置环境变量门禁（决策 #593）：与 check:host-rounding / check:host-kernel-keys 同族（跨宿主源码 + Web 基础样式事实核对，开发机跑；需先 build-packages）
  'check:env-vars': '内置 CSS 环境变量四同步门禁（契约 + 编译器两路径 + 一致性三端 + 三端宿主 + Web 基础样式）——与 check:host-rounding 同族（开发机跑，需 dist）',
  // ★★★屏切换通路纯函数门禁（2026-10-20 · #1144）：真跑鸿蒙 screen.mount 用的三个纯函数
  //   （env token 替换 / 合成根重映射 / 单个 token 求值）+ **逐字节比对** runner 副本与源头。
  //   背景：executor 的 exec_content_nodes 长期为 0，根因是"两条建树通路只修了一条"，且首版修复
  //   自己还带 off-by-2（三种输入全不生效）——**只 grep 调用点永远发现不了**，必须真跑函数。
  //   与 check:invoke-wire-parity 同族：纯本机 C++（clang++），零设备零 OHOS sysroot ⇒ CI 也可跑，
  //   但按该族先例（改宿主后本地跑一次即可）归开发机。
  'check:screen-mount-helpers': '鸿蒙 screen.mount 纯函数门禁（env 替换 + 合成根重映射，真跑 14 条用例 + runner 防漂移比对）——与 check:invoke-wire-parity 同族（开发机跑，零设备）',
  // ★★★真机证据「入库即不得缺失」门禁（2026-10-20 · #1146）：从 package.json 的 check:* 命令
  //   自动推导被引用的 hosts/*/results/*.json（当前 19 条），断言①存在 ②已入库。
  //   背景：六条判据（app-stack / mount-layers / host-runtime / kernel-anim / platform-anim / embed-demo）
  //   在产物缺失时一律 "return 0（诚实跳过）"——而那句假设（"真机产物开发机上没有属正常"）
  //   在产物**全部入库**后已不成立：缺失只剩"被删/损坏"⇒ git rm 一下门禁就变绿。
  //   ★需 git 工作树（判 tracked）⇒ 归开发机；CI 的 checkout 亦满足，但按本族先例归本地。
  'check:evidence-tracked': '真机证据入库完整性门禁（19 条被 check:* 引用的产物：存在 + tracked）——与 check:app-screen-content 同族（开发机跑，需 git 工作树判 tracked）',
  // ★★★流式通道双端真机证据门禁（2026-10-20 · #1148）：Android/iOS 的 stream-probe.json
  //   必须都在库 + 内容达标（逐块到达/字节数/错位 0/seq 连续）+ **背压必须真触发过**。
  //   背景：#1118 的 commit 写着「双真机全绿 · iOS 11/11」，但 iOS 读数写进了 superapp.json
  //   （任何一次 superapp 运行都会覆盖、且未入库）⇒ 结论只在 commit message 文字里，无法复核。
  //   ★鸿蒙流式 unsupported（一次性 VM 限制）⇒ 只要求两端，不拿做不到的端当判据。
  //   与 check:evidence-tracked 同族（开发机跑：需真机产物 + git 工作树）。
  'check:stream-evidence': '流式通道双端真机证据门禁（逐块/字节/错位/seq + 背压真触发）——与 check:evidence-tracked 同族（开发机跑，需真机产物）',
  // ★★★HTTP 条件请求缓存双端真机证据门禁（2026-10-21 · #1149）：Android/iOS 的 cache-probe.json
  //   必须都在库 + 达标（新鲜命中时**服务端零请求** / 条件头真发出 / 304 合成 200 / no-store 不缓存 / 零回归）。
  //   背景：Node 层判据跑在 undici 上，而 undici 不做 HTTP 缓存 ⇒ 只能证明"框架层语义"；
  //   真机两端**行为不同**（Android 裸连接不缓存；iOS 的 URLCache 会把 304 合成 200 甚至直接回本地副本）
  //   ⇒ 必须两端各跑一次，并以**服务端记账**为准。
  //   ★鸿蒙 RCP 同步往返不做条件缓存（只剔除内部头）⇒ 只要求两端，不拿做不到的端当判据。
  //   与 check:stream-evidence 同族（开发机跑：需真机产物 + git 工作树）。
  'check:cache-evidence': '条件请求缓存双端真机证据门禁（新鲜命中零请求 / 条件头 / 304 合成 / no-store / 零回归）——与 check:stream-evidence 同族（开发机跑，需真机产物）',
  // ★★★hosts 关注点分层门禁（2026-10-07 · 用户「宿主里项目信息与项目无关抽象混在一起」）：
  //   校验三端 runtime/shell/dev 三层齐备 + runtime 无反向依赖 + 无被跟踪产物。
  //   与 check:host-rounding / check:host-kernel-keys 同族：宿主侧门禁，开发机跑（CI 无宿主源码语境）。
  'check:host-layering': '宿主侧分层门禁（三端 runtime/shell/dev + runtime 无反向依赖 + 无被跟踪产物）——与 check:host-rounding 同族（开发机跑）',
  // ★★★宿主关注点分离台账门禁（2026-10-09 · 用户「先把宿主关注点分离完全打通，不留遗留项」）：
  //   校验 docs/proteus-host-separation-ledger.md 自洽（已落地项判据真实存在 · 进行/未做写明范围 · 范围外给理由 · 必需行在场）。
  //   与 check:host-layering 同族（宿主侧门禁，开发机跑——CI 无宿主源码/台账语境差异）。
  'check:host-separation-ledger': '宿主关注点分离完成度台账自洽门禁——与 check:host-layering 同族（开发机跑）',
  // ★★★宿主 invoke 方法契约（B2·G4）：各端声明 ⊆ 契约 + screen.* 三端一致 + 覆盖率如实。
  //   与 check:host-layering 同族（宿主侧门禁，开发机跑）。
  'check:host-invoke-contract': '宿主 invoke 方法契约门禁（screen.* 一致 + 能力 ⊆ 契约）——与 check:host-layering 同族（开发机跑）',
  // ★★★tab 栏规格防回归（B2·G6）：三端读共享规格 + 无硬编码图标/标签映射（同族：宿主侧门禁）。
  'check:host-tab-spec': 'tab 栏规格防回归门禁（三端读共享规格 · 无硬编码图标/标签）——与 check:host-layering 同族（开发机跑）',
  // ★C3 编译期基线：绝对毫秒跨机不可比（本仓既有认识：异构 CI 同机可达 1.6×），
  //   判据虽以比值为主（体积膨胀比），但全量/增量仍带宽松绝对上界 ⇒
  //   在 CI 共享 runner 上会因机器差异产生噪声红。⇒ 归**开发机**：改编译器后本地跑。
  'check:compile-baseline': '绝对耗时跨机不可比（阈值含 3× 宽松上界）；CI 共享 runner 波动会产生噪声红 ⇒ 开发机跑',
  // ★V2 绑定矩阵：生成物依赖 **showcase 全量编译**（128 文件，约 3 秒）+ 依赖 compiler dist。
  //   CI 上需先 build-packages（本仓已有该步），但生成物本身入库 ⇒ CI 只需 --check（比对），
  //   实测 --check 也需重跑编译（约 3 秒）⇒ 可以接 CI。★但为与 compile-baseline 一致（同一族基线类门禁），
  //   暂归开发机：避免"改编译器后 CI 与本地各红一次"的低效流程。
  'check:binding-matrix': '与 check:compile-baseline 同族（生成物基线类）；改编译器后本地跑一次即可，避免 CI/本地各红一次',
  // ★C4 漏点报告：与上两者同族（生成物基线类，依赖 showcase 全量编译 ~40s）。
  //   ★且它是**棘轮**（degraded/unsupported 只降不升）——新写法引入 degraded 时本地立刻可见，
  //   不必等 CI；改编译器诊断文案后需 --update（人工确认）。
  'check:gap-report': '与 check:binding-matrix 同族（生成物基线棘轮）；依赖 showcase 全量编译，开发机跑',
  // ★S1/S2（Android JS 引擎）：需 `.tools/quickjs`（下载获取）+ NDK 交叉编译产物。
  //   CI（ubuntu）没有这两者；且该引擎是 **Android 宿主专用**，CI 上跑无意义。
  'check:js-engine-build': '需 .tools/quickjs（下载获取）+ NDK 交叉编译产物；CI 为 ubuntu-latest ⇒ 跑不了',
  'check:js-engine': '需 .tools/quickjs/qjs（本机引擎）；CI 无该环境 ⇒ 归开发机（真机前先过它，再上 S3）',
  // ★指令流夹具漂移门禁：生成器需跑真实 TS 编码器 + 适配器（依赖 build-packages dist）。
  //   ★且它在 `build-and-run.sh` 里**每次构建都会重生成** ⇒ 真机测试抓不到漂移（只有"克隆后不构建"才踩到）。
  //   归开发机：改协议/编码器后本地跑一次即可（CI 上跑需完整 dist 链，成本高于收益）。
  'check:ops-fixture': '生成器依赖 TS 编码器 + 适配器（需 build-packages dist）；且漂移只在"克隆后不构建"时踩到 ⇒ 开发机跑',
  // ★16 KB 对齐门禁（2026-09-29，用户真机反馈触发）：需 NDK（llvm-readelf）+ Android 构建产物。
  //   CI（ubuntu）无 NDK 与 hosts/android 产物 ⇒ 跑不了；开发机在"改宿主/链接参数后"跑。
  'check:16kb-align': '需 NDK（llvm-readelf 读 ELF 段对齐）+ hosts/android 构建产物；CI 无该环境',
  // ★shell 变量边界门禁（$VAR<全角> 会被 bash 当变量名一部分）：纯静态扫描、**不依赖构建**。
  //   ★本可接 CI，但它扫的是 hosts/**/*.sh（CI 不怎么跑那些）——归开发机与 16kb 一并跑即可。
  'check:shell-i18n-vars': '扫 hosts/**/*.sh 的静态门禁；与 check:16kb-align 同批在开发机跑（改脚本后）',
  // ★S3b bundle 构建门禁：需 build-packages dist（render-backend）+ 产物断言。
  //   与 check:js-engine 同族（Android JS 链路的零设备判据）。
  // ★Android 宿主编译检查（2026-09-29，与 check:ios-selfdraw-compile 同源盲区）：
  //   编译宿主需 Android SDK（android.jar）+ JDK；CI 为 ubuntu-latest，不装 Android SDK ⇒ 跑不了。
  'check:android-host-compile': '需 Android SDK（android.jar）+ JDK 17；CI 为 ubuntu-latest，未装 Android SDK',
  // ★鸿蒙宿主编译检查（2026-10-11，android-host-compile 的鸿蒙姊妹）：用 DevEco 自带 OHOS clang
  //   做 -fsyntax-only；CI 为 ubuntu-latest，无 DevEco/OHOS SDK ⇒ 跑不了（本地有则真检查，无则跳过 0）。
  'check:harmony-host-compile': '需 DevEco Studio 自带 OHOS clang（aarch64-linux-ohos）；CI 为 ubuntu-latest，未装 DevEco',
  // ★平台动画判据（容器级 + 逐节点）：**输入是真机产物**（platform-anim*.json，由 adb pull 取回）
  //   且 App 是**广播触发**（需真机 + adb）⇒ CI 无法执行。它的配套是"零设备也能守"的
  //   `check:android-host-compile`（宿主代码可编译）+ `check:acceptance-stub`（装置可用），
  //   三者分工：编译守形态 / 桩测守装置 / 本条守真机行为。
  'check:android-platform-anim': '需真机产物（adb pull 的 platform-anim*.json）；CI 无设备',
  // ★内核驱动动画判据（曲线/序列/滚动/共享元素/真帧循环）：同族——输入是真机产物，CI 无设备。
  'check:android-kernel-anim': '需真机产物（adb pull 的 kernel-anim.json）；CI 无设备',
  // ★★Kairos 灯光秀（第二个炫技节目 · 800 灯颜色编舞，2026-10-01）——需真机产物
  //   （adb pull 的 lights.json：QuickJS 节目驱动 + Choreographer 帧循环读数）；CI 无设备。
  //   本机侧等价判据 = tests/showcase-lights.test.ts（11 幕 / 颜色链 / 7200 峰值，CI 覆盖）。
  'check:android-lights': '需真机产物（adb pull 的 lights.json）；CI 无设备（本机侧等价判据 = tests/showcase-lights.test.ts）',
  // ★★Kairos 翻牌剧场（第三个节目 · A/B 批新能力验收，2026-10-01）——需真机产物
  //   （adb pull 的 flip.json：慢动作 wall/span 比值 + 3D 逐幕终态，CI 无设备无法复现）。
  //   本机侧等价判据 = tests/showcase-flip.test.ts（8 幕 / 能力计数 / 控制链，CI 覆盖）。
  'check:android-flip': '需真机产物（adb pull 的 flip.json）；CI 无设备（本机侧等价判据 = tests/showcase-flip.test.ts）',
  // ★★Kairos 墨绘·山水卷（第四个节目 · C1 裁剪揭示 × C2 SVG 描边，2026-10-01）——需真机产物
  //   （adb pull 的 ink.json：幕中描边"进行中"探针 + 裁剪逐幕揭示终态，CI 无设备无法复现）。
  //   本机侧等价判据 = tests/showcase-ink.test.ts（11 幕 / 双能力计数 / 裁剪链 / 构建态律，CI 覆盖）。
  'check:android-ink': '需真机产物（adb pull 的 ink.json）；CI 无设备（本机侧等价判据 = tests/showcase-ink.test.ts）',
  // ★★长卷探索（滚动驱动 · 2026-10-01）：需**真机手势**产物（adb pull 的 ink-scroll.json，
  //   含手势区间/长卷位移/分段揭示读数）；CI 无设备。本机侧 = tests/showcase-ink.test.ts 的长卷段。
  'check:android-ink-scroll': '需真机手势产物（adb pull 的 ink-scroll.json）；CI 无设备（本机侧等价判据 = tests/showcase-ink.test.ts 长卷段）',
  // ★★M5 路由虚拟栈判据（2026-09-30 新增）：与 kernel-anim 同族——输入是真机产物 app-stack.json。
  //   端上读数（在 QuickJS 上跑**真实 app-stack.ts**：2 万层深栈 / 预算冻结 / 命令守恒）无法在 CI 复现
  //   （CI 无设备、无宿主 APK）；本机侧的等价逻辑判据已在 tests/app-stack.test.ts（34 条，CI 覆盖）。
  'check:app-stack': '需真机产物（adb pull 的 app-stack.json）；CI 无设备（本机侧等价判据 = tests/app-stack.test.ts）',
  // ★★GP3-c 三层挂载判据（2026-10-03 新增）：与 app-stack 同族——输入是真机产物
  //   （adb pull 的 mount-layers.json：层容器数/树序/全屏@原点/零权限）。CI 无设备；
  //   本机侧等价判据 = tests/mount-layers.test.ts（16 组，纯契约可跑，CI 覆盖）。
  'check:mount-layers': '需真机产物（adb pull 的 mount-layers.json）；CI 无设备（本机侧等价判据 = tests/mount-layers.test.ts）',
  // ★Kairos 炫技场（800 瓦片三段编舞）——需**真机**产物（iOS 宿主帧循环 + CADisplayLink 读数）；
  //   CI 无设备。本机侧等价判据 = 单测（tests/showcase-*.test.ts，校验编舞指令的真编译产物）。
  'check:showcase': '需真机产物（iOS showcase.json + 收尾截图）；CI 无设备、无 Xcode',
  // ★★双端几何一致性判据（2026-10-01 新增，收「跨端视觉一致性」边界的可判定部分）：
  //   输入是**两端真机产物**（iOS layout-core-conformance.json + Android layout-conformance.json，
  //   各含内核算出的 `geometry_digest`）——CI 无设备 ⇒ 跑不了。
  //   ★本机侧等价保护（都在 CI）：内核单测 `geometry_digest_is_deterministic_and_sensitive`
  //   （确定性 + 敏感性 + 破坏性验证）+ `check:cross-end-golden`（纯静态，守两端 golden 同源）。
  // ★颜色跨语言 golden（2026-10-01）：它**就是** `npx vitest run tests/anim-color-golden.test.ts`
  //   ——已由 CI 的 `pnpm test`（全量 vitest）覆盖，故不必再单独接一条（接了是重复执行）。
  'check:anim-color-golden': 'vitest 定向跑的包装（同一文件已在 CI 的 pnpm test 全量覆盖）⇒ 无需单独接线',
  'check:cross-end-geometry':
    '需两端真机产物（各跑 conformance 后取回）；CI 无设备（本机侧等价 = 内核单测 geometry_digest_* + check:cross-end-golden）',
  // ★★G-39 宿主运行时判据（2026-09-30 新增）：与上两条同族——输入是真机产物
  //   （host-runtime.json + host-shell.json）。端上读数（QuickJS 上跑真实 quickjs-host.ts：
  //   生命周期状态机 / 真实 Activity 壳转发 / job 泵 / 引擎 JS 堆内存账本 / G-41 conformance
  //   用真实运行时替换 stub）无法在 CI 复现（CI 无设备、无宿主 APK、无 QuickJS .so）。
  //   本机侧等价判据 = tests/quickjs-host.test.ts（18 条，CI 覆盖，含 conformance 32/32）。
  'check:host-runtime': '需真机产物（adb pull 的 host-runtime.json + host-shell.json）；CI 无设备（本机侧等价判据 = tests/quickjs-host.test.ts）',
  // ★HA5：AAR 构建（需 NDK + JDK17；CI 为 ubuntu-latest 未装 NDK）。★注意它**不是**"读产物"型门禁：
  //   它每次都**真构建**并断言 AAR 的四条内容判据（manifest/classes.jar/jni/R.txt + 符号齐备）。
  'check:host-abi-aar': '需 NDK + JDK17 交叉编译；CI 无 NDK',
  // ★HA5：嵌入 demo 判据（输入是真机产物 embed-demo.json）。
  'check:embed-demo': '需真机产物（adb pull 的 embed-demo.json）；CI 无设备',
  // ★hook 接线检查（2026-09-29）：CI 上 `.zcode/config.json` 不存在（gitignored）⇒ 该门禁
  //   走"未安装但给出指引"分支并**返回 0**（不判红是刻意的：CI 本来就不需要本地 hook）。
  //   ⇒ 归入"仅本地"是因为**它的判据只在本地才有意义**（CI 恒为"未安装"）。
  'check:hook-wiring': '检查本地 .zcode/config.json 的三条红线 hook 接线；CI 无该文件（走"给出安装指引"分支，恒通过）',
  // ★★★跨语言二进制线格式对拍（2026-10-13 · 决策 #903 / T-app-wire）：守的是 **Android 宿主侧 Java 实现**
  //   （`InvokeWire.java`）与 TS SSOT（`packages/api/src/invoke-wire.ts`）的**逐字节等价**。
  //   · 与 check:android-host-compile / check:host-invoke-contract 同族：宿主侧契约门禁，开发机跑；
  //   · ★它**不需要**真机、不需要 Android SDK —— 只要本机 JDK（`javac` 纯 JVM 编译，已在开发机实测：
  //     24 条黄金向量全绿 + 4 类破坏性验证均能红）。⇒ 若将来要接 CI，加一步 `actions/setup-java`
  //     即可（本行就是那句提示；当前未接是因为 CI 未声明 JDK 前提，接了会有"环境缺失型红"）。
  'check:invoke-wire-parity': '宿主侧线格式契约门禁（Java 实现 ⇄ TS SSOT 逐字节等价；★2026-10-13 追加 Swift 轮 ⇒ 完整覆盖需 macOS 的 Swift 工具链，非 macOS 上该轮**响亮跳过**并在输出标注）——与 check:android-host-compile 同族（开发机跑，零设备零 Android SDK，仅需本机 JDK）',
  // ★★iOS 二进制腿**端到端**门禁（2026-10-13 · 决策 #904，与 parity 门禁**分层**）：
  //   parity 门禁守"各端编解码器是否逐字节等价"（静态向量对拍）；本门禁守"**桥的通路跑得通吗**"
  //   ——在 macOS 的**真实 JSC** 上把字节搬过去再搬回来（去程全字段 / 回执是 Uint8Array 而非 Array /
  //   回推逐字节一致 / 1MB 大载荷 / 坏入参必须抛）。
  //   · 为什么必须独立一条：JSC 的 `JSObjectGetTypedArrayBytesPtr` 返回**临时指针**、
  //     `Uint8Array` 与 `Array` 跨边界后长相相似、C 回调签名差一个可选性就拒编——
  //     这些**只有真跑一次才暴露**，静态 grep 判据（check:no-json-wire）证明不了。
  //   · 需 macOS + Swift 工具链（CI 为 ubuntu-latest ⇒ 不接 CI；与 check:ios-cli-host-compile 同族）。
  'check:ios-invoke-bytes': '需 macOS + Swift 工具链（xcrun swiftc + 真实 JavaScriptCore）；CI 为 ubuntu-latest，无 Swift',
  // ★★★基准腐化检测（2026-10-21 补登）：**脚本自身声明"非门禁"**——判据是"活体 Web 重采集
  //   与入仓基准比对"，需要真浏览器；CI 共享 runner 的浏览器版本天然与基准指纹不一致
  //   ⇒ 每次提交都报"环境漂移"，而**退出码恒 0**（除非自身出错）⇒ 接 CI 也不能拦任何东西。
  //   ★它此前是怎么"绿"的：CI 里那行注释 `# ——腐化检测（check:baseline-freshness）**非门禁**…不入 CI`
  //     被旧口径当成接线证据（`CI_TEXT.includes(name)`）——本轮收紧后如实归入"仅本地"。
  'check:baseline-freshness': '脚本自身声明非门禁（活体 Web 重采集 + 退出码恒 0）；CI 共享 runner 浏览器指纹天然漂移 ⇒ 接 CI 拦不住任何东西（G-61 B5 plan 明示不入 CI）',
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

/**
 * ★LOCAL_ONLY 台账的**结构化元数据**（决策 #1159）——与上面 `LOCAL_ONLY`（人类可读理由）**同名同步**。
 * 两维闭合枚举（定义见 `scripts/lib/gates-sync.mjs` 的 `LOCAL_ONLY_CATS` / `LOCAL_ONLY_RUNS`）：
 *   `cat` = 为什么 CI 跑不了/不该跑；`run` = 那它到底由谁跑（能取证的一律取证）。
 * 只有 `cat` 没有 `run` 等于没说清"谁在守"，反之亦然 ⇒ 双向必填（缺一个就红）。
 * 新增一条的正确姿势：先问"能不能接 CI"，不能才登记，并在 cat 里挑**最贴近事实**的那一类。
 */
const LOCAL_ONLY_META = {
  // ── device（需真机/真机产物）──────────────────────────────────────────
  // ★`evidence: 'live'` = 活体设备取证（无 results/*.json，渲染读数当场取）⇒ 不按"缺产物路径"提醒
  'check:glass-parity-harmony': { cat: 'device', run: 'verify', evidence: 'live' },
  'check:stream-evidence': { cat: 'device', run: 'verify' },
  'check:cache-evidence': { cat: 'device', run: 'verify' },
  'check:android-platform-anim': { cat: 'device', run: 'verify' },
  'check:android-kernel-anim': { cat: 'device', run: 'verify' },
  'check:android-lights': { cat: 'device', run: 'verify' },
  'check:android-flip': { cat: 'device', run: 'verify' },
  'check:android-ink': { cat: 'device', run: 'verify' },
  'check:android-ink-scroll': { cat: 'device', run: 'verify' },
  'check:app-stack': { cat: 'device', run: 'verify' },
  'check:mount-layers': { cat: 'device', run: 'verify' },
  'check:showcase': { cat: 'device', run: 'on-device' },
  'check:cross-end-geometry': { cat: 'device', run: 'manual' },
  'check:host-runtime': { cat: 'device', run: 'verify' },
  'check:embed-demo': { cat: 'device', run: 'verify' },
  // 决策 #1284：真机解码健康度（活体取证，无 results/*.json ⇒ evidence: live）
  'check:studio-live': { cat: 'device', run: 'on-device', evidence: 'live' },
  // 决策 #1340：设备源抓帧（活体取证，结果只在运行时存在 ⇒ evidence: live）
  'check:studio-capture': { cat: 'device', run: 'on-device', evidence: 'live' },
  // ── macos（需 Xcode / Swift / Metal / JSC）───────────────────────────
  'check:ios-host': { cat: 'macos', run: 'manual' },
  'check:ios-perf': { cat: 'macos', run: 'on-device' },
  'check:ios-exp-compile': { cat: 'macos', run: 'manual' },
  'check:ios-selfdraw-compile': { cat: 'macos', run: 'manual' },
  'check:glass-pixel-parity': { cat: 'macos', run: 'verify' },
  'check:ios-cli-host-compile': { cat: 'macos', run: 'manual' },
  // ★★★#1179：判**本机**的 Xcode 安装布局（哪个版本有 devicectl / 非默认卷是否覆盖），
  //   由 `pnpm verify` 在开发机上跑；CI 无 Xcode ⇒ 只会得到与结论无关的失败。
  'check:ios-xcode': { cat: 'macos', run: 'verify' },
  'check:ios-invoke-bytes': { cat: 'macos', run: 'manual' },
  // ── sdk（Android SDK/NDK/JDK · DevEco OHOS SDK）──────────────────────
  'check:js-engine-build': { cat: 'sdk', run: 'verify' },
  // ★2026-10-22（#1161 的 cat 谓词当场抓出的错标）：原来标 `sdk`——但脚本是**纯零设备**验证，
  //   用本机 `.tools/quickjs/qjs` 跑 bundle，脚本自己写着"不需要 Android SDK"；`sdk` 证据为 0。
  //   它依赖的其实是 gitignored 的 `.tools/`（CI 无该目录）⇒ 正确类别是 `local-env`。
  'check:js-engine': { cat: 'local-env', run: 'verify' },
  'check:16kb-align': { cat: 'sdk', run: 'verify' },
  'check:android-host-compile': { cat: 'sdk', run: 'verify' },
  'check:harmony-host-compile': { cat: 'sdk', run: 'verify' },
  'check:host-abi-aar': { cat: 'sdk', run: 'verify' },
  'check:invoke-wire-parity': { cat: 'sdk', run: 'verify' },
  // ── policy（能跑，但**选择**本地跑：省时 / 避免 CI 与本地各红一次）───────────
  //   ★这类原先写成 `host-src`，理由"CI 无宿主源码语境 ⇒ 扫不到文件"——2026-10-22 独立验证
  //     实测不成立：hosts/** 是**入库源码**，CI checkout 后 `check:host-rounding` 能扫到 117 个文件。
  //     政策豁免本身没问题，问题是把"我们选择不跑"写成"CI 跑不了"——后者无法被复核，也会挡住
  //     将来"要不要接 CI"的讨论。⇒ 独立成类，理由与标签都如实。
  'check:host-rounding': { cat: 'policy', run: 'verify' },
  'check:host-kernel-keys': { cat: 'policy', run: 'verify' },
  'check:ios-style-keys': { cat: 'policy', run: 'verify' },
  'check:env-vars': { cat: 'policy', run: 'verify' },
  'check:screen-mount-helpers': { cat: 'policy', run: 'verify' },
  'check:evidence-tracked': { cat: 'policy', run: 'verify' },
  'check:host-layering': { cat: 'policy', run: 'verify' },
  'check:host-separation-ledger': { cat: 'policy', run: 'verify' },
  'check:host-invoke-contract': { cat: 'policy', run: 'verify' },
  'check:host-tab-spec': { cat: 'policy', run: 'verify' },
  'check:shell-i18n-vars': { cat: 'policy', run: 'verify' },
  // ── machine-noise（跨机不可比 / 环境漂移）───────────────────────────
  'check:compile-baseline': { cat: 'machine-noise', run: 'verify' },
  // ── generator（生成物基线类：--check 双模 或 gen:* 对偶）─────────────
  'check:css-inventory': { cat: 'generator', run: 'manual' },
  'check:binding-matrix': { cat: 'generator', run: 'verify' },
  'check:gap-report': { cat: 'generator', run: 'verify' },
  'check:ops-fixture': { cat: 'generator', run: 'verify' },
  // ── closeout（收尾/发布显式调用；基座在 verify）──────────────────────
  'check:pushed': { cat: 'closeout', run: 'verify' },
  'check:pushed:strict': { cat: 'closeout', run: 'closeout' },
  'check:deploy-pending': { cat: 'closeout', run: 'verify' },
  'check:deploy-pending:strict': { cat: 'closeout', run: 'closeout' },
  'check:baseline-approval:strict': { cat: 'closeout', run: 'closeout' },
  // ── covered（已被其他通道等价覆盖）─────────────────────────────────
  'check:lockfile-sync': { cat: 'covered', run: 'verify', also: '--frozen-lockfile' },
  'check:anim-color-golden': { cat: 'covered', run: 'suite', also: 'test' },
  // ── measure（测量装置 / 非门禁）─────────────────────────────────────
  'check:app-ir-shadow': { cat: 'measure', run: 'manual' },
  'check:baseline-freshness': { cat: 'measure', run: 'manual' },
  // ── local-env（依赖本机 gitignored 配置）────────────────────────────
  'check:hook-wiring': { cat: 'local-env', run: 'verify' },
}

/** ★棘轮（只减不增）：新增豁免必须同时抬这个数，diff 里看得见（同 check:file-size 先例） */
// ★2026-10-22 抬 55 → 56（决策 #1179）：新增 `check:ios-xcode`。
//   理由（为什么不能接 CI）：它判的是**本机 Xcode 安装布局**——哪个版本有 devicectl、
//   非默认卷上的安装位是否被候选清单覆盖。CI 跑在 ubuntu-latest，**根本没有 Xcode** ⇒
//   跑它只会得到"未找到可用 Xcode"这种与结论无关的失败，属真·不可接（不是懒得接）。
//   ★这条门禁本身就是"文档拦不住、必须工具化"的产物：我手写了 `/Volumes/data1/applications`
//   （14.2，无 devicectl）并据此说"本机没 devicectl"，而 26.5 一直在线。
// ★2026-10-27 抬 56 → 57（决策 #1284）：新增 `check:studio-live`（Studio 投屏解码健康度）。
//   理由（为什么不能接 CI）：判据是"**真机**跑几秒、零解码错误、出帧数是正数"，前置是
//   （a）插着的 Android 设备 + 屏幕在动，（b）本机已打包的 `build-app/Proteus Studio.app`。
//   CI 两样都没有；且脚本在 `process.platform !== 'darwin'` 与"没有设备/没有产物"时
//   **自己打原因并 rc=0**（设计如此，不造假红）⇒ 接进 workflow 只会永远 skip，
//   那正是本仓最讨厌的"假接线"（给人"CI 在管这件事"的错觉）。
//   ★它放在 `run: 'on-device'`：由开发机在 `pnpm run check:studio-live` 手动跑。
// ★2026-10-28 抬 57 → 58（决策 #1340）：新增 `check:studio-capture`（设备源抓帧能力）。
//   理由同 check:studio-live：判据是活体（要 macOS + 屏幕录制 + 已连镜像/已启动模拟器），
//   CI 一样都没有；且"同一窗口不能被两个 SCK 客户端同时抓" ⇒ Studio 在跑时必须跳过。
const LOCAL_ONLY_MAX = 58

/** 读取所有 workflow 文本（含 pages.yml / consistency.yml 等） */
function workflowFiles() {
  if (!fs.existsSync(WF_DIR)) return []
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(WF_DIR, f))
}
/** ★只认**会被执行**的 run 命令（注释 / name 字段 / env 值一律不算，见 lib 文件头） */
const RUN_COMMANDS = workflowFiles().flatMap((f) => extractRunCommands(fs.readFileSync(f, 'utf8')))
const RUN_TEXT = RUN_COMMANDS.join('\n')

const failures = []
const notes = []

/* ---------- ① 每个 check:* 必须接线（CI 或 LOCAL_ONLY 声明） ---------- */
const checkNames = Object.keys(scripts).filter((k) => k.startsWith('check:'))
const viaCount = { name: 0, file: 0, sub: 0 }
const localOnlyInEffect = []
/** ★已由 workflow 的 run 命令真正执行的 check:*（供 ④ 台账互斥判据用） */
const coveredNames = new Set()
for (const name of checkNames) {
  const r = isCovered({ name, cmd: scripts[name], runCommands: RUN_COMMANDS, scripts })
  if (r.covered) {
    viaCount[r.via] += 1
    coveredNames.add(name)
    continue
  }
  if (name in LOCAL_ONLY) {
    localOnlyInEffect.push(name)
    notes.push(`仅本地（已声明）：${name} —— ${LOCAL_ONLY[name]}`)
    continue
  }
  failures.push(
    `${name} 未接入任何 workflow，也未在 LOCAL_ONLY 声明理由（新增门禁必须接线，或写明为何 CI 跑不了）`,
  )
}

/* ---------- ② verify 链与 CI 的覆盖差集 ---------- */
// verify 里的形态门禁（脚本文件维度）：CI 缺则报；反方向由 ① 覆盖（CI 有的未必在 verify）
const verifyCmd = scripts.verify ?? ''
const verifyRefs = new Set(refsOf(verifyCmd).files)
// 依赖 dist 的步骤：verify 必须含 build-packages + 根 vue-tsc（CI 的强项，本地盲区）
const VERIFY_MUST_HAVE = [
  { file: 'scripts/build-packages.mjs', why: '提供 dist（vue-tsc / 子路径解析需要）' },
]
for (const { file, why } of VERIFY_MUST_HAVE) {
  if (!verifyRefs.has(file) && !verifyCmd.includes(file)) {
    failures.push(`verify 链缺 ${file}（${why}）——CI 有而本地没有 = 本地「全绿」存在盲区`)
  }
}
if (!/vue-tsc/.test(verifyCmd)) {
  failures.push('verify 链缺根 `vue-tsc --noEmit`（CI 有而本地没有 = 类型错误本地不可见）')
}

/* ---------- ③ CI 侧关键步骤存在性（防被误删） ---------- */
// ★2026-10-21：判据从「CI 全文含该串」收紧为「某条 **run 命令**含该串」——
//   注释里写一句"这一步很关键"不该算步骤存在（同 ① 的假绿通道）。
const CI_MUST_HAVE = [
  { pat: 'vue-tsc', why: '根类型检查' },
  { pat: 'build-packages', why: '包构建' },
  { pat: 'audit-component-attrs.mjs', why: '属性棘轮（主标尺）' },
  { pat: 'audit-degradation.mjs', why: '降级声明门禁' },
  { pat: 'check-consistency.js', why: '跨层一致性' },
]
for (const { pat, why } of CI_MUST_HAVE) {
  if (!RUN_TEXT.includes(pat)) failures.push(`CI 缺关键步骤 ${pat}（${why}）——被误删或未接线（注释里提到不算）`)
}

/* ---------- ④ LOCAL_ONLY 台账审计（决策 #1159 / #1161） ---------- */
// 原形态是「写一句理由就永久不进 CI」的自由文本豁免：58/159 条，其中若干**既不在 CI 也不在
// verify**（= 默认流程里谁也不跑它，但报表读起来像"本地有跑"）。此处的判据全部是**能证伪**的：
// 台账齐备 / 枚举合法 / 理由非敷衍 / 声明↔事实互斥 / 通道自证 / 结构自洽 / cat 证据 / 棘轮。
//
// ★`trackedFiles`：`cat='local-env'` 的理由是「依赖本机 gitignored 配置（CI 无该文件）」——
//   可证伪点在于**被点名的路径不能是入库文件**（入库 ⇒ CI checkout 就有）。用 `git ls-files` 取全集；
//   拿不到（非 git 环境/没装 git）就退化成提醒，不假装验证过。
let trackedFiles = null
try {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  trackedFiles = new Set(out.split('\0').filter(Boolean))
} catch {
  trackedFiles = null
}
const ledger = auditLocalOnly({
  localOnly: LOCAL_ONLY,
  meta: LOCAL_ONLY_META,
  scripts,
  coveredNames,
  verifyCmd,
  runText: RUN_TEXT,
  max: LOCAL_ONLY_MAX,
  trackedFiles,
  // ★路径必须落在仓库内且是**文件**：`at:'../../../etc/hosts'` 不该能当证据，
  //   `at:'scripts'`（目录）不该让 readFileSync 抛 EISDIR 把整条门禁打成栈错误（独立验证指出）。
  io: {
    exists: (p) => {
      try {
        const abs = path.resolve(ROOT, p)
        return abs.startsWith(ROOT + path.sep) && fs.statSync(abs).isFile()
      } catch {
        return false
      }
    },
    read: (p) => {
      try {
        const abs = path.resolve(ROOT, p)
        return abs.startsWith(ROOT + path.sep) ? fs.readFileSync(abs, 'utf8') : ''
      } catch {
        return ''
      }
    },
  },
})
for (const f of ledger.findings) {
  if (f.level === 'error') failures.push(`LOCAL_ONLY[${f.name}] ${f.msg}（${f.code}）`)
  else notes.push(`⚠ LOCAL_ONLY[${f.name}] ${f.msg}（${f.code}）`)
}

/* ---------- 报告 ---------- */
console.log('门禁通道一致性检查（CI ⟷ verify）')
console.log(`  package.json 的 check:* 共 ${checkNames.length} 个`)
console.log(`  CI 实际 run 命令 ${RUN_COMMANDS.length} 行（注释/name 字段不计）`)
for (const n of notes) console.log(`  ℹ ${n}`)
if (failures.length) {
  console.error(`\n❌ 发现 ${failures.length} 处接线缺口：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(
  `  ✅ 全部 check:* 已接线（CI 覆盖 ${checkNames.length - localOnlyInEffect.length} 个` +
    `：名字命中 ${viaCount.name} · 脚本命中 ${viaCount.file} · 子脚本 ${viaCount.sub}` +
    `${localOnlyInEffect.length ? `；声明仅本地 ${localOnlyInEffect.length} 个` : ''}）`,
)
console.log('  ✅ verify 链含 build-packages + 根 vue-tsc（本地与 CI 无覆盖盲区）')
console.log('  ✅ CI 关键步骤齐备')
// ★台账分布（决策 #1159）：把"豁免面"按 为何跑不了 / 谁在跑 两维摊开——
//   增长一眼可见；`unverifiable` 那段是**诚实边界**（人工/真机/收尾类判不出是否真跑过）。
const { stats } = ledger
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')
console.log(`  ✅ LOCAL_ONLY 台账：${stats.total} 条（上限 ${LOCAL_ONLY_MAX}）`)
console.log(`     为何跑不了：${fmt(stats.byCat)}`)
console.log(`     由谁执行：${fmt(stats.byRun)}`)
// ★诚实边界：只有 `policy` / `machine-noise` 仍是"标签"（前者是决策、后者是跨机比较，都不可机判）——
//   列出来，别让人误以为都验证过。`macos` / `sdk` / `local-env` 已升级为结构谓词（决策 #1161）。
console.log(`     △ cat 仅标签（无结构谓词，判不出真伪）：${stats.labelOnlyCats.join(' ') || '（无）'}`)
console.log(`     ✓ cat 有谓词（工具链证据 / 入库文件反证）：${stats.predicatedCats.join(' ')}`)
console.log(
  `     △ 不可机判（人工/真机/收尾，${stats.unverifiable.length} 条）：` +
    `${stats.unverifiable.slice(0, 6).join(' ')}${stats.unverifiable.length > 6 ? ' …' : ''}`,
)
console.log(
  '\n✅ 门禁通道一致（接线不再依靠人工记忆；"仅本地"的豁免面已分类可审计）',
)
