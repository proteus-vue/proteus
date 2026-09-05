---
title: 启动流程与更新机制
order: 15
group: 运行期
---

# 启动流程与更新机制

## 各端启动流程

### 小程序端（mp-weixin）

```
npm run build:mp
  ├─ gen-routes        扫描 pages → app.json / page.json / auto-routes
  ├─ vue-tsc           类型检查
  └─ vite build        每页 SFC 编译 → dist/mp-weixin/ 四件套
                          │
微信开发者工具导入 ──► app.js 骨架（框架自动生成）──► 页面 Page() 实例化
```

- `app.js` 骨架由构建期自动拼装：应用生命周期注册 + `getApp().__proteusProvides` 全局注册表初始化
- 页面按需注入：Skyline 下 `lazyCodeLoading` 由 gen-routes 写入，未访问页面代码不注入

### Web 端（web）

```
npm run dev:web（Vite dev + HMR）    /    npm run build:web（vue-tsc + vite build）
        │
main.ts：createApp → installWebPlatform（内置组件 + wx API 模拟）→ router → 挂载
```

标准 Vite SPA——启动无额外框架层。

### 其他端

| 端 | 启动载体 | 状态 |
|---|---|---|
| Headless（SSR / 测试） | Node 直启（mock 桥注入） | ✅ |
| iOS / Android / 鸿蒙 | JSI 载体（G-40）——JS 逻辑层随宿主启动 | 🟡 端原型映射 |
| Flutter 混合 | 同一 JS 逻辑层（Flutter 引擎侧宿主） | 🟡 |
| 快应用 | 待定 | ⬜ |

> 端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

## 更新机制

- **开发期**：`npm run dev:mp` 提供 Vite watch（gen-routes 增量）；日常迭代建议直接 `build:mp` + 开发者工具热重载
- **Web 端**：标准 Vite HMR（开发期）与静态产物替换（部署期）
- **小程序审核发布**：`dist/mp-weixin/` 上传 → 提审 → 发布，走微信平台流程；编译期静态声明的页面表保证每次上传都是完整可审计的产物

## 调试工具链

| 工具 | 用途 |
|---|---|
| `npm run debug:mp` | 全链路调试构建（`PROTEUS_DEBUG=1`：`[proteus][环节]` 日志 + 决策链文件） |
| `npx proteus explain <file>` | 单文件编译决策 trace |
| `npx proteus rules` | 规则能力清单 |
