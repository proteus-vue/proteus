# 14 - MP 优先语义：小程序组件/API 为标准，Web 端反向对齐（uni-app 思路）

> 状态：✅ 批次 1-3 完成，批次 4 收尾中（交互层视觉对齐已完成，2026-08-30）
> 决策：以小程序内置组件 + API 为标准——开发者直接用小程序语义（`<view>`/`<button open-type>`/wx API），MP 端原生跑，**Web 端由框架自定义组件/API 模拟层完全对齐**——不再手动补小程序内置组件能力

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

## 六、批次（✅ 1-3 完成）

- **批次 1** ✅：Web 组件模拟层骨架——view/text/button/input/image + `open-type` 事件降级机制 + vite 自动注册 + 类型（★标签改写 proteus-*：Vue 编译器无连字符标签不 resolveComponent，CDP 实测根因）
- **批次 2** ✅：wx API 模拟层——路由（adapter 代理）/存储（localStorage）/系统信息 + 交互自定义 UI（toast/modal/actionSheet 对齐微信视觉 + 图标/spinner）/网络（fetch + 非 2xx fail）；wx.pageScrollTo（规划 15 批次 3 联动）
- **批次 3** ✅：扩展组件——scroll-view（规划 15）/textarea/switch/slider/icon/progress/navigator + 微信默认样式对齐层（style.css）+ 能力矩阵文档
- **批次 4**（收尾中）：examples 小程序语义示例页完善 + 双端实测 + 能力矩阵文档（picker/swiper 等复杂组件后续专项）
  - ✅ 交互层视觉对齐（2026-08-30，用户逐组件验收）：modal（标题 17px/600 + 28px 顶距、内容 15px #888、按钮 ~49px、分割线 #e5e5e5、宽 300px）/ actionSheet（取消按钮黑字 #000 + 8px 间距、分割线 #e5e5e5）/ toast（icon 40px 圆 + 22px 符号）/ switch（iOS 过渡：wash 扩散方向区分）/ slider（2px 滑轨 + 28px 滑块）/ icon（毛笔勾 4 段 stroke 递变 + color 全覆盖）/ progress（Skyline 降级自定义 view 进度条，规划 16）/ button（微信默认样式 + ::after 细边框 + hover 按压缩放）
  - 待办：picker/swiper 等复杂组件专项 + 能力矩阵文档补全

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
