# GP0-a 实测报告：小程序 `root-portal` 点击穿透

> 配套：《Proteus_全局挂载点与App根组件方案.md》§5.1 ·《Proteus_全局挂载点任务卡清单.md》卡 GP0-a
> 日期：2026-10-03　执行环境：微信开发者工具（skill 0.3.11）· 项目 `examples/dist/mp-weixin`
> 被测页：`examples/pages/gp0-root-portal.vue`（本批新建的最小复现页）

---

## 0 结论摘要

| 问题 | 结论 |
|---|---|
| 当前环境（基础库 **3.17.3** + Skyline + glass-easel）下 `root-portal` 点击是否穿透 | **❌ 不穿透**——portal 内**两种形态**点击均正常：① 原生 `button` ② **自定义组件** `p-button`（后者是"组件边界吞事件"的另一形态） |
| 是否复现社区报告的 3.8.4 穿透 | **未能复现**（本机工具链**不能切换基础库**，无法回退到 3.8.4） |
| `virtualHost=false` 是否必须 | **无证据要求**——当前版本下**默认配置即可**（全仓零 `virtualHost` 配置，实测正常） |
| GP3-b0/b1 能否开工 | ✅ **可以**——`root-portal` 在当前基础库下可用；但**必须补 3.8.4 及更早版本的回归**（见 §4） |

**一句话**：社区报告的 3.8.4 穿透**在当前环境（3.17.3）已不可复现**——portal 内**原生元素与自定义组件都能点到**；
在拿到"目标用户基础库分布"之前，**不应**为它引入 `virtualHost=false` 的全局配置
（那会为一个未证实的问题改变所有产物的行为）。

---

## 1 实测装置（可复现）

**被测页面**：`examples/pages/gp0-root-portal.vue`（本批新建，最小依赖：view/button/text + `<teleport>`）

判据设计（三层，缺一不可）：

| # | 判据 | 为什么必须 |
|---|---|---|
| ① | **tap 事件真的到 JS**：页内 `portalTaps` 计数 + `console.log('[GP0A] portal-tap N')` | "点击没反应"有两种：事件没到 JS（穿透）／到了但状态没更新——必须分辨 |
| ② | **同页主树对照**：`mainTaps` 计数 | 若主树也不通 ⇒ 是链路/设备问题，**不是穿透**（防误判） |
| ③ | **portal 内元素结构可达**：`querySelector` 能查到 portal 内 button | 区分"渲染没出来"与"渲染了但点不到" |
| ④ | ★**两种内容形态**：portal 内既放**原生 button** 又放**自定义组件**（`p-button`） | 「穿透」与「组件边界吞事件」是**两种不同失效**——原生态能点而组件态不能点，说明是边界问题而非 portal 问题（本仓既有经验：原生 tap 不跨组件边界） |

**编译产物取证**（`examples/dist/mp-weixin/pages/gp0-root-portal.wxml`）：`<teleport>` 正确编译为
`<root-portal>`（含 `bind:tap`），页级 `renderer: skyline` + `componentFramework: glass-easel`。

---

## 2 实测记录（原始读数）

| 步骤 | 命令 | 读数 |
|---|---|---|
| 运行环境 | `automation_evaluate` → `wx.getAppBaseInfo()` | **SDKVersion 3.17.3**（version 8.0.5） |
| 结构可达 | `automation_page_action --action querySelector --selector .gp0-portal-btn-*` | ✅ `{ elementId: "6", tagName: "button" }` |
| ① 点主树（对照） | `automation_element_action --action tap --selector .gp0-main-btn-*` | `mainTaps: 1`（console: `[GP0A] main-tap 1`） |
| ② 点 portal（被测） | `automation_element_action --action tap --selector .gp0-portal-btn-*` | **`portalTaps: 1`**（console: `[GP0A] portal-tap 1`）· `lastTap: "portal"` |
| ③ 复现性（再点一次） | 同上 | `portalTaps: 2` · 主树保持 1 ⇒ **点击精确落在 portal 按钮上** |
| ④ **id 选择器复验**（装置稳定性） | `--selector "#gp0-portal-btn"`（页面重载后） | ✅ `portalTaps: 1`（新实例）——**id 选择器可用**（scoped 短类名不可用，见 §6 经验 1） |
| ⑤ ★**第二形态：自定义组件** | `--selector "#gp0-portal-comp"`（portal 内 `p-button`） | **`portalCompTaps: 1`**（console: `[GP0A] portal-comp-tap 1`）——**组件边界**在 portal 内也**不吞事件** |

**两条独立证据链**（判据纪律：不只看一个）：页面 data 计数（`getData`）+ console 落痕（`get_simulator_console` grep `GP0A`）**都**证明事件到了 JS 层。

---

## 3 关键发现：**社区报告的复现条件在本机不可达成**

| 事项 | 事实 |
|---|---|
| 社区报告 | 基础库 **3.8.4 + Skyline** 下 portal 内组件点击穿透（3.5.8 正常），规避 = `virtualHost=false` |
| 本机基础库 | **3.17.3**（远新于报告版本） |
| 能否回退到 3.8.4 验证 | **❌ 不能**——`wechatide` skill 工具集（0.3.11）**无设置基础库的入口**（工具清单已全量核对：无 `libVersion` 相关参数）；`@proteus-vue/test-core/driver` 只**读取**基础库版本（`types.ts` 的 `version` 字段），不设置 |
| 因此 | **"3.8.4 是否真穿透"在本环境无法证实也无法证伪**——只能记录为**待外部复现**（见 §4 缺口 1） |

★**不允许把"当前不复现"写成"该问题不存在"**：报告的版本比本机低 20+ 个版本，
且**基础库版本由用户设备决定、不由我们控制**——如果目标用户里有停在 3.8.x 的，
穿透就真实存在于那些设备上。

---

## 4 待补缺口（本卡未完成项，如实标注）

| # | 缺口 | 为什么本机做不了 | 建议动作 |
|---|---|---|---|
| 1 | **3.8.4 / 3.5.8 版本回归** | 工具链无基础库切换入口 | 手动切换（IDE 详情面板选择基础库版本）后重跑本页；或找一台停在 3.8.x 的真机 |
| 2 | **WebView 引擎（非 Skyline）对照** | 本机产物 26/27 页为 skyline；切 webview 需改页面配置并重构建 | 复制本页为 `gp0-root-portal-webview`（页级 `renderer: webview`）重跑 |
| 3 | **`virtualHost=false` 的正反验证** | 依赖缺口 1（问题先要能复现） | 待 3.8.4 上复现后，加 `virtualHost=false` 再测 |
| 4 | **真机（非模拟器）确认** | 当前为 IDE 模拟器 | 用 `auto_preview` 推送到真机复跑同页 |

---

## 5 对方案与任务卡的影响（已落文档）

1. **GP0-a 的结论收窄为**：*当前基础库（3.17.3）+ Skyline 下 `root-portal` 可用*——**不是**"穿透问题不存在"；
2. **`virtualHost=false` 的默认值建议**：**暂不设**（本机无证据支持全局开启）。
   若缺口 1 证实"3.8.x 穿透" ⇒ 再评估：是"编译期固定 false"还是"按基础库版本降级"。
   ★**不建议**在无版本判据的情况下全局开 `virtualHost=false`（那是为一个未证实问题改变所有产物）；
3. **GP3-b0（Overlay 收口）可以开工**：传送链路在当前基础库可用（本卡已证）；
4. **GP3-b1（Global 层）不受影响**：它不走 `root-portal`（走"每页注入 + 状态共享"，见方案 §1.2-bis）。

---

## 5.5 ★已固化为**可重跑 e2e 用例**（不再依赖一次性手工操作）

`tests/e2e-mp-gp0-root-portal.test.ts`——把本卡的三形态判据 + 零 error 门禁 + 基础库版本读数
固化成一条可重跑用例（本仓纪律：能力 + 判据 + 可复现三件套）。

```bash
PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-gp0-root-portal.test.ts
# 实测：16.0 秒 · ✅ 通过（SDKVersion=3.17.2 那一轮：main=1 portal=1 comp=1）
```

**用例的五条判据**（与 §1 一一对应）：主树对照 · portal 内原生元素 · portal 内自定义组件 ·
console 落痕（独立证据链）· 零 error 门禁。**基础库版本打进日志与断言消息**（结论适用范围可追溯）。

★**注意**：用例只证明**当前 IDE 决定的基础库**下可达；**版本矩阵仍需覆盖**（§4 缺口 1）。

## 6 复现命令（照抄可跑）

```bash
# 前置：构建 MP 产物（含本页）
pnpm build:mp

CLI=/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide
PROJ="$PWD/examples/dist/mp-weixin"

# 导入项目 → 打开页面 →（如未跳转）导航
"$CLI" -c zed project_import --project "$PROJ"
"$CLI" -c zed simulator_open_page --project "$PROJ" --page "pages/gp0-root-portal"
"$CLI" -c zed automation_navigate --project "$PROJ" --action navigateTo --url "/pages/gp0-root-portal"

# 读基础库版本（决定结论适用范围）
"$CLI" -c zed automation_evaluate --project "$PROJ" \
  --fn-source "(function(){var i=wx.getAppBaseInfo();return JSON.stringify({SDKVersion:i.SDKVersion})})"

# 点击（★用 **scoped 全名**——短类名查不到，本仓 S 系列坑）
"$CLI" -c zed automation_element_action --project "$PROJ" --action tap --selector ".gp0-main-btn-data-v-dfae28"
"$CLI" -c zed automation_element_action --project "$PROJ" --action tap --selector ".gp0-portal-btn-data-v-dfae28"

# 读结果（两个证据链）
"$CLI" -c zed automation_page_action --project "$PROJ" --action getData     # mainTaps / portalTaps
"$CLI" -c zed get_simulator_console --project "$PROJ" --command "grep -n GP0A"
```

**★装置经验（值得内化，本仓此前踩过同类）**：
1. `automation_element_action` 用**短类名**（`.gp0-main-btn`）会 `no such element`——scoped hash 使实际类名是
   `.gp0-main-btn-data-v-dfae28`（**与 S 系列"Skyline 不认属性选择器"同族**）；写探针页时建议**同时加静态 id**
   （`id` 选择器 Skyline 认，见 `p-popover` 的既有修法）；
2. `automation_open_page` 只触发编译、**不保证导航**——需再 `automation_navigate`（或先截图确认当前页）；
3. `automation_evaluate` 的参数名是 `--fn-source`（**不是** `--function`），且必须传**函数体字符串**；
4. `simulator_screenshot` 无 `--output` 参数（会警告忽略），返回体里读 `path`。
