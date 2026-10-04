# Proteus App 三端对齐 —— 拦截条件（缺口）清单与收口路线

> 立档：2026-10-04 ｜ 触发：用户「做 App 三端（安卓+iOS+鸿蒙）对齐，看有没有拦截条件（比如 CSS 全兼容对齐、路由页面真正落地），有的话先整理缺口，再逐个收口落地」。
> 三端设备已确认在线：Android `d67e31a3` · iOS `yunlai的iPhone` · 鸿蒙 `69F9K26126005311`。
> ★纪律：本清单**只列有代码/产物证据的项**，每条给 `文件:行号`；「缺口」= 全仓无对应实现或未接线（不是"没找到"）。

---

## 0. 一句话结论

**三端宿主「低层渲染能力」矩阵 22/22 成立（内核能力齐、真机验过）；但「应用级链路」（真实 `pages/*.vue` → App 渲染管线 → 路由页面真正落地 → 三端一致）目前是「分段用夹具验证」的——没有任何一条把「项目页面 + 路由栈 + 三端宿主」串起来跑。** 用户点名的两类尤其成立：

- **CSS 全兼容对齐**：App 端只有**编译期折叠的极小属性子集**（无选择器/层叠/伪类/媒体查询/grid），且**没有 App 端的 CSS 兼容矩阵与门禁**（现状矩阵的 App 列是从 Skyline 派生的，无 App 实测来源）。
- **路由页面真正落地**：路由栈**语义**在跑（Android/iOS），但**屏规格不带页面组件**、宿主 `screen.mount` 建的是**空子树容器** ⇒「路由在走，页面没渲染」。

---

## 1. 拦截条件清单（分层，按依赖顺序）

### A 层 · 构建/产物（★生死关：没有它，后面全部只能跑夹具）

| ID | 缺口 | 证据 | 影响端 | 规模 |
|---|---|---|---|---|
| **A1** | **无 App 构建目标**：CLI `--target` 只接受 `web\|skyline\|all`；`config.platform` 只有 `mp-weixin\|web`；三工程 `package.json` 无 app/ios/android/harmony 脚本 ⇒ `proteus build` 产不出 App 可消费产物 | `packages/cli/src/args.ts:19`（`target?: 'web'\|'skyline'\|'all'`）· `packages/cli/src/build.ts:47`（`TARGET_BUILD_SCRIPTS` 仅 web/skyline）· `packages/types/src/config.ts:49`（`platform: 'mp-weixin'\|'web'`）· `superapp/package.json`（仅 build:web / build:mp） | 三端 | **大** |
| **A2** | **无 App 产物契约**：不存在「一次构建 → 三端宿主都能吃」的产物格式（路由表 + 每页 SFC 渲染函数 + 折叠后样式）。宿主各自吃各自的手造夹具 | `hosts/android/app/src/main/assets/*.json`（vapor-tree/app-4050-tree/browser-layout…）· `hosts/harmony/host-app/entry/src/main/ets/pages/Index.ets:421-423,480,966`（读 rawfile 夹具）· `hosts/ios/bridge/entry-selfdraw.ts:129-185`（`h()` 手写，非 SFC） | 三端 | **大** |

### B 层 · 渲染与路由（用户点名第 2 类）

| ID | 缺口 | 证据 | 影响端 | 规模 |
|---|---|---|---|---|
| **B1** | **路由屏规格不带页面组件**：`AppScreenSpec` 只有 `name/path/transition/budgetNodes/keepAlive` ⇒ 路由到不了「页面内容」 | `packages/router/src/app-stack.ts:53-64`（接口定义）· `packages/router/src/app-adapter.ts:196-232`（`screensFromRoutes` 只搬这几个字段）· `hosts/shared/bridge/entry-app-project.ts:100-120` | 三端 | **大** |
| **B2** | **宿主 `screen.mount` 建空树**：路由栈的屏是内核**空壳容器**，页面内容不来自路由 | `packages/render-backend/src/screen-executor-host.ts:16-30`（协议 `screen.mount → rootNodeId`）· `packages/render-backend/src/screen-executor.ts:84-110`（注释「宿主内部怎么落子树不由本层约束」）· `hosts/ios/ProteusHost/screen-host.swift:9`（「每屏一棵真实内核树」= 空壳） | 三端 | **中** |
| **B3** | **宿主只吃夹具**：三端宿主输入是 rawfile JSON / 内联 SFC 字符串，无项目 `.vue` 加载路径 | `hosts/android/gen-app4050-fixture.mjs:1-15`（「测试宿主没有 JS 引擎（旧前提）⇒ 实例化在构建期做」）· `hosts/android/gen-vapor-fixture.mjs:38-53`（硬编码 SFC 字符串）· 全仓 `find hosts -name '*.vue'` **为空** | 三端 | **大** |
| **B4** | **鸿蒙未接渲染管线/项目路由**：鸿蒙宿主只走原生探针（`libproteus_render.so`）+ 合成屏池探针，未消费 `renderer-app`、未接项目驱动路由 | `grep renderer-app hosts/harmony` 无命中 · `grep AppProject hosts/harmony` 无命中 · `hosts/harmony/host-app/entry/src/main/ets/core/app-stack-probe.ts:15-25`（合成屏池） | 鸿蒙 | **中** |
| **B5** | **已有串通证据但不成链**：Android `entry-vapor.ts` 的 `abRender` 是**真 compiler-sfc 产物**（唯一「真 SFC 模板→Vue 渲染器」端上证据），但**内联单页、无路由**；`entry-app-project.ts` 读真实 `auto-routes.ts` 但**只跑栈语义不渲染页面** | `hosts/android/bridge/entry-vapor.ts:50,946-998` · `hosts/android/gen-vapor-fixture.mjs:367-444,629-635` · `hosts/shared/bridge/entry-app-project.ts:7-27,45-130` | Android/iOS | **中** |

### C 层 · CSS 全兼容对齐（用户点名第 1 类）

| ID | 缺口 | 证据 | 影响端 | 规模 |
|---|---|---|---|---|
| **C1** | **App 端样式只折叠极小子集**：仅 `LAYOUT_FIELDS`（尺寸/margin/padding/flex*/position/display/overflow/gap…）+ `PAINT_FIELDS`（backgroundColor/color/fontSize/borderRadius…）；**仅 px/纯数值 + 宽高百分比**；`grid`/`box-shadow`/`filter`/选择器/层叠/伪类/媒体查询**均不支持** | `packages/compiler/src/vapor/template.ts:257-336`（`parseStaticStyle`） | 三端 | **大** |
| **C2** | **App 端 CSS 支持面无独立事实源**：`end-support-matrix` 的 App 列是从 Skyline formats/remark **派生**（无 App 实测 provenance）；`profile-boundary` 的 `end` **硬编码 `'skyline'`** | `docs/generated/end-support-matrix.md:10-16,21-25` · `packages/css-compat/src/profile-boundary.ts:33,124`（`end: 'skyline'`） | 三端 | **中** |
| **C3** | **两处样式白名单对 App 端不一致**：`style-safety` 把 `display/position/overflow/zIndex` 列为**禁止**，而 `vapor/parseStaticStyle` 的 `LAYOUT_FIELDS` **接受** `display/position/overflow` ⇒「同一属性编译期允许、另一路径拒绝」的半开状态（违反本仓铁律 #9） | `packages/style-safety/src/index.ts:36`（`FORBIDDEN_PROPS`）vs `packages/compiler/src/vapor/template.ts`（`LAYOUT_FIELDS`） | 三端 | **小-中** |
| **C4** | **无 App 端 CSS 门禁**：`package.json` 无 `check:css-compat`/`check:profile-boundary`；`check:profile-baseline` 仅 Node 静态扫描 | `package.json`（scripts 过滤 `/profile/` 仅两条）· `scripts/gen-profile-baseline.mjs:1-10` | 三端 | **小-中** |

### D 层 · 跨端门禁（对齐的度量基础设施）

| ID | 缺口 | 证据 | 影响端 | 规模 |
|---|---|---|---|---|
| **D1** | ~~App 应用级门禁单端化~~ **✅ 已收口（2026-10-04）**：`check:app-stack` 扩为三端（android/ios/harmony 各自结果文件） | `package.json`（三端串联） | 三端 | ✅ |
| **D2** | ~~鸿蒙无任何 `check:*` 接入~~ **✅ 已收口（2026-10-04）**：鸿蒙接入 `check:app-stack` + `check:host-runtime`（`hosts/harmony/results/*.json`；判据如实跳过未接组、不假绿） | `package.json` | 鸿蒙 | ✅ |
| **D3** | ~~`check:host-rounding` 不含鸿蒙~~ **✅ 已收口（2026-10-04）**：扫描面加 `hosts/harmony/.../ets`（含 .ets/.ts）——当场抓到并登记 1 处（`app-stack-probe.ts` 的栈深度取半，非几何、已 `I2-ALLOW`） | `scripts/check-host-rounding.mjs` | 鸿蒙 | ✅ |
| **D4** | **唯一真三端门禁只覆盖 Vapor 夹具**：`check:vapor-three-end`（三端指纹逐值比对）是真正三端门禁，但输入是 Vapor 夹具、非项目页面 | `scripts/check-vapor-three-end.mjs` | 三端 | — |

### E 层 · 文档/状态（非代码，但会误导后续排期）

| ID | 缺口 | 证据 | 规模 |
|---|---|---|---|
| **E1** | **plan 状态与实现脱节**：`app-plan/09` 进度表写 B1-B5 待启动，而 `app-plan/03` 写 B1 已落地（自相矛盾）；`app-renderer-plan` M1-M8 无状态标注；G-41/G-42 只完成逻辑层 | `docs/proteus-app-plan/09-execution-batches.md:31-35` vs `03-landing-evaluation.md:44-56` · `docs/proteus-app-renderer-plan/12-batches.md:7-18` · `docs/proteus-host-container-plan/batches.md:122` | **小** |

---

## 2. 依赖关系（为什么顺序不能乱）

```
A1/A2（构建目标 + 产物契约）
   └─→ B1（路由产物带页面组件）
          └─→ B2（宿主 screen.mount 落真实页面子树）
                 └─→ B4（鸿蒙接入同一链）
                        └─→ B3（宿主吃真实项目 pages）
                               └─→ C（CSS 对齐：在真实页面上才谈得上"全兼容"）
                                      └─→ D（三端门禁把上面每一项锁住）
```

**关键判断**：`A → B1 → B2` 是**生死关**——不打通，「真实 Vue 应用跑三端」永远停在夹具级；C（CSS）虽被用户并列点名，但它**只有在真实页面渲染后才能度量「全兼容」**（否则只是"夹具上的属性折叠面"）。

---

## 3. 收口路线（分阶段）

| 阶段 | 目标 | 覆盖缺口 | 验收（真机） |
|---|---|---|---|
| **阶段 0** | **基石：产物契约 + 三门禁三端化** | A2（契约设计,先静态）· D1/D2/D3（门禁三端化） | 三端设备跑现有 app-stack/host-rounding 判据 |
| **阶段 1** | **路由页面真正落地（Android 先行）** | A1（app 构建目标）· B1（屏规格带组件）· B2（宿主落页面子树）· B5（串通已有链） | Android 真机：路由切页 → 每屏渲染真实 SFC 内容（非空壳） |
| **阶段 2** | **三端一致（iOS + 鸿蒙接入同一产物/链）** | B3 · B4 | 三端同一产物渲染同一页面，几何/内容指纹逐值比对 |
| **阶段 3** | **CSS 全兼容对齐** | C1（扩折叠面/收敛模型）· C2（App CSS 矩阵）· C3（白名单统一）· C4（CSS 门禁） | 三端 CSS 能力矩阵 + 真实页面样式逐端截图/几何对照 |
| **阶段 4** | **收口文档** | E1 | plan 状态回填，本文件同步 |

---

## 4. 本轮（阶段 0）先动哪一刀

**先做「App 端 CSS 支持面 → 对照矩阵」的机器化（C2+C4 的最小面）**，理由：
1. 它是用户点名第 1 类（CSS 全兼容对齐）的**度量前置**——不先"看得见 App 端到底支持什么"，无从谈"全兼容"；
2. 它是**设计轻**的（真相来自现有折叠代码，不是新架构决策）⇒ 不会因方向微调而白做；
3. 它可**机器门禁**（新增 `check:app-css-surface`）⇒ 后续扩折叠面时有回归锁；
4. 它能立即暴露 C3（两处白名单不一致）这类真缺陷。

（后续阶段各自作为独立收口单元推进。）

---

## 5. 收口进度

| 阶段 | 缺口 | 状态 | 说明 |
|---|---|---|---|
| 阶段 0 | C2+C4（App CSS 支持面对照 + 门禁） | ✅ 已完成（2026-10-04） | APP_*_FIELDS SSOT + `check:app-css-surface`（生成 docs/generated/app-css-surface.md + 分层棘轮）+ `tests/app-css-surface.test.ts` 10 组 |
| 阶段 0 | D1（app-stack 三端化） | ✅ 已完成（2026-10-04） | `check:app-stack` 跑 android/ios/harmony 三端结果 |
| 阶段 0 | D2（鸿蒙接入 check:*） | ✅ 已完成（2026-10-04） | 鸿蒙接入 app-stack + host-runtime |
| 阶段 0 | D3（host-rounding 加鸿蒙） | ✅ 已完成（2026-10-04） | 扫描面加鸿蒙 ets；当场抓到并登记 1 处（非几何） |
| 阶段 1 | A1/B1/B2/B5（构建目标 + 路由页面落地，Android 先行） | ⏳ 待办 | **真正的生存关** |
| 阶段 2 | B3/B4（三端接入同一产物/链） | ⏳ 待办 |  |
| 阶段 3 | C1/C3（CSS 折叠面扩展 + 矩阵级别决策） | ⏳ 待办 | 阶段 0 已铺度量前置 |
| 阶段 4 | E1（文档回填） | ⏳ 待办 |  |
