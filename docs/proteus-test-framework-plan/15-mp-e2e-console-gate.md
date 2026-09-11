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
| ★渲染模式 | `project.private.config.json` 的 `setting.skylineRenderEnable` 与页面目标一致（skyline 页面 → `true`） | 先改 private 配置再编译（见下「渲染模式指定」） |

#### ★渲染模式指定（2026-09-07 真机教训）

**背景**：同页面在 **skyline 模式正常、webview 模式报渲染层错误**（如 rich-text 等 glass-easel
组件在 webview 下降级渲染 → `[渲染层错误] Cannot set properties of undefined (setting 'textContent')` /
`TypeError: SystemError (webviewScriptError)`）。渲染层错误**不进逻辑层 console buffer**（`get_simulator_console`
抓不到）——自动化默认落在 webview 模式会误报/误判，必须先锁渲染模式。

**根因**：渲染模式由 IDE 管理的 `project.private.config.json`（gitignored）决定：

```json
{ "setting": { "skylineRenderEnable": false } }   // ← GUI 切过 WebView 后残留 → 自动化默认 webview
```

**指定方法**（官方 project-config scene 字段 `setting.skylineRenderEnable`）：

```bash
# 测试前将目标产物 private 配置强制为 skyline（skyline:true 的项目）
cat > <dist>/project.private.config.json <<'EOF'
{
  "setting": { "skylineRenderEnable": true }
}
EOF
# 改后必须重编译页面（simulator_open_page）才生效
```

**注意**：
- `simulator_open_page` 等工具**无渲染模式参数**——只能改 private 配置；
- IDE 会在 GUI 切渲染模式时覆写 private（残留上次选择）→ 自动化每次测试前显式检查/写入，不依赖上次状态；
- 页面 json `"renderer": "skyline"` 存在 ≠ 实际 skyline 渲染（private false 会降级 webview）。

### 1 · 开窗与编译

- **fullMode** 开窗（liteMode 无 automator 运行时——2026-09-07 实测 automation 工具超时）。
- `simulator_open_page` 显式编译打开目标页（纯 open 可能停首页）。
- 编译后等待渲染稳定：`sleep 3-8` 或 `automation_element_action --wait`。

### 2 · ★console 零错门禁（全链路最重要）

**每个页面进入后第一动作**。★门禁判定**必须全量抓取后在本端逐行解析**，不可信 IDE grep 子命令的空返回
（官方明确「返回空 = 无匹配行，≠ console 为空」——pattern 写法失效会假绿）：

```bash
# ① 全量抓取（官方 debugger 标准写法）
wechatide -c zed get_simulator_console --project <absDist> --command 'grep -n .'
# ② 本端逐行解析：error 级行（[error]/ReferenceError/not defined/MiniProgramError/Exception）计数必须为 0
```

- **本端解析 error 行数 = 0 = 门禁绿**。
- **非零 = 门禁红** → 立即停止一切元素操作：
  1. 读完整报错行（全量输出看上下文）；
  2. 归类：`ReferenceError: xxx is not defined` → 产物丢 import/require（编译器共享模块扫描/剥离 bug）；
     `Fatal`/`SyntaxError` → WXML/JS 平台编译错；组件告警（warn 级）不阻断但记录；
  3. **修产物/源码 → 重新 `build:mp`（必要时清 `examples/node_modules/.cache/proteus`）→ 回门禁 1 重进页面**；
  4. 严禁带着已知白屏/报错继续抓元素或断言渲染。

**⚠ 渲染层错误盲区**：`get_simulator_console` 只抓逻辑层 appservice console；**渲染层错误**
（GUI Console 面板渲染层 tab 的 `[渲染层错误]`/`webviewScriptError`，如 `Cannot set properties of
undefined (setting 'textContent')`）**不进该 buffer**。渲染层错误优先怀疑渲染模式（见门禁 0「渲染模式指定」——
skyline 页面在 webview 下降级渲染会报此类错）→ 先切 skyline 验证，非模式问题再按组件排查。

> 门禁红是「自动化提前抓到 bug」的价值时刻（本次 buildPermissionManifest 白屏即此门禁该拦下）——
> 修复后该页面必须能在本门禁下稳定绿，再谈后续。

**⚠ console 探针漏抓（2026-09-07 实测）**：`get_simulator_console` 对运行时 `console.log`（GUI Console 面板
可见，如组件内探针日志）**可能漏抓**——探针性验证（交互是否到达组件层）**勿用本工具判定**，改看 GUI 或
用状态断言（evaluate 读 data）。error 级行（ReferenceError/MiniProgramError 等）此前可被本工具捕获，
门禁「以 error 行数为 0」的判定仍可用。

### 3 · 运行时确认

`automation_runtime_info --action currentPage` → 断言 `route == pages/<目标>`。
（失败多为窗口未激活/页面未编译——回门禁 1。）

### 4 · data 就绪断言（稳通道）

`automation_evaluate --fn-source 'function(){ const p=getCurrentPages()[getCurrentPages().length-1]; return {route:p.route, <key>:p.data.<key>} }'`
断言初始态（弹层族：`drawerOpen/popoverOpen/sheetOpen === false` 等）。evaluate 是**最稳通道**
（不受元素层激活态影响）——所有「状态断言」优先走它。

### 5 · 元素断言（才允许碰元素）

顺序：`querySelectorAll`（核对选择器）→ `text/attribute`（读）→ `tap`（交互）。
选择器用 WXML 真实标签（页面原生 `button`/`view`）。

**★自定义组件边界（2026-09-07 实测）**：automator 元素查询**只看页面自身节点，看不到自定义组件内部**——
`p-button`/`.p-button`/组件内原生 `button` 均 `no such element` 或空数组（glass-easel 组件 DOM 隔离）。
因此 p-* 组件上的交互**无法用元素 tap 驱动**。对策：
- 交互等价驱动走 **evaluate 调页面方法**（按钮 bindtap 的 handler 即页面方法，如 `p.openDrawer()`）；
- 状态断言走 **evaluate 读 page data**（`p.data.drawerOpen`）；
- 组件内部事件契约（如 mask tap → onClose → `triggerEvent('update-modelValue')`）用**组件产物断言**
  （探针矩阵 P 系列 / headless mountMpComponent）而非真机元素层。

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
| pages/semantic-primitives-demo | dist/mp-weixin（skyline） | ✅ 绿（2026-09-07） | **渲染模式坑**：webview 下报 `[渲染层错误] Cannot set properties of undefined (setting 'textContent')`（rich-text 等 glass-easel 降级）——skyline 正常；根因 private `skylineRenderEnable: false` 残留 → 已改 true 消失（见门禁 0「渲染模式指定」） |
| pages/semantic-primitives-demo（skyline） | dist/mp-weixin | ✅ 绿（2026-09-07 e2e 回归） | **v-model handler 撞名修复后真机回归**：开→读→关→读 驱动 drawer/popover/sheet/switch/slider/tabbar/segment 全部独立回写通过（12 handler 逐一验证，产物 handler 名 `proteusUpdate{Model}Model` 不撞）；截图 `.proteus/e2e-mp/shot-drawer-open.png` |
| pages/semantic-primitives-demo（skyline）抽屉遮罩 | dist/mp-weixin | ✅ 已修（2026-09-07） | **p-drawer 点遮罩关不掉（skyline 真机）**：探针实证——组件内遮罩元素自身不参与命中（wx:if/常驻挂载均无效，事件落根容器；面板常驻却正常）；修法：事件挂可靠层（根容器收非面板区点击关闭 + 面板 `catchtap` 吞冒泡防误关），遮罩仅视觉层 + 容器 `visibility` 显隐。**弹层族通用教训：skyline 遮罩交互不要绑在遮罩元素上**（见下「Skyline 弹层命中测试实证」） |
| 弹层族批（skyline）action-sheet/modal/popup/popover 遮罩 | dist/mp-weixin | ✅ 已修（2026-09-07） | **P7 模式批量**：action-sheet/modal/popup 真机抽检遮罩点关 ✅（popover 结构同改，其 MP 触发缺口见下）；**popup 面板左上角** = 动态拼接类与动态 style 在 Skyline 均不可靠（p-modal 布局专项③④ 同因）→ 位置类改**静态字面量三形态分支**（bottom/top/center，scoped 必命中）后真机底部 ✅；p-popover MP trigger（slot 内 p-button 组件边界吞事件）点开无反应 → **✅ 已修（2026-09-11）**：原生 tap 不跨组件边界——p-button click 带 `{bubbles,composed}` 发射 + wrapper 增 `bind:click` 接收（双通道，零编译器改动；契约 P8e5/P10 锁定；真机待点一次确认） |
| Skyline 静态类收敛（2026-09-07 续） drawer/popover/popup | dist/mp-weixin | ✅ 已修 | **动态类插 scope 后缀插半截 bug**：模板类拼接字面量（`'p-popup-panel--' + phase`）被编译器插成 `---data-v-x` 畸形类 → 永不命中（位置/动画丢失根因）；p-drawer side→left/right 静态分支、p-popover placement→静态四分支、p-popup phase→computed 裸类名 + `<style global>` 动画规则。⚠ **「popup 无动画」已结案为工具环境假象**：开发者工具陈旧进程（cwd 失效致 uv_cwd ENOENT 预览失败）编译/渲染异常 → 重启工具后**模拟器 + 真机滑入滑出均正常**（无需 Worklet 兜底）；教训：真机/渲染异常先怀疑 IDE 陈旧进程 |
| p-popover MP 专项（2026-09-07） | dist/mp-weixin | ✅ 已解决 | **终案**：① gen-routes 组件 json 补 `componentFramework: glass-easel`（Skyline，此前只给页面加）；② 浮层弃 wx:if/root-portal（wx:if 子树 glass-easel 不渲染；portal 脱离破锚定→面板左上角），改**常驻 overlay + visibility 类切换**（对齐 p-drawer）——真机/模拟器：气泡锚定正常 + 点外关闭 ✅；契约 P8d 锁定；详见 semantic-primitives-plan/07 |
| p-drawer 双侧（2026-09-07） | dist/mp-weixin | ✅ 已验 | semantic demo 增右抽屉用例（side=right 静态分支产物）——**真机/模拟器：右抽屉贴右侧滑出 + 遮罩点关 ✅**（左抽屉同验）；早期「右抽屉关不掉」与 popup 动画同因 = 陈旧 IDE 编译产物假象（重编译即好）——**今日第三次同因，固化教训：交互异常先「重编译页面/重启工具」排除陈旧产物** |

### Skyline 弹层命中测试实证（2026-09-07 p-drawer）

- **遮罩元素（absolute/fixed 全屏子节点）在 skyline 下可能完全不参与命中测试**：wx:if 动态插入、
  常驻挂载 + class 显隐、fixed 容器 + absolute 布局（p-modal 同款）均试过，点遮罩只触发根容器事件，
  mask 自身 handler 永不触发；面板（同容器子节点）命中却正常。
- **可靠事件层 = 根容器**：fixed 全屏容器上 bindtap 收「非面板区」点击关闭；面板 catchtap（`.stop`）
  吞自身冒泡防误关；遮罩退化为纯视觉层。
- **遮罩尺寸用显式四边**（`top/left/right/bottom: 0`）：Skyline 不认 `inset` 简写 → 尺寸塌 0 → 遮罩透明
  （背景在却看不见；p-modal 同款写法）。
- **★自动化边界（为什么这类交互要至少一次人工）**：wechatide 工具面无页面坐标点击；元素树不含自定义
  组件内部节点（`p-drawer` 标签/`>>>` 深选择器/内部类均 no such element）→ **渲染层命中测试无法自动驱动**。
  人工只用于「命中层」一次性实证；结论以**产物契约测试（P7 探针）+ 本台账**固化，回归靠 vitest 拦截。
- 验证手段：产物内插分层探针（根 catchtap / 面板 tap / mask handler 各打日志）——日志在 **GUI Console
  可见但 `get_simulator_console` 可能漏抓**，由用户回报日志归属判定命中层。

新增被测页 → 先在本台账登记 + 门禁绿，再写元素断言。
