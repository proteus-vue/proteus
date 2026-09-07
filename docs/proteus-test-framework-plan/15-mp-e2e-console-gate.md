# M5b · MP E2E 标准链路（Electron wechatide · console 门禁第一）

> **定位**：小程序真机/模拟器 E2E 的**唯一执行链路**。取代 05-e2e-mp-automator 的旧
> miniprogram-automator 链路（旧版 NWJS 开发者工具已退役；现用官方 **Electron 重构版**
> 微信开发者工具 + `wechatide` CLI / wechatide-skill 工具面——见 docs/wechatide-skill）。
> 本文档定义**顺序铁律**：每进入一个页面，**第一动作 = 抓运行日志（console）做零报错门禁**，
> 通过后才允许碰元素/断言。任何跳过该门禁直接抓元素的行为都是违规操作。

## 为什么必须有这条规范（2026-09-07 真机事故）

进入 `pages/semantic-primitives-demo` 页面**立即白屏**，console 第一行就是：

```
ReferenceError: MiniProgramError
buildPermissionManifest is not defined
    at di.onLoad (weapp:///pages/semantic-primitives-demo.js:226:5)
```

根因：plugin-vite 共享模块 import 扫描正则 `.*?from` 无 `s` 标志，**跨行 named import**
（`import {\n  …\n} from '@proteus-vue/desktop'`）漏扫 → `@proteus-vue/desktop` 不进共享模块
`_proteus/` → 页面产物零 `require('../_proteus/desktop.js')` → onLoad 引用未定义符号 → 白屏。

**此前错误操作**：页面已白屏，却仍去抓元素/点按钮（无规范乱跑），浪费大量轮次才回来看 console。
**规范后正确操作**：进页 → console 门禁立即红 → 直接定位产物丢 require → 修编译器 → 重编 → 门禁绿 → 才继续。

## 链路总览（顺序不可颠倒）

```
┌─ 0 门禁：wechatide CLI 可用 + 登录态 + 授权（check_wechatide_status）
├─ 1 开窗/编译：open_project_window → simulator_open_page <目标页>
├─ 2 ★console 零错门禁：get_simulator_console grep error → 必须零命中（白屏/ReferenceError 在此暴露）
│     └─ 红 → 停：读报错 → 修产物/源码 → 重新 build:mp → 回 1（严禁越过本步）
├─ 3 运行时确认：automation_runtime_info currentPage → route == 目标页
├─ 4 data 就绪断言（稳通道）：automation_evaluate 读关键 data（初始态）
├─ 5 元素断言：automation_element_action / automation_page_action（querySelectorAll → 读 → tap）
├─ 6 交互回读：交互后 data 变化断言（evaluate 再读）
└─ 7 取证/收尾：simulator_screenshot + 复位（setData 归零 / reLaunch 离开）
```

## 工具面（wechatide CLI，clientName 需授权）

```bash
WECHATIDE="/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide"
$WECHATIDE -c zed check_wechatide_status --skill-version <SKILL_VERSION>   # 门禁 0
$WECHATIDE -c zed open_project_window --project <absDist> --window-mode fullMode   # 门禁 1（★fullMode 才有 automator 运行时）
$WECHATIDE -c zed simulator_open_page --project <absDist> --page pages/xxx  # 门禁 1
$WECHATIDE -c zed get_simulator_console --project <absDist> --command 'grep -iE "error|exception|not defined"'  # ★门禁 2
$WECHATIDE -c zed automation_runtime_info --project <absDist> --action currentPage  # 门禁 3
$WECHATIDE -c zed automation_evaluate --project <absDist> --fn-source 'function(){ … }'  # 门禁 4/6（读 data）
$WECHATIDE -c zed automation_element_action --project <absDist> --action tap --selector 'button'  # 门禁 5
$WECHATIDE -c zed simulator_screenshot --project <absDist> --path <out.png>  # 取证
```

工具能力表、参数 → docs/wechatide-skill（`automation_runtime_info` / `automation_evaluate` /
`automation_element_action` / `automation_page_action` / `get_simulator_console` /
`simulator_open_page` / `simulator_screenshot`）。**行为随 Electron 版 IDE，勿套旧 automator 语义。**

## 门禁细则

### 0 · 环境门禁

| 检查 | 通过 | 失败处理 |
|---|---|---|
| CLI 可用 | `wechatide -c <client> check_wechatide_status` 返回 ok | 路径错 → 确认 Electron 版安装路径；未装 → installer scene |
| 登录态 | `loginExpired: false` | `login`（扫码，主动轮询 taskId 至 success） |
| 版本 | `versionRelation: equal` / `agent_ahead` | 处理同 wechatide-skill environment-readiness |
| 授权 | 首次调用触发 auth → `polling_task_result` 轮询至 `authorization_success` | 用户拒绝 → 停 |

### 1 · 开窗与编译

- **fullMode** 开窗（liteMode 无 automator 运行时——2026-09-07 实测 automation 工具超时）。
- `simulator_open_page` 显式编译打开目标页（纯 open 可能停首页）。
- 编译后等待渲染稳定：`sleep 3-8` 或 `automation_element_action --wait`。

### 2 · ★console 零错门禁（全链路最重要）

**每个页面进入后第一动作**：

```bash
wechatide -c zed get_simulator_console --project <absDist> --command 'grep -iE "error|exception|ReferenceError|not defined|is not a function|MiniProgramError"'
```

- **返回空 = 门禁绿**（注意：工具返回空字符串 = 无匹配，≠ console 无日志）。
- **非空 = 门禁红** → 立即停止一切元素操作：
  1. 读完整报错行（放宽 pattern：`grep -n .` 全量看上下文）；
  2. 归类：`ReferenceError: xxx is not defined` → 产物丢 import/require（编译器共享模块扫描/剥离 bug）；
     `Fatal`/`SyntaxError` → WXML/JS 平台编译错；组件告警（warn 级）不阻断但记录；
  3. **修产物/源码 → 重新 `build:mp`（必要时清 `examples/node_modules/.cache/proteus`）→ 回门禁 1 重进页面**；
  4. 严禁带着已知白屏/报错继续抓元素或断言渲染。

> 门禁红是「自动化提前抓到 bug」的价值时刻（本次 buildPermissionManifest 白屏即此门禁该拦下）——
> 修复后该页面必须能在本门禁下稳定绿，再谈后续。

### 3 · 运行时确认

`automation_runtime_info --action currentPage` → 断言 `route == pages/<目标>`。
（失败多为窗口未激活/页面未编译——回门禁 1。）

### 4 · data 就绪断言（稳通道）

`automation_evaluate --fn-source 'function(){ const p=getCurrentPages()[getCurrentPages().length-1]; return {route:p.route, <key>:p.data.<key>} }'`
断言初始态（弹层族：`drawerOpen/popoverOpen/sheetOpen === false` 等）。evaluate 是**最稳通道**
（不受元素层激活态影响）——所有「状态断言」优先走它。

### 5 · 元素断言（才允许碰元素）

顺序：`querySelectorAll`（核对选择器）→ `text/attribute`（读）→ `tap`（交互）。
选择器用 WXML 真实标签（页面原生 `button`/`view`；**自定义组件 p-* 内部节点用 `p-button button` 类路径**）。
元素层受模拟器激活态影响（可能超时）→ 超时先回门禁 2/3 确认页面健康，勿死循环重试。

### 6 · 交互回读

交互后**必须** evaluate 回读 data 断言（如 tap「打开抽屉」→ `drawerOpen === true`），
不要只信 tap 返回 ok（tap 成功 ≠ 业务生效）。

### 7 · 取证与复位

- `simulator_screenshot` 存证（每关键步骤一图）。
- 用例结束复位：evaluate `setData({…:false})` 或 `reLaunch` 离开，保证下一用例独立（05 铁律延续）。

## 已登记页面健康台账（进入即跑门禁 2）

| 页面 | 产物 | console 门禁 | 备注 |
|---|---|---|---|
| pages/semantic-primitives-demo | dist/mp-weixin | ✅ 绿（2026-09-07 修后） | 曾红：`buildPermissionManifest is not defined`（plugin 跨行 import 漏扫 → 丢 desktop require）→ 已修 |

新增被测页 → 先在本台账登记 + 门禁绿，再写元素断言。
