# 快速开始

> Proteus 是 Vue 跨端编译框架：**一份标准 Vue SFC 源码，Web 零转换直跑，微信小程序编译为 Skyline 原生四件套**。

## 环境要求

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 构建工具链 |
| npm | 随 Node | 依赖管理 |
| 微信开发者工具 | 最新稳定版 | 小程序端调试（需真实 AppID） |
| 微信基础库 | ≥ 2.29.2 | 启用 Skyline 渲染与 `wx.router` 自定义路由 |

> 无真实 AppID 时可在开发者工具「详情 → 基本信息」使用测试号，但 Skyline 能力建议用真实 AppID 验证。

## 安装

```bash
git clone https://github.com/proteus-vue/proteus.git
cd proteus
npm install
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev:web` | Web 端开发（Vite dev server，完整 HMR + devtools） |
| `npm run build:web` | Web 端构建（vue-tsc 类型检查 + vite build）→ `dist/web/` |
| `npm run preview:web` | 预览 Web 构建产物 |
| `npm run dev:mp` | 小程序端 Vite dev（插件直出产物；日常迭代建议用 build:mp / debug:mp） |
| `npm run build:mp` | 小程序端正式构建（gen-routes → vue-tsc → vite build） |
| `npm run debug:mp` | 小程序端**全链路调试构建**（`PROTEUS_DEBUG=1`，注入 `[proteus][环节]` 日志） |
| `npm test` | 79 个单元测试 |
| `npm run test:e2e:web` | 8 个 Web e2e（Playwright Chromium） |
| `npm run verify` | `test + build:web + build:mp` 一键全量验证 |

## 跑通 Web 端

```bash
npm run dev:web
```

浏览器打开 Vite 输出的地址（默认 `http://localhost:5173`），看到示例首页即成功。Web 端就是标准 Vite SPA：Vue 官方 devtools、HMR、按路由 code-split 全部可用，**零转换**。

## 跑通小程序端

```bash
npm run build:mp
```

产物在 `dist/mp-weixin/`：

```
dist/mp-weixin/
├── app.js / app.json / app.wxss
├── pages/          # 主包页面（每页 wxml / wxss / js / json 四件套）
└── subpackages/    # 分包
```

然后在微信开发者工具：

1. 「导入项目」→ 目录选择 `dist/mp-weixin/`
2. AppID 填入你 `proteus.config.ts` 中的真实 AppID（默认占位 `wx0000000000`，需替换）
3. 「详情 → 本地设置」勾选「调试基础库」并选择 **≥ 2.29.2**
4. 项目 `app.json` 已由 `gen-routes` 生成 Skyline 所需字段（`lazyCodeLoading: "requiredComponents"` 等）；各页面 `page.json` 已声明 `"renderer": "skyline"`

> 若「详情 → 本地设置」无 Skyline 选项，检查 `app.json` 是否含 `lazyCodeLoading`，以及页面级 `page.json` 的 `renderer` 字段（**不能**放在 `app.json` 的 `window` 里）。

## 第一个页面

在 `pagesDir`（默认 `examples/pages`）下新建 `hello.vue`：

```vue
<!-- examples/pages/hello.vue -->
<route>
{ "meta": { "title": "你好" } }
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div class="hello">
    <h1>Hello Proteus</h1>
    <p>tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
    <a href="/pages/index">返回首页</a>
  </div>
</template>

<style>
.hello { text-align: center; padding: 48px 0; }
</style>
```

要点：

- 业务代码只写**标准 HTML 标签 + 标准 Vue SFC**：`div→view`、`h1/p→text`、`img→image`、`a→view`（导航链接）等映射全部由编译器完成
- `h1-h6/p/a` 自动注入语义基础样式（对齐 Web UA：大标题 / 段距 1em / 链接色），两端视觉一致；用户样式特异性更高，可正常覆盖
- `<route>` 自定义块声明页面元信息（标题 / 是否 tab 页等），编译期由 `gen-routes` 读取生成 `app.json`
- `ref` 的读写：Web 端是 Vue 真实响应式；小程序端由编译器重写为 `setData`（方法内 `count.value++` → `this.setData(...)`）

重新构建后，Web 与小程序两端都能看到新页面。导航方式见[路由与转场](routing.md)。

## 调试

### 小程序全链路调试

```bash
npm run debug:mp
```

产物注入 `[proteus][环节]` 前缀日志，覆盖完整链路：

```
[proteus][app] 启动 1787904547228
[proteus][app] builder 注册: halfScreen / slideUp（官方形态）
[proteus][page] onLoad pages/index {}
[proteus][nav] tap {"routeType":"halfScreen","url":"/pages/user/profile"}
[proteus][nav] navigateTo /pages/user/profile
[proteus][nav] navigateTo success /pages/user/profile
```

正式 `build:mp` 零日志残留（grep 验证通过）。

### 产物自校验（反编译黑盒）

编译器内置产物校验：JS 语法错误 / WXML 标签不配对时**当场抛错并指明文件**，绝不静默输出不可用产物。

### Web 端调试

标准 Vite 工具链：浏览器 devtools + Vue devtools + HMR。Web 端转场调试关注 `RouterView.vue`（Vue Transition 层叠转场）。

## 常见问题

**Q：`tabBar` 报"需至少包含 2 项"？**
微信平台要求 `tabBar.list ≥ 2`。`gen-routes` 已加守卫：`isTab: true` 页面不足 2 个时告警并忽略 tabBar。tab 页在 `<route>` 块用 `"isTab": true` 声明。

**Q：自定义路由（半屏/转场）点了没反应？**
自定义路由是 Skyline 平台能力，**不能从 tabBar 页面发起**（报 `applyAnimatedStyle can not find corresponding nodes`）。请从非 tab 页发起跳转（示例已把演示链接放入非 tab 页）。

**Q：`routeType` 在 Web 端不生效？**
Web 无 Skyline 对等机制，`routeType` 被优雅忽略，但导航行为一致；Web 端转场用 Vue `<Transition>` 复刻同一套 API（halfscreen/slide-up/scale 等）。详见[路由与转场](routing.md#web-端转场)。

**Q：页面里 `computed` / `watch` 报编译警告？**
MVP 暂不支持（编译期警告），后续版本规划。
