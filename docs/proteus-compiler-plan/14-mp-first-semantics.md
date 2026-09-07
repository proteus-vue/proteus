# 14 - MP 优先语义：小程序组件/API 为标准，Web 端反向对齐（uni-app 思路）

> 状态：✅ 批次 1-3 完成，批次 4 收尾中（交互层视觉对齐已完成，2026-08-30）
> 决策：以小程序内置组件 + API 为标准——开发者直接用小程序语义（`<view>`/`<button open-type>`/wx API），MP 端原生跑，**Web 端由框架自定义组件/API 模拟层完全对齐**——不再手动补小程序内置组件能力
> 方法论：视觉对齐流程已沉淀为 **规划 17（weui-io-alignment）**——weui.io 官方实测 + CDP 断言 + 用户真机优先

## 一、动机（用户提出）

当前 p-* 内置组件设计两大问题：
1. **根节点样式穿透**：已修（root-class 透传，2026-08）
2. **不兼容小程序内置组件**：小程序开放能力（`open-type`：share/contact/getUserInfo/getPhoneNumber/launchApp…；`open-data`；`ad`；`web-view`；`navigator`…）与 wx API 无法直接使用——MP 端虽透传，但 **Web 端无对等实现**，开发者要么绕道 p-* 组件、要么放弃小程序能力

**方向**：以小程序为标准，Web 端反向对齐（uni-app 思路）——小程序生态能力天然全开，Web 端框架补模拟层。

## 二、现状盘点

| 能力 | MP 端 | Web 端 |
|---|---|---|
| 小程序原生标签（view/text/button…） | ✅ 透传（NATIVE_TAGS 原样输出） | ❌ 无模拟（Vue 渲染原生 HTML，open-type 等属性无意义） |
| 小程序开放能力（open-type/open-data/ad/web-view） | ✅ 原生 | ❌ 无 |
| wx API（navigateTo/showToast/setStorage…） | ✅ 原生 | ❌ 无（@proteus-vue/api 是业务 HTTP 客户端，非 wx 模拟） |
| Vue/HTML 语义（div/p/h1 + p-* 组件） | ✅ 映射/自定义组件 | ✅ 原生 |

**结论**：缺口全在 Web 端——需要「小程序组件 Web 模拟层」+「wx API Web 模拟层」。

## 三、三层语义并存（不破坏现有）

| 层 | 示例 | MP 端 | Web 端 |
|---|---|---|---|
| **小程序语义**（新，本计划） | `<view>` / `<button open-type="share">` / `wx.navigateTo` | 原生直通 | 框架 Vue 组件 + API 模拟 |
| Vue/HTML 语义（现有） | `<div>` / `<p>` / `<h1>` | 映射 view/text | 原生 HTML |
| 框架增强组件（现有） | `<p-view>` / `<p-button>` | 自定义组件 | Vue 组件 |

开发者按场景选择：要小程序能力 → 写小程序语义；要 Vue 标准 → 写 HTML/p-*。

## 四、Web 模拟层设计

### 4.1 组件模拟（新包 `@proteus-vue/web` 或并入 renderer-app）

小程序组件 → Vue 自定义组件（对齐属性 + 行为）：
- 基础：view/text/button/input/textarea/image/scroll-view/navigator/icon/progress/switch/slider/label/checkbox/radio/form…
- 容器：swiper/movable-view/cover-view…
- **开放能力**：`open-type` 无 Web 微信对等 → **触发自定义事件**（`openshare`/`opencontact`/`opengetuseroinfo`…）+ 可选 Web 能力（Web Share API）；`web-view` → iframe；`ad` → 占位 + 警告（反黑盒）

### 4.2 API 模拟（wx.* → Web 实现）

| 能力 | Web 实现 |
|---|---|
| 路由 navigateTo/navigateBack/switchTab/redirectTo | 框架路由（复用 @proteus-vue/router） |
| 存储 setStorage/getStorage/removeStorage | localStorage |
| 交互 showToast/showModal/showLoading/showActionSheet | DOM 层实现（复用 runtime 组件样式） |
| 系统信息 getSystemInfo/getDeviceInfo | 浏览器信息 |
| 网络 request | fetch 封装（可对接 @proteus-vue/api） |
| 业务能力（支付/扫码/分享面板等） | 触发事件降级 + 透明文档 |

### 4.3 注册方式

- vite 插件（web 模式）：自动注册全局小程序组件 + 注入 wx API 模拟（开发者零配置）
- 或显式 `app.use()`（按需）

## 五、能力矩阵与降级原则（反黑盒）

- 每个模拟组件/API 标注能力状态：`full`（完整对齐）/ `partial`（部分）/ `event`（仅触发事件，Web 无对等）/ `warn`（不支持，编译期警告）
- Web 端使用无对等能力 → 触发事件让开发者自定义（透明，不静默丢弃）
- 类型：小程序组件属性类型（global-components 扩展）+ wx API 类型（api-types 扩充）

### 5.1 组件能力矩阵（12 个已覆盖，2026-08-30）

| 组件 | 状态 | 对齐要点 | 备注 |
|---|---|---|---|
| view | ✅ full | block 容器、selectable 文本可选 | proteus-view |
| text | ✅ full | inline、selectable | proteus-text |
| button | ✅ full | 微信默认样式（灰底 #f8f8f8/18px/行高 2.556/::after 细边框/hover 按压缩放）+ open-type 降级事件 | proteus-button；open-type 无 Web 对等 → 触发 openshare 等事件 |
| input | ✅ full | 无边框/透明背景、@input 载荷 { detail: { value } } | proteus-input |
| textarea | ✅ full | 默认高度 150px（微信组件默认）、无边框 | proteus-textarea |
| image | ✅ full | mode 映射（widthFix 等）、懒加载、块级 | proteus-image |
| scroll-view | ✅ full | 双端滚动 + 页面滚动容器（规划 15） | proteus-scroll-view |
| switch | ✅ full | iOS 过渡：关态浅灰轨 + 开态绿底绿边、纯白滑块 + 轻阴影、wash 白色扩散方向区分 | 与 slider 滑块类名分离（.pws-thumb/.pws-slider-thumb） |
| slider | ✅ full | 2px 滑轨 #e9e9e9 + 绿填充 + 28px 白滑块 + 阴影、自定义结构 | 内部 val ref（受控） |
| icon | ✅ full | 14 图标内联 SVG、彩色圆底 + 白图形、color 覆盖所有主色、success 毛笔勾 4 段 stroke | 与 toast 图标（无底色）区分 |
| progress | ✅ full（双通道） | Web 原生 progress + Skyline 降级自定义 view 进度条（规划 16） | 编译器 serializeProgress |
| navigator | ✅ full | 继承色无下划线、url 跳转 | proteus-navigator |
| picker | ⬜ 待专项 | 复杂组件（规划批次 4 后续） | — |
| swiper | ⬜ 待专项 | 复杂组件（规划批次 4 后续） | — |

### 5.2 wx API 能力矩阵（2026-08-30）

| API | 状态 | 对齐要点 | 备注 |
|---|---|---|---|
| navigateTo / redirectTo / reLaunch / switchTab | ✅ full | 代理 PlatformAdapter（history 驱动 RouterView） | routeType 转场参数透传 |
| navigateBack / getCurrentPages | ✅ full | adapter 代理 | — |
| pageScrollTo | ✅ full | MP 桥接自动包装 scroll-view / Web window.scrollTo（规划 15 批次 3） | — |
| setStorageSync / getStorageSync / removeStorageSync / clearStorageSync | ✅ full | localStorage JSON 序列化 | — |
| getSystemInfoSync / getDeviceInfo | ✅ full | 浏览器信息字段 | — |
| showToast | ✅ full | weui.io 像素级对齐：默认 icon success、不透明 #4c4c4c、132 方形/min 132/max 320、图标 40px + 16px 间距、位置居中 | 用户真机优先（居中） |
| showModal | ✅ full | weui.io 像素级对齐：宽 320px、三种样式（双按钮/单按钮/editable）、返回 { confirm, cancel, errMsg } | WeUI 蓝 #576b95 / 取消黑 |
| showActionSheet | ✅ full | weui.io 像素级对齐：cell 56px、hairline 分割线、取消 8px 间距、:active #ececec | — |
| showLoading / hideLoading | ✅ full | 常驻 spinner + hideLoading 关闭 | — |
| hideToast | ✅ full | 移除全部 toast DOM | — |
| request | ✅ partial | fetch 封装 + 非 2xx fail | 未对齐超时/取消 |
| requestPayment | ⬜ event | 无 Web 对等 → 触发自定义钩子 proteusWebPay 或警告 | 反黑盒降级 |

### 5.3 能力状态图例

- ✅ full：完整对齐（双端视觉/行为一致，CDP 断言或测试覆盖）
- ⬜ partial：部分对齐（标注缺口）
- ⬜ event：仅触发事件，Web 无对等能力（透明降级）
- ⬜ 待专项：未实现，列入后续批次

## 六、批次（✅ 1-3 完成）

- **批次 1** ✅：Web 组件模拟层骨架——view/text/button/input/image + `open-type` 事件降级机制 + vite 自动注册 + 类型（★标签改写 proteus-*：Vue 编译器无连字符标签不 resolveComponent，CDP 实测根因）
- **批次 2** ✅：wx API 模拟层——路由（adapter 代理）/存储（localStorage）/系统信息 + 交互自定义 UI（toast/modal/actionSheet 对齐微信视觉 + 图标/spinner）/网络（fetch + 非 2xx fail）；wx.pageScrollTo（规划 15 批次 3 联动）
- **批次 3** ✅：扩展组件——scroll-view（规划 15）/textarea/switch/slider/icon/progress/navigator + 微信默认样式对齐层（style.css）+ 能力矩阵文档
- **批次 4**（收尾中）：examples 小程序语义示例页完善 + 双端实测 + 能力矩阵文档（picker/swiper 等复杂组件后续专项）
  - ✅ 交互层视觉对齐（2026-08-30，用户逐组件验收，方法见规划 17）：toast/modal/actionSheet 已按 weui.io 官方像素级对齐（CDP 实测对比 + hairline 分割线 + 用户真机优先：toast 居中、modal 宽 320px）；switch（iOS 过渡 wash）/slider（2px 滑轨 + 28px 滑块）/icon（毛笔勾 + color 全覆盖）/progress（Skyline 降级，规划 16）/button（微信默认样式 + ::after 细边框 + hover）
  - ✅ 能力矩阵文档（§5.1 组件 12 个 + §5.2 wx API 15 项，full/partial/event/待专项 状态标注）
  - 待办：picker/swiper 等复杂组件专项（按规划 17 方法论继续）

## 七、风险与权衡

- **Web 对齐成本**：小程序组件行为复杂（picker/swiper/地图等）——按能力矩阵分批覆盖，`partial` 状态透明标注
- **开放能力无 Web 对等**：触发事件降级（反黑盒），用户自定义 Web 端行为
- **定位偏移**：以小程序为标准偏离"标准 Vue SFC"——但 MP 原生 + Web 对齐是 uni-app 验证过的路线；Vue/HTML 语义层保留（兼容既有）
- **p-* 组件**：保留（增强层），与小程序语义层共存不冲突

## 八、验收

- [ ] `<view>`/`<button open-type>` 等小程序标签双端可用（MP 原生 / Web 模拟对齐）
- [ ] wx.* 核心 API 双端可用（Web 模拟行为对齐）
- [ ] 开放能力无 Web 对等时触发事件 + 透明标注
- [ ] 现有 Vue/HTML 语义 + p-* 组件不受影响
- [ ] 测试 + examples 小程序语义示例页 + 能力矩阵文档
