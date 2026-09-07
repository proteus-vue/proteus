# 09 · v0.6 分批执行（App 渲染器 + Vapor）

> 原则：每批独立提交、全绿后下一步；实现待 v0.5 稳定 + npm 发布后启动（真实 App 工程需要发包后的脚手架）。
> 前置依赖：module-plan（分包/模块桶）· platform-plan（capabilities app adapter）· pinia-plan（状态桥）。

## 批次

| Batch | 内容 | 文件 | 产出 | 验证 |
|-------|------|------|------|------|
| B1 | renderer-app 骨架 | 01-app-renderer.md §2 | `createRenderer` + 最小 host（view/text/事件）+ 空原生工程 | 最小 SFC 渲染单测 |
| B2 | host config 完整 | 01-app-renderer.md §2-3 | props/样式/事件/diff + iOS/Android 视图实现 | 双平台渲染验证 |
| B3 | App 路由/状态桥 | 01-app-renderer.md §4 | router app adapter（routeType 原生转场）+ Pinia 同步 | 守卫/参数/routeType App 端可用 |
| B4 | capabilities app adapter | platform-plan 05 | 原生能力桥（登录/分享/生物识别） | 三端契约测试 |
| B5 | App demo | 00-overview.md §6 | 同一份示例代码 iOS/Android 跑通 | 双平台 demo 验收 |
| B6 | Vapor Web 模式 | 02-vapor.md | 双模式可编译 + 特性矩阵 + 基准 | 构建通过 + 基准达标 |

## 依赖链

```
B1 ──► B2 ──► B3 ──► B5
        │
        └──► B4（复用 platform-plan capabilities）
B6（独立：Vapor Web，依赖 vue/vapor 生态成熟）
```

## 进度追踪

| Batch | 状态 | 说明 |
|-------|------|------|
| B1-B5 | ⬜ 待启动 | 前置：v0.5 稳定 + npm 发布 |
| B6 | ⬜ 待启动 | 依赖 @vue/vapor 生态 |

## 上下文预算（防撑爆）

- 每批喂入：00-overview.md + 当前批次文件（≤3）
- B2（host config 完整）单独一批（iOS/Android 双平台工作量）
