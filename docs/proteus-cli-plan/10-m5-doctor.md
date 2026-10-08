# M5 — `proteus doctor`：生产级环境与工程体检

> 状态：**B1–B4 已实现（决策 #686）**——`proteus doctor` 已落地（分组/并行/超时/`--json`/`--report`/`--list`/`--deep`/`--verbose`/`--no-parallel` + 注册表自检门禁 `check:doctor-registry` + CI）；B5（文档/记忆）随本轮
> 版本：v1 · 2026-10-08
> 取代：`03-m3-audit-doctor.md` §4（旧版仅 6 项环境检查，与本篇冲突处以本篇为准；该篇 §1–§3 的 audit 规则引擎部分仍然有效）
> 关联决策：**#685**（本篇 · 编号待并入决策链）· 复用 **#684**（Apollo 诊断核心）· #453/#454（Gate 注册表）· #663（dist 陈旧守卫）
> 关联文档：`docs/Proteus_构建与编译错误语义化诊断方案.md`（Apollo，L0–L4 分层与三条硬约束）

---

## 0. 一句话定位

`proteus doctor` 是**跨端工程的"能不能跑起来"体检器**：一次性、可并行、可机器消费地回答"这台机器 + 这个仓库，现在能不能编译 / 打包 / 调试到 N 个端"，并为每个不通过项给出**首因 + 取证 + 可复制修复命令**。

它不是新的检查逻辑，而是**既有探测能力的统一编排层**——宿主探测（`host-package.ts`）、工程健康（`health.ts`）、依赖与版本对齐（`check-deps` / `check-lockfile-sync` / `check-package-health` / `sync-internal-versions`）、门禁可运行性（`gate.ts`）各自已有实现，doctor 负责**收集、去重、归一呈现、给出口径一致的退出码**。

---

## 1. 对标与取舍（"大厂标准"具体对标什么）

| 参照 | 共性做法 | doctor 采纳 | 不采纳 / 改造 |
|---|---|---|---|
| `flutter doctor` | 分组体检（Toolchain/Devices/IDE）· 每项带可操作建议 · `-v` 出取证 · `--machine` JSON | 分组、建议命令、`--verbose` 取证、`--json` | 不做交互式修复向导 |
| `npx react-native doctor` | 交互式修复菜单 · 环境变量探测 | 检查项覆盖面（JDK/Android SDK/Xcode/watchman 类比） | **不做交互式修复**（见 §9 硬约束④） |
| `npx expo-doctor` | 每项带 `--fix` 自动修 · 退出码参与 CI | 退出码语义、CI 友好 | `--fix` 降级为"打印命令"，见 §7.3 |
| `brew doctor` | 只报不动手 · 输出可复制 | 纯诊断基线 | — |
| 本仓 `gate.ts` | **注册表单一来源** + 统一执行器 + 零逻辑复制 | ★直接用这套范式做检查项注册表 | — |
| 本仓 `diag.ts`（Apollo） | 自建错误码 SSOT · 保留原始全文 · 不猜因 · 不自动修 | ★全部继承，doctor 发现项**共用 `PT-*` 码体系** | — |

**结论**：doctor = `gate.ts` 的注册表范式 + `diag.ts` 的诊断纪律 + `ui.ts` 的输出规范，三者的交汇点。

---

## 2. 与既有命令的边界（本节是设计决策，必须先定死）

现状已有四个"检查类"入口，职责必须显式划清，否则 doctor 会变成第五个重复轮子。

| 命令 | 检查对象 | 回答的问题 | 失败时是否阻断 | 是否可机器消费 |
|---|---|---|---|---|
| `proteus check` | **源码规范**（css/style/router/cli/app-config 五域） | "代码写得对不对" | ✅ error → exit 1 | 部分 |
| `proteus audit all` | **源码六域深度审计**（route/module/api/capability/lifecycle/compile） | "架构有没有越界" | ✅ | `--reporter json` |
| `proteus health` | **工程内产物健康**（结构/产物/appid/workspace 链接） | "这个工程完整吗" | ✅ error → exit 1 | ❌ |
| **`proteus doctor`** | **机器 + 仓库 + 端就绪度**（环境/工具链/依赖/工程/宿主/端口/设备/门禁） | "这台机器现在能不能跑端到端" | ✅ 见 §7.2 | ✅ `--json` / `--report` |
| `proteus gate run <id>` | 上述一切的**统一执行入口** | "跑某一个门禁" | ✅ | 部分 |

**决策 D1：`doctor` 是 `health` 的超集**
`health` 的 8 项（node-version / project-root / node_modules / scripts / app-config / appid / pages-dir / build-output / workspace-links / ide-cli）**全部保留并迁入 doctor 的 `env` + `deps` + `project` 组**，实现上**直接复用 `runHealthCheck()`**（零逻辑复制）。

**决策 D2：`health` 保留为薄壳**
`proteus health [dir]` → 内部转 `doctor --only project`（保持输出格式不变，避免打断既有 CI），并打一行 deprecation 提示：
```
  • proteus health 已并入 proteus doctor（本命令等价于 proteus doctor --only project）——建议迁移
```
理由：仓库已有 workflow / 文档引用 `health`，硬删会静默破坏门禁；薄壳保留一个发布周期。

**决策 D3：doctor 不重复 `check`/`audit` 的职责**
门禁**可运行性**（配置文件可解析、门禁脚本存在、dist 不过期）进 doctor；门禁**结论**（代码违规）不进 doctor。doctor 只回答"门禁能不能跑"，不回答"门禁跑出来是不是绿的"。

---

## 3. 设计原则（对齐本仓铁律）

1. **零逻辑复制**（对齐 `gate.ts`）——检查实现一律**调用既有模块**，doctor 只做编排与归一层。新写探测仅限"目前无人探测过"的项（如端口占用、pnpm 版本）。
2. **检查项是纯函数 + 依赖注入**（对齐 `health.ts` 的 `opts.exists` / `opts.nodeVersion` 范式）——`run(ctx)` 的探测原语从 `ctx` 取，测试零副作用、可离线。
3. **禁用猜测、保留取证、不做自动修复**（对齐 Apollo §3.3 / §7 / §15，`diag.ts` 硬约束 ②③④）——三项直接照抄，无一例外。
4. **非 TTY 零 ANSI**（对齐 `ui.ts`）——doctor 的全部输出复用 `ui.ts` 的 `header/step/ok/info/warn/fail/hint`，重定向与 CI 日志逐行可 grep。
5. **超时是硬要求**——体检会碰 `xcrun` / `adb` / `hdc` / 网络，任何一项都不许挂死整个 doctor。每项可有 `timeoutMs`，缺省 5s，超时降级为 `warn` 并附证据。
6. **能并行就并行**（对齐 AGENTS.md §1）——按组分波并行，`--no-parallel` 仅供调试。
7. **默认不碰网络、默认不跑慢检查**——`devices` 组（可能数秒）默认跳过，需 `--deep` 或 `--only devices` 显式开启；网络探测（npm registry）默认关闭。

---

## 4. 检查项全集（SSOT 草案）

分组 8 个，共 **38 项**（含条件项）。`─` 表示该项在对应 target 未声明时 **skip**（不算通过，也不阻断）。

图例：级别 `E`=error（阻断）· `W`=warn（不阻断）· **慢**=默认跳过（需 `--deep`/`--only`）

### 4.1 `env` — 运行时环境（跨端通用）

| # | id | 检查内容 | 判据 | 级别 | 失败码 | 修复命令 |
|---|---|---|---|---|---|---|
| 1 | `env/node-version` | Node 版本 | ≥ 22.12（`require(ESM)` 门槛，决策 #204） | E | `PT-EE-001` | `fnm install 22` / `nvm install 22` |
| 2 | `env/pnpm-version` | 包管理器 | 版本 == `packageManager` 声明（9.15.9） | E | `PT-EE-002` | `corepack enable && corepack prepare pnpm@9.15.9 --activate` |
| 3 | `env/rust-toolchain` | rustup + cargo | `cargo` 可执行且来自 rustup（`~/.cargo`） | W | `PT-EE-003` | `rustup toolchain install stable` |
| 4 | `env/git-identity` | git user.name/email | 均已配置（发布/提交流程需要） | W | `PT-EE-004` | `git config --global user.email …` |
| 5 | `env/disk-space` | 可用磁盘 | ≥ 5 GB（模拟器 runtime 约 8 GB，见 `hosts/ios/README.md:133`） | W | `PT-EE-005` | 清理磁盘 |

### 4.2 `toolchain` — 工具链就绪度（按端条件启用）

| # | id | 检查内容 | 判据 | 级别 | 失败码 | 修复命令 |
|---|---|---|---|---|---|---|
| 6 | `toolchain/xcode` | 完整 Xcode（非 CLT）+ iOS SDK | `resolveDeveloperDir()` 命中且提供 SDK | E | **`PT-BE-001`**（复用） | 装完整 Xcode；非默认位设 `PROTEUS_DEVELOPER_DIR` |
| 7 | `toolchain/xcode-devicectl` | `xcrun devicectl` | 存在（Xcode ≥ 15） | E | `PT-BE-001` | 升级 Xcode |
| 8 | `toolchain/android-jdk` | JDK 17 | `.tools/jdk17` 存在，或 `JAVA_HOME` 指向 `java -version` = 17.x | E | **`PT-BE-002`**（复用） | 见 `hosts/android/README.md` §前置（`.tools/jdk17`） |
| 9 | `toolchain/android-sdk` | SDK + `aapt2`/`d8`/`apksigner`/`adb` | 四件套齐全 | E | **`PT-BE-002`**（复用） | 装 build-tools/platform-tools；确认 `ANDROID_HOME` |
| 10 | `toolchain/android-ndk` | NDK r27c | `.tools/ndk` 存在（16KB 对齐另由 `check:16kb-align` 负责） | W | `PT-EE-006` | 见 `hosts/android/README.md` §前置 |
| 11 | `toolchain/harmony-deveco` | DevEco Studio ≥ 6.1.1 | `hvigorw` / `ohpm` 可执行 | E | `PT-EE-011` | 安装 DevEco Studio |
| 12 | `toolchain/harmony-hdc` | hdc ≥ 3.2.0d | 版本比对（旧版与 HarmonyOS 7 协议不兼容，`hosts/harmony/README.md`） | E | `PT-EE-013` | 用 DevEco 自带 hdc |
| 13 | `toolchain/wechat-devtools` | 微信开发者工具 CLI | `resolveMpIdeCli()` 命中 | W | `PT-EE-010` | `export PROTEUS_IDE_CLI=…` |
| 14 | `toolchain/js-engine` | QuickJS 产物 | `.tools/quickjs` 存在（`verify-js-engine.mjs` 判据） | W | `PT-EE-007` | `bash scripts/setup-android-js-engine.sh` |

### 4.3 `deps` — 依赖与版本一致性

| # | id | 检查内容 | 判据 | 级别 | 失败码 | 修复命令 |
|---|---|---|---|---|---|---|
| 15 | `deps/installed` | node_modules 存在 | `node_modules/` 存在 | E | `PT-ED-002` | `pnpm install` |
| 16 | `deps/workspace-links` | `@proteus-vue/*` 链接 | 声明的每个包 `dist/index.js` 就绪 | E | `PT-ED-002` | `pnpm install`（prepare 重建） |
| 17 | `deps/version-align` | 框架包版本 vs CLI 版本 | 全部 == CLI 版本（0.3.0-beta.28） | E | `PT-ED-001` | `pnpm install` |
| 18 | `deps/lockfile-sync` | lockfile ↔ workspace | 等价 `pnpm install --frozen-lockfile` 通过 | E | `PT-ED-003` | `pnpm install` 后提交 lockfile |
| 19 | `deps/declared` | import 声明完整性 | `check-deps.mjs` 零缺失 | W | `PT-ED-004` | `node scripts/check-deps.mjs --fix-list` |
| 20 | `deps/dist-freshness` | CLI 自身 dist 是否陈旧 | `warnIfDistStale` 同判据（决策 #663） | W | `PT-ED-005` | `pnpm build:packages` |

### 4.4 `project` — 工程完整性与配置（吸收 `health.ts`）

| # | id | 检查内容 | 判据 | 级别 | 失败码 |
|---|---|---|---|---|---|
| 21 | `project/config-file` | `proteus.config.ts` 存在 + schema 通过 | `loadProteusConfig` + 校验 | E | `PT-ER-001` |
| 22 | `project/targets` | `targets` 至少声明一端 | 同 `strict-cli` CLI002 | E | `PT-ER-001` |
| 23 | `project/pages-dir` | `pagesDir` 存在 | 目录存在 | E | `PT-ER-002` |
| 24 | `project/app-config` | `app.config.ts`（可选） | 存在性 | W | `PT-ER-004` |
| 25 | `project/appid` | appid 有效（mp 端） | `isValidAppid` | E | `PT-ER-005` |
| 26 | `project/generated-manifest` | `.proteus/` 生成物指纹 | 同 `strict-cli` CLI004 | W | `PT-ER-003` |
| 27 | `project/gates-config` | `gates.disabled` 合法 | id 均在 `gate ls` 注册表内 | W | `PT-ER-006` |
| 28 | `project/scripts` | 必要 npm scripts | `build:web` / `build:mp` / `test` 存在 | W | `PT-ER-007` |

### 4.5 `hosts` — 端就绪度（聚合视图，按 targets 条件启用）

| # | id | 检查内容 | 级别 | 失败码 |
|---|---|---|---|---|
| 29 | `hosts/ios` | 聚合：xcode + SDK + 签名 + 设备（对应 `build --package --target ios` 前置条件） | E | `PT-BE-001/003/004/005` |
| 30 | `hosts/android` | 聚合：jdk + sdk + ndk + runtime AAR + adb 设备 | E | `PT-BE-002/005` |
| 31 | `hosts/harmony` | 聚合：deveco + hdc + 签名材料（`build-profile.json5`） | E | `PT-EE-011/013` |
| 32 | `hosts/web` | 聚合：node + 依赖 + 端口 | W | `PT-EE-001/020` |
| 33 | `hosts/skyline` | 聚合：微信工具 + appid + 基础库门槛（≥ 2.29.2 Skyline） | W | `PT-EE-010` |

> 该组不新增探测逻辑，而是**对 §4.1–4.3 的 finding 按 target 做投影聚合**，输出"要打包 ios，还差哪 2 项"。这是 doctor 最核心的增值点。

### 4.6 `ports` — 端口占用

| # | id | 检查内容 | 判据 | 级别 | 失败码 |
|---|---|---|---|---|---|
| 34 | `ports/dev-server` | dev server 端口（5173 / 项目配置）空闲 | `net.createServer().listen` 可绑定 | W | `PT-EE-020` |
| 35 | `ports/ide-port` | 微信工具自动化端口（9420） | 空闲（E2E 需要） | W | `PT-EE-020` |

### 4.7 `devices` — 设备（**慢**，默认跳过）

| # | id | 检查内容 | 判据 | 级别 | 失败码 |
|---|---|---|---|---|---|
| 36 | `devices/android` | `adb devices` 有 connected | 解析输出 | W | `PT-EE-021` |
| 37 | `devices/ios` | `xcrun devicectl list devices` 有 connected | 解析输出 | W | `PT-BE-004`（复用） |
| 38 | `devices/harmony` | `hdc list targets` 有设备 | 解析输出 | W | `PT-EE-021` |

### 4.8 `gates` — 门禁可运行性

| # | id | 检查内容 | 判据 | 级别 | 失败码 |
|---|---|---|---|---|---|
| — | `gates/runnable` | 注册表门禁的脚本/命令可达 | 抽查 `gate ls` 中 `scope=project` 的门禁其入口存在 | W | `PT-ER-008` |

> `gates` 组置于最后，且**只验可运行性**（决策 D3）。

---

## 5. 架构与文件清单

```
packages/cli/src/doctor/
├── index.ts          # runDoctor() 编排：分组并行 → 聚合 → 输出 → 退出码
├── types.ts          # DoctorGroup / DoctorCheck / DoctorFinding / DoctorReport
├── registry.ts       # ★CHECKS 注册表（SSOT，对齐 gate.ts 的 GATES 范式）
├── context.ts        # DoctorContext 构造（root/targets/config/探测原语注入）
├── report.ts         # 呈现层：human / json / md（复用 ui.ts + diag.ts）
├── checks/
│   ├── env.ts        # §4.1
│   ├── toolchain.ts  # §4.2
│   ├── deps.ts       # §4.3
│   ├── project.ts    # §4.4（内部调用 health.ts / strict-cli.ts）
│   ├── hosts.ts      # §4.5（投影聚合，零新增探测）
│   ├── ports.ts      # §4.6
│   ├── devices.ts    # §4.7（慢）
│   └── gates.ts      # §4.8
└── README.md         # 面向贡献者：如何新增一个检查项
```

改动既有文件（**四处，均为追加**）：

| 文件 | 改动 |
|---|---|
| `packages/cli/src/index.ts` | 新增 `case 'doctor'`（约 12 行，与 `case 'health'` 同构） |
| `packages/cli/src/args.ts` | 新增 `parseDoctorArgs()` + `HELP_GROUPS` 的「诊断与工具」组补一条 |
| `packages/cli/src/diag.ts` | `DIAG_CODES` **补录** §6 新码（SSOT 约束：未登记会 throw） |
| `packages/cli/src/health.ts` | `case 'health'` 转薄壳（决策 D2） |

新增测试与门禁：

| 文件 | 内容 |
|---|---|
| `tests/cli-doctor.test.ts` | §10 测试矩阵 |
| `scripts/check-doctor-registry.mjs` | 注册表自检：id 唯一/命名 kebab/每组非空/失败码已在 `DIAG_CODES` |
| `.github/workflows/ci.yml` | `verify` job 首步插入 doctor（§8） |

---

## 6. 诊断码（Apollo 扩展 · 复用优先）

### 6.1 规则

Apollo 既有格式 `PT-{阶段}{类别}-{序号}`，阶段 `C/B/D`，类别 `S/T/R/E/D/X`。
doctor 的发现发生在**编译之前**，语义上不属于 C/B/D 任一阶段，因此**新增阶段 `E`（Environment · 体检期）**：`PT-E{类别}-{NNN}`。

> ★这是对 Apollo 的阶段扩展，需在 `decisions.md` 中显式登记（附本条理由），不改动 L0–L4 分层与三条硬约束。

### 6.2 新增码（须补录进 `DIAG_CODES`）

| 码 | 组 | 标题 | 通用建议（hints） |
|---|---|---|---|
| `PT-EE-001` | env | Node 版本不满足 | 本仓门禁要求 Node ≥ 22（Node 18 下 jsdom 假红） |
| `PT-EE-002` | env | 包管理器版本不匹配 | 用 corepack 对齐 `packageManager` |
| `PT-EE-003` | env | 缺少 Rust 工具链（rustup） | 本机 PATH 上的 rustc 可能来自 Homebrew，Android target 装在 `~/.cargo` |
| `PT-EE-004` | env | git 身份未配置 | 提交/发布流程需要 user.name 与 user.email |
| `PT-EE-005` | env | 磁盘空间不足 | iOS 模拟器 runtime 约 8 GB |
| `PT-EE-006` | toolchain | Android NDK 缺失 | 见 `hosts/android/README.md` |
| `PT-EE-007` | toolchain | JS 引擎（QuickJS）产物缺失 | 跑 `scripts/setup-android-js-engine.sh` |
| `PT-EE-010` | toolchain | 微信开发者工具 CLI 未探测到 | 设 `PROTEUS_IDE_CLI` 或 `--ide` |
| `PT-EE-011` | toolchain | 缺少 DevEco Studio / hvigor | HarmonyOS 端构建需要 DevEco 6.1.1+ |
| `PT-EE-012` | toolchain | 缺少 adb | 安装 platform-tools 并加入 PATH |
| `PT-EE-013` | toolchain | hdc 版本过低 | 旧版 hdc 与 HarmonyOS 7 设备协议不兼容，用 DevEco 自带 |
| `PT-EE-020` | ports | 端口被占用 | 释放端口或指定 `--port` |
| `PT-EE-021` | devices | 无可用设备 | 连接设备并在设备上授权 |
| `PT-ED-001` | deps | 框架包版本与 CLI 不一致 | `pnpm install` |
| `PT-ED-002` | deps | 依赖未安装 / workspace 链接不完整 | `pnpm install`（prepare 钩子重建 dist） |
| `PT-ED-003` | deps | lockfile 与 package.json 不同步 | 本地 `pnpm install` 后提交 lockfile |
| `PT-ED-004` | deps | 存在未声明依赖 | `node scripts/check-deps.mjs --fix-list` |
| `PT-ED-005` | deps | CLI dist 陈旧 | `pnpm build:packages` |
| `PT-ER-001` | project | 工程配置缺失或校验失败 | `proteus gen config` / 修 `proteus.config.ts` |
| `PT-ER-002` | project | pagesDir 不存在 | `proteus.config.pagesDir` 指向错误 |
| `PT-ER-003` | project | `.proteus/` 生成物与指纹基线不一致 | 删除 `.proteus/` 重新生成 |
| `PT-ER-004` | project | 缺少 app.config.ts（可选） | `proteus gen config` 生成骨架 |
| `PT-ER-005` | project | appid 无效或为占位 | IDE 导入 / automator 体检会失败 |
| `PT-ER-006` | project | `gates.disabled` 含未注册 id | `proteus gate ls` 查看合法 id |
| `PT-ER-007` | project | 必要 npm scripts 缺失 | 补齐 `build:web` / `build:mp` / `test` |
| `PT-ER-008` | gates | 门禁入口不可达 | 检查 `scripts/` 与 `gate.ts` 注册表是否同步 |
| `PT-EX-000` | 任意 | 体检期未知 | **只定位不猜因**（Apollo §6.3） |

### 6.3 复用既有码（**不新建**）

| 既有码 | doctor 中的使用点 |
|---|---|
| `PT-BE-001` | `toolchain/xcode`、`toolchain/xcode-devicectl`、`hosts/ios` |
| `PT-BE-002` | `toolchain/android-jdk`、`toolchain/android-sdk`、`hosts/android` |
| `PT-BE-003` | `hosts/ios`（签名不可用） |
| `PT-BE-004` | `devices/ios`、`hosts/ios` |
| `PT-BE-005` | `hosts/ios`、`hosts/android`（缺 runtime 依赖） |
| `PT-BD-002` | `env/rust-toolchain`（cargo 不可用时的归因） |

> **纪律**：doctor 的每条 finding 都带 `diagCode`，与 `diag.ts` 的 `ProteusDiagnostic` **同构**。这使 `--json` 的 `diagnostics[]` 可直接喂给既有的 Apollo 消费方（AI agent 读 finding → 定位文档 → 自动修复，闭合成 Apollo §6 的目标）。

---

## 7. CLI 接口

### 7.1 用法

```
proteus doctor [dir]

选项
  --json               机器可读输出（stdout 单个 JSON；供 CI）
  --report <path>      报告落盘（*.json；配合 --json 时写文件而非 stdout）
  --strict             warn 也视为失败（exit 1）
  --only <groups>      只跑指定组（逗号分隔：env,toolchain,deps,project,hosts,ports,devices,gates）
  --skip <groups>      跳过指定组
  --target <t>         hosts 组只查指定端（缺省 = proteus.config 的 targets 声明集）
  --deep               启用慢检查（devices 组；默认跳过）
  --verbose           每项附取证（原始命令 + 原始输出 + 退出码）
  --timeout <ms>       单检查超时（缺省 5000）
  --no-parallel        串行执行（调试用）
  --list               只列检查项目录（id/组/级别/是否慢），不执行
```

### 7.2 退出码

| 条件 | 退出码 |
|---|---|
| 无 `error`（可有 `warn`） | `0` |
| 有 `error` | `1` |
| 有 `error` 且 `--strict`，或仅有 `warn` 且 `--strict` | `1` |
| 运行中断（超时/异常） | `1`（该项降级为 warn，附证据；**绝不静默**） |
| `--list` | `0` |

> 与既有一致：成功 `0` / 失败 `1`（`index.ts` 全仓约定）；`exit 2 = block` 保留给 hook 通道（AGENTS.md §1），doctor **不用** exit 2。

### 7.3 关于 `--fix`（明确不做）

**决策 D4：v1 不提供 `--fix`。**
理由：Apollo 硬约束④「**不做自动修复，只给建议**」。doctor 的"修复"形态是 **`fix.command` 字段（可复制命令）+ 输出末行的修复清单**，而非自动执行。
若未来要引入，须满足：独立决策 + 白名单（幂等、可逆、无网络写）+ 默认 dry-run。**本方案不包含。**

---

## 8. 输出规范

### 8.1 人类可读（默认）

一屏内给出：**分组 → 逐项 ✓/⚠/✗（含实测值与期望）→ 汇总数字与耗时 → error/warn 清单（带修复命令）→ 取证指引**。

```
$ proteus doctor

◆ Proteus doctor  proteus（框架仓）  ·  v0.3.0-beta.28  ·  targets: web, skyline, ios

  环境 Environment
    ✓ node          22.22.2                                    ≥ 22.12 要求
    ✓ pnpm          9.15.9                                     packageManager 一致
    ⚠ git           未配置 user.email                          提交/发布流程需要
    ✓ 磁盘          118 GB 可用

  工具链 Toolchain
    ✓ xcode         26.5  /Volumes/data1/…/Xcode.app            iOS SDK 26.0
    ✓ devicectl     Xcode 15+ 自带
    ✗ android-jdk   JDK 17 未找到                               期望 .tools/jdk17 或 JAVA_HOME
        ├ 取证  ls .tools/jdk17  →  ENOENT
        ├ 取证  echo $JAVA_HOME  →  (空)
        └ 修复  见 hosts/android/README.md「前置」——准备 .tools/jdk17（JDK 17）
    ⚠ wechat-devtools  CLI 未探测到                            影响 proteus test e2e:mp
        └ 修复  export PROTEUS_IDE_CLI=/Applications/wechatwebdevtools.app/Contents/MacOS/cli

  依赖 Dependencies
    ✓ workspace  24 个 @proteus-vue/* 链接就绪（dist 完整）
    ✗ 版本一致   @proteus-vue/compiler 0.3.0-beta.27 ≠ CLI 0.3.0-beta.28
        └ 修复  pnpm install
    ✓ lockfile  与 workspace 同步

  工程 Project
    ✓ proteus.config.ts  校验通过（pagesDir=pages, targets=3）
    ⚠ app.config.ts      缺失（可选）——proteus gen config 生成骨架

  宿主 Hosts
    ✓ ios        就绪（Xcode + SDK + 签名 + 1 台设备）
    ✓ web        就绪
    ✓ skyline    就绪（微信工具 / appid / 基础库 ≥ 2.29.2）

  端口 Ports
    ⚠ 5173       被 node 占用（dev server 需要）

────────────────────────────────────────────────────────────
  36 项检查 · 30 ✓ · 4 ⚠ · 2 ✗ · 1.42s    （devices 组未启用：--deep）

  2 项 error（阻断）
    PT-BE-002  android-jdk     见 hosts/android/README.md「前置」（.tools/jdk17）
    PT-ED-001  版本一致        pnpm install
  4 项 warn
    PT-EE-004  git · PT-EE-010 wechat-devtools · PT-ER-004 app.config.ts · PT-EE-020 端口 5173

  ★ 完整报告：proteus doctor --json --report doctor-report.json
  ★ 逐项取证：proteus doctor --verbose
```

**呈现纪律**（全部继承 `ui.ts` + Apollo）：
- 图标：`✓` ok（绿）/ `⚠` warn（黄）/ `✗` error（红）/ `-` skip（dim）。逐项对齐 `ui.ts` 的符号约定。
- 非 TTY 或 `NO_COLOR` ⇒ 零 ANSI（`ui.ts` 已保证）。
- **取证（evidence）在默认视图折叠为一行 `└ 修复 …`；`--verbose` 才展开全部原始输出**——但**任何情况下 `--json` 都含完整 `evidence`**（Apollo §7：可展开 = 原文不丢，只是默认不喧哗）。
- 汇总行固定格式 `N 项检查 · a ✓ · b ⚠ · c ✗ · X.XXs`，可 grep。

### 8.2 机器可读（`--json`）

> 下例为**示意**（含一处 `error` 演示字段全貌），非某台机器的实测结果。

```json
{
  "schemaVersion": 1,
  "tool": { "name": "proteus", "version": "0.3.0-beta.28" },
  "root": "/Volumes/data1/work/office/proteus",
  "platform": { "os": "darwin", "arch": "arm64", "node": "22.22.2" },
  "targets": ["web", "skyline", "ios"],
  "startedAt": "2026-10-08T18:20:11.000Z",
  "durationMs": 1423,
  "summary": { "total": 36, "ok": 30, "warn": 4, "error": 2, "skip": 0, "blocked": true },
  "groups": [
    {
      "id": "toolchain",
      "title": "工具链",
      "findings": [
        {
          "checkId": "toolchain/android-jdk",
          "level": "error",
          "title": "JDK 17 未找到",
          "expected": ".tools/jdk17 或 JAVA_HOME 指向 JDK 17",
          "actual": "ENOENT / JAVA_HOME 未设置",
          "diagCode": "PT-BE-002",
          "evidence": [
            { "command": "ls .tools/jdk17", "exitCode": 1, "stderr": "ls: .tools/jdk17: No such file or directory" },
            { "command": "printenv JAVA_HOME", "exitCode": 1 }
          ],
          "fix": { "command": "# 准备 JDK 17：见 hosts/android/README.md §前置（.tools/jdk17）", "description": "放置 JDK 17 到 .tools/jdk17 或设 JAVA_HOME" },
          "docs": "hosts/android/README.md"
        }
      ]
    }
  ],
  "diagnostics": [
    {
      "code": "PT-BE-002",
      "title": "找不到 Android SDK / JDK",
      "severity": "error",
      "context": "toolchain/android-jdk",
      "suggestions": ["设 ANDROID_HOME / JAVA_HOME，或确认本仓 .tools/jdk17 存在"],
      "raw": "ls .tools/jdk17 → ENOENT；printenv JAVA_HOME → (空)"
    }
  ],
  "ok": false
}
```

要点：
- `schemaVersion` 独立版本化，`--json` 是**对外契约**，破坏性变更须升版本并在 CHANGELOG 声明。
- `diagnostics[]` **与 `diag.ts` 的 `ProteusDiagnostic` 同构**（`code/title/severity/context/suggestions/raw`），可直接被 Apollo 既有消费方复用。
- 隐私：`evidence` 中的**凭证类输出必须脱敏**（匹配 `token|secret|password|Bearer|sk-` 的行替换为 `***`）；`--report` 落盘的 JSON 同样脱敏（避免 CI artifact 泄露，对齐 `check-secret-scan.mjs` 的纪律）。

### 8.3 `--report <path>`

落盘与 `--json` 同一结构。用于 CI artifact 与"两台机器 diff 体检结果"。

---

## 9. 安全与硬约束（逐条继承，不得违反）

| # | 约束 | 来源 | 在 doctor 中的落实 |
|---|---|---|---|
| ① | 错误码**自建**，不透传下层 | Apollo §6.1 | 全部 doctor 发现用 `PT-E*` / 复用 `PT-B*`；工具链原始码（如 hdc 版本串）只进 `evidence` |
| ② | **禁止对未知原因生成猜测性原因** | Apollo §3.3 | 探测失败但无法归类 ⇒ `PT-EX-000`，只给"取证命令"不给"可能原因" |
| ③ | **必须保留原始错误全文** | Apollo §7 | 每次探测的 `command/stdout/stderr/exitCode` 全量进 `evidence`，`--json` 恒含，`--verbose` 展开 |
| ④ | **不做自动修复** | Apollo §15 | 无 `--fix`（决策 D4）；只给 `fix.command` |
| ⑤ | 非 TTY 零 ANSI | `ui.ts` | 复用 `ui.ts` 输出原语 |
| ⑥ | 每项超时，不许挂死 | 本方案新增 | `timeoutMs` 默认 5000；超时降级 `warn` + 证据 `spawn timeout` |
| ⑦ | 默认无网络副作用 | 本方案新增 | 不访问 registry；`deps` 组用本地 lockfile 比对而非 `pnpm outdated` |
| ⑧ | 隐私脱敏 | `check-secret-scan.mjs` 纪律 | §8.2 的 `evidence` 脱敏规则 |
| ⑨ | 端到端只读 | 本方案新增 | doctor **不写入**工程任何文件（`--report` 写的路径由用户指定） |

---

## 10. 测试矩阵（`tests/cli-doctor.test.ts`）

| 分类 | 用例 |
|---|---|
| 注册表 | id 唯一；kebab-case；组全覆盖；每项 `diagCode` 已登记在 `DIAG_CODES`（否则 throw）；慢检查标 `slow: true` |
| 纯函数检查 | 每项以注入 `ctx` 跑三态：满足 / 不满足 / 探测异常 ⇒ 断言 `level` 与 `diagCode` |
| 条件启用 | `targets` 不含 ios ⇒ `toolchain/xcode` 与 `hosts/ios` 结果为 `skip`，不阻断 |
| 反例守卫 | ① finding 必须带 `evidence`（不得吞原文）；② 未知项必须是 `PT-EX-000` 且 **无** `cause` 字段（不得猜因）；③ 无 `--fix` 行为（断言代码中不存在自动执行） |
| 超时 | 注入"永久 pending"的假检查 ⇒ 超时后 `level=warn` + evidence 记 timeout，doctor 不 hang |
| 退出码 | 无 error → 0；有 error → 1；有 error + `--strict` → 1；仅 warn + `--strict` → 1；仅 warn → 0 |
| 输出 | `--json` snapshot 稳定；非 TTY ⇒ 输出零 `\u001b[`；`--list` 不执行任何探测 |
| 脱敏 | evidence 含 `sk-xxx` / `Bearer yyy` ⇒ 输出为 `***` |
| 薄壳 | `health` 输出与 `doctor --only project` 的 finding 集合一致 |

对齐既有测试风格：`tests/cli-diag.test.ts`（#684 的 4 组 describe：错误码 SSOT / L0 采集 / L4 呈现 / 反例守卫）。

---

## 11. CI 集成

**决策 D5：doctor 作为 CI 的"第 0 步"**（环境不成立时后续步骤的失败是噪音）。

`ci.yml` 的 `verify` job（`actions/setup-node@v4` 与 `pnpm install` 之后）：

```yaml
      - name: Doctor（环境体检）
        run: pnpm --filter @proteus-vue/cli exec tsx src/index.ts doctor --json --report doctor-report.json
      - name: 上传体检报告
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: doctor-report
          path: doctor-report.json
```

- **默认不加 `--strict`**（CI 里 warn 不该阻断：如未配置 git email）；需要强约束的仓可在自己 workflow 加。
- `--report` 产物随 artifact 上传 —— 这是仓库**第一份检查结果 artifact**（此前仅有 Pages 部署产物）。

门禁注册（对齐 #453/#454）：

```ts
// gate.ts 的 GATES 追加
{ id: 'doctor', group: '仓库治理', scope: 'project',
  usage: 'proteus doctor [dir] [--json] [--strict] [--only <groups>]',
  desc: '环境/工具链/依赖/工程/宿主/端口/设备体检（M5）' }
```

> 注意保持**未接线（○）**状态即可：doctor 是多旗标诊断工具，按 `gate.ts` 既有约定"未接线（○：写型/诊断/多旗标工具）经独立命令"执行。**不要**强行接 `run` 适配器（会丢旗标语义）。

配套：`scripts/check-doctor-registry.mjs` 与 `check-gates-sync.mjs` 联动——新门禁必须被某个 workflow 引用或列入 `LOCAL_ONLY` 并给理由。

---

## 12. 落地批次

| 批次 | 内容 | 验收 |
|---|---|---|
| **B1 · 骨架** | `types.ts` / `registry.ts` / `context.ts` / `index.ts` / `args.ts` / `index.ts` 的 `case`；`--list` 可用 | `proteus doctor --list` 列出全部检查项；注册表自检脚本通过 |
| **B2 · 核心检查** | `env` / `deps` / `project` 三组（含 `health` 迁移 + 薄壳）；human 输出；退出码 | `proteus doctor` 在框架仓与 examples 工程各跑通；`health` 薄壳等价 |
| **B3 · 工具链与宿主** | `toolchain` / `hosts` / `ports`；`--target` 条件启用 | 在本机（Xcode 26.5 + `.tools/jdk17`/`.tools/ndk`）如实报出各端状态；缺件项给出**可复制**修复命令（禁止编造不存在的脚本） |
| **B4 · 机器可读与 CI** | `--json` / `--report` / `--verbose` / `--deep`（devices）；脱敏；CI 接入 + artifact | `--json` schema 冻结；CI 产出 `doctor-report.json` |
| **B5 · 文档与决策** | 本文件定稿；`decisions.md` 登记 #685（含 `PT-E` 阶段扩展理由）；`AGENTS.md` 补 doctor 纪律；`03-m3-audit-doctor.md` §4 标注 superseded；`packages/cli/README.md` 与 `HELP_GROUPS` 更新 | 文档链接检查（`check:doc-links`）通过 |

---

## 13. 风险与反例

| # | 风险 | 处置 |
|---|---|---|
| R1 | doctor 与 health 职责重叠 → 双份维护 | 决策 D1/D2：health 变薄壳，实现在 doctor；`tests` 断言两者一致 |
| R2 | 探测外部命令（xcrun/adb/hdc）在部分机器上挂死 | 每项硬超时（§9 ⑥）；`devices` 组默认跳过 |
| R3 | 输出被视为"噪音"（38 项太长） | 默认只显示异常项的分组；`--only` 精确圈定；汇总恒一行可 grep |
| R4 | CI 因 warn 阻断导致误伤 | 决策 D5：CI 默认非 strict |
| R5 | 凭证泄露进 artifact | §8.2 脱敏 + 单测守卫 |
| R6 | 检查项随端增加而腐化（新增端忘加检查） | `scripts/check-doctor-registry.mjs` 断言"每个 `targets` 支持端在 `hosts` 组有对应项" |
| R7 | 被人当成"自动修工具"期待 `--fix` | 输出末行与 `README` 明示"doctor 只诊断不修改"（Apollo 硬约束④） |

---

## 14. 验收标准（Definition of Done）

- [ ] `proteus doctor` 在本仓库与至少一个 examples 工程、两种机器状态（全绿 / 缺件）下输出符合 §8 规范
- [ ] `--list` / `--only` / `--skip` / `--target` / `--json` / `--report` / `--verbose` / `--deep` / `--no-parallel` 全部可用且有测试
- [ ] 退出码矩阵（§7.2）全部有测试覆盖
- [ ] `DIAG_CODES` 补录完成，`PT-E*` 无野码（`makeDiag` 的 SSOT 守卫通过）
- [ ] 三条 Apollo 硬约束各有一条反例守卫测试（禁猜因 / 不吞原文 / 不自动修）
- [ ] `health` 薄壳等价性测试通过
- [ ] CI 产出 `doctor-report.json` artifact
- [ ] `--json` schema 冻结并写入 `packages/cli/README.md`
- [ ] 文档五处同步（§12 B5）

---

## 附录 A — 一屏输出（最简场景，全绿）

```
$ proteus doctor

◆ Proteus doctor  proteus（框架仓）  ·  v0.3.0-beta.28  ·  targets: web, skyline, ios

  环境 ✓ 4/4      工具链 ✓ 4/4      依赖 ✓ 3/3      工程 ✓ 5/5      宿主 ✓ 3/3      端口 ✓ 2/2
───────────────────────────────────────────────────────────────────────────────
  21 项检查全部通过 · 0.86s    ★ proteus doctor --verbose 查看逐项取证
```

> 21 = 本次实际执行的项数（该工程 `targets` 仅声明 web/skyline/ios ⇒ android/harmony 相关项为 `skip`，不计入分母）。

> 全绿时**不逐项罗列**——只在分组行给 `✓ n/n`。这是"每天跑一次"的命令，绿就应当安静（对齐本仓"日志可 grep / 无噪音"纪律）。

## 附录 B — 与 `gate.ts` 注册表的字段对齐

| `GateInfo` | `DoctorCheck` | 说明 |
|---|---|---|
| `id` | `id` | 命名空间：gate 用扁平 id，doctor 用 `组/项`（更长的目录需要层级） |
| `group`（门禁族） | `group`（体检组） | 语义一致：用于分组展示与 `--group`/`--only` 过滤 |
| `scope` | `appliesTo(ctx)` | doctor 更细：按 `targets` / 平台条件启用 |
| `usage` | `fix` + `docs` | doctor 每项的"下一步"是修复命令 + 文档，而非子命令 |
| `desc` | `title` / `expected` | — |
| `run?`（未接线为 undefined） | `run(ctx)` | doctor 所有项**必须**实现（无"未接线"态），慢项用 `slow` 标记 |

## 附录 C — 新增一个检查项的步骤（贡献者指引）

1. 在 `registry.ts` 的 `CHECKS` 追加一条，`id` 形如 `组/项`。
2. 若探测逻辑已有归属模块（如 `host-package.ts` 的 `resolveDeveloperDir`）⇒ **直接 import 复用**，禁止复制。
3. 若需要新的探测原语 ⇒ 加成 `DoctorContext` 的注入字段（便于测试注入假实现）。
4. 若失败需要新码 ⇒ **先**在 `diag.ts` 的 `DIAG_CODES` 登记（否则 `makeDiag` 会 throw），**再**在 finding 里引用。
5. 写测试：三态（满足/不满足/异常）+ 条件启用 + 证据非空。
6. 跑 `node scripts/check-doctor-registry.mjs`。
