# 00 · v0.6 App 原生 + Vapor 兼容（路线图收尾规划）

> 前置：roadmap §4 v0.6（App 端 Vue 自定义渲染器 + Web 端 Vapor 模式）
> 原则（roadmap 架构要点）：App 端 = **运行时渲染通道**（Vue 官方渲染器，非自研 diff），与 Web/MP 的编译期通道并列；Vapor 与 Proteus 哲学同构（都拒绝虚拟 DOM），互为镜像。
> 本规划是 v0.6 的**批次执行细化**（module-plan / platform-plan 同款风格），实现待 v0.5 稳定 + npm 发布后启动。

## 1. 核心主张

**业务代码 = 标准 Vue SFC 三端复用**：

```
同一份 .vue 源码
├── Web        → Vite ESM（Vapor 模式可选，v0.6）
├── 微信小程序  → Proteus 编译期通道（已交付：编译 → wxml/wxss/js/json）
└── App 原生    → Vue 自定义渲染器（运行时通道，v0.6）
                   ├── iOS / Android 原生视图
                   ├── 路由/状态桥（复用 Router/Pinia API）
                   └── 原生能力（复用 platform-plan capabilities 体系，app adapter）
```

**关键区分**：
- Web/MP 走**编译期**（产物分平台）——已交付
- App 走**运行时**（Vue 官方 createRenderer 渲染原生视图）——v0.6
- 两条通道共享：源码、Router API（守卫/参数/routeType）、Pinia、capabilities 契约

## 2. 架构分层

```
L4 业务代码（标准 Vue SFC）
    ├── Web/MP 通道：编译期（现有）
    └── App 通道：运行时（v0.6）
        ├── @proteus/renderer-app：createRenderer 自定义 host config
        │     ├── view/text 原生视图（iOS UIView / Android View）
        │     ├── 事件桥接（Vue 事件 → 原生手势）
        │     └── diff 策略（Vue 运行时 diff → 原生视图更新）
        ├── @proteus/router app adapter：原生导航栈 + routeType 转场
        ├── Pinia 原生侧 state 同步
        └── capabilities app adapter（原生能力：登录/分享/生物识别...）
```

## 3. Vapor 兼容

**主张**：`@vue/vapor` 编译 Web（无虚拟 DOM、更小包体、更快）+ Proteus MP 编译管线并存——**同一份源码双模式可编译**。

- Vapor 的 codegen 借鉴已落地（v0.4：setData 依赖追踪 = Vapor reset/effect 同构）
- v0.6：Web 端 Vapor 模式构建通过 + 特性子集兼容矩阵
- 互为镜像：Vapor 无虚拟 DOM ↔ Proteus MP 产物无 DOM；Proteus 产物契约可作为 Vapor 多端化参考

## 4. 依赖

- module-plan（跨模块/分包：App 端分包/模块桶）· platform-plan（capabilities：app adapter）· pinia-plan（状态桥）
- 前置：v0.5 多端扩展稳定 + npm 发布（真实 App 工程需要发包后的脚手架）

## 5. 批次总览（详见 09-execution-batches.md）

| Batch | 内容 | 工程量 |
|-------|------|--------|
| B1 | renderer-app 骨架（createRenderer + 最小 host config） | 中高 |
| B2 | host config 完整（view/text/事件/diff + 原生视图） | 高 |
| B3 | App 路由/状态桥（router app adapter + Pinia 同步） | 中高 |
| B4 | capabilities app adapter（原生能力桥，复用 platform-plan） | 中 |
| B5 | App demo（同一份示例代码 iOS/Android 跑通） | 中高 |
| B6 | Vapor Web 模式（双模式可编译验证 + 特性矩阵 + 基准） | 中高 |

## 6. 验收

- [ ] App demo（iOS/Android）用 Vue 自定义渲染器跑通同一份示例代码
- [ ] Web 端 Vapor 模式构建通过；同一份源码双模式可编译（Vapor Web + Proteus MP）
- [ ] setData 依赖追踪基准达标（v0.6 对照 Vapor 运行时）
- [ ] 能力体系（capabilities）app adapter 三端（web/skyline/app）完整
