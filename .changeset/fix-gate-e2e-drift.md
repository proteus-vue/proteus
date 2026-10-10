---
'@proteus-vue/cli': patch
---

修 5 条长期红测的工具链漂移（doctor 分组 / host signing 注册 / check-deps 误报 / 鸿蒙 App 合成证据）

背景：全量测试长期 5 条红（`gate.test` ×4 + `app-screen-content-gate` ×1），非新改动引入，
是**特性提交改了 CLI/产物但漏同步元测试/证据**留下的漂移债。逐条根因 + 修法：

- **`doctor` 分组漂移**（`packages/cli/src/gate.ts`）：#686 把 `doctor` 误登记进「仓库治理」
  （该族语义 = **无 CLI 面**的 npm/CI 治理门禁，不入 HELP）——而 `doctor` 有 CLI 面、在 HELP
  「检查与门禁」组，且它吸收的 `health` 在「专项检查」⇒ 改为 `group: '专项检查'`。
- **`host signing` 漏登记**（`gate.ts`）：#688 把它加进 HELP 却漏登 Gate 注册表 ⇒ B4-lite
  （HELP↔注册表 usage 双向一致）红。补一条 ○（未接线）入口。
- **`check-deps` 误报**（`scripts/check-deps.mjs`）：website playground 把一份 SFC demo
  整段放进**模板串**，其中 `import { nanoid } from 'nanoid'` 是**示例字符串内容**、不是依赖。
  既有"行内含 `${` 即跳过"的启发式看不到这种形态 ⇒ 误报。改为**代码掩码**（字符串/模板串/
  注释内的 import 形态一律不算）——探针复核：全仓仅少报该 1 处误报、零真实依赖被隐藏。
  同批给 `website` 补上真实依赖 `@vue/compiler-sfc`（playground 编 SFC 用）。
- **鸿蒙 App 合成证据失效**（`hosts/harmony`，设备证据 `results/app-screen-composite.json`）：
  #658（2026-10-08）把 App 屏内容切到 css-conformance 展示页后**引入了 `env:` token**，而
  Harmony **dev 探针** `ScreenContentProbe` 未接 env 解析（运行期 `AppScreenCommands` 早已接）
  ⇒ `proteus_layout_create` 返 0 ⇒ App 屏内容整体挂载失败、合成页无输出 ⇒ 入库产物陈旧
  （`real_touch_hits:0`）。修：dev 探针复用运行期同一 helper（`substituteEnvTokens`）。
  ★并修出**第二个**真缺陷：`Index.ets` 仍从 `libproteus_bench.so` 导入 `appScreenCommands`/
  `appScreenHitAt`/`appScreenAnimTick`——而 hosts 关注点分层（811e0524）已把它们迁到
  `proteus_render` ⇒ 运行时 import 抛错（composite 块整段不执行）。改导入来源 + 同步 d.ts。
  真机复跑：`real_touch_hits 0 → 6`，三端合成门禁复绿。

验证：`gate.test` 14/14 · `app-screen-content-gate.test` 全绿 · `check-deps` 零缺失 ·
`check:app-screen-content` 全部合规 · `check:harmony-runtime-prebuilt`（prebuilt 已随源再生）·
`check:host-layering`/`bridge-sync`/`host-variant-parity`/`gates-sync` 绿 · 鸿蒙真机复跑通过。
（`check:host-invoke-contract` 的 `dev.console` 违反在**干净树上同样存在**，属另一 pre-existing 问题，不在本批。）
