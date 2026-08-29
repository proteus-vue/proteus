# 00 — 架构总览与阶段定义

## 一、为什么需要阶段化生命周期

小程序原生只提供 4 个 App 钩子：`onLaunch / onShow / onHide / onError`。
这在"能跑"层面够用，但超级应用需要更细的控制：

| 场景 | 4 钩子够吗 | 原因 |
|------|-----------|------|
| 首屏渲染完成 | ❌ | `onLaunch` 到可交互之间差了多步 |
| 热启动 vs 冷启动 | ⚠️ | `onShow` 不区分 |
| 页面被系统回收 | ❌ | 小程序无 `onDestroy` |
| 网络变化 | ❌ | 需切画质/暂停视频 |
| 内存警告 | ❌ | 需主动释放缓存 |
| 启动某步失败 | ❌ | 无阶段概念，不知卡在哪 |

**结论**：不是加钩子数量，而是把启动拆成**可编排的阶段（Phase）**。

## 二、三层生命周期

```
App 级（全局一次）    bootstrap → coreReady → navigationReady → beforeFirstPaint → interactive
                       ↑ runtime: onShow / onHide / onMemoryWarning / onNetworkChange
                       ↑ terminal: onDestroy / onRecover
页面级（每页一次）    onLoad → onReady → onShow → onHide → onUnload
组件级（组件生命周期）  setup → attached → ready → detached
```

三端映射：
- Web → Vue `app.mount()` + `window` 事件
- Skyline → `App()` + `Page()` + glass-easel 生命周期
- App → Custom Renderer 对接原生 `UIApplication` / `Activity`

## 三、五阶段启动管线（核心）

```
┌─ Phase 1: Bootstrap ─────────────────────┐
│  Platform capability 探测                  │
│  Module 注册表加载                          │
│  共享依赖（@vue/reactivity）初始化          │
├──────────────────────────────────────────┤
│  Phase 2: Core Ready                      │
│  Pinia store 创建 + 持久化恢复             │
│  API request + auth token 刷新             │
│  关键 Module 激活                          │
├──────────────────────────────────────────┤
│  Phase 3: Navigation Ready                │
│  Router 路由表解析完成                      │
│  分包预加载（preloadRule）                  │
│  深层链接 / 扫码 path 处理                  │
├──────────────────────────────────────────┤
│  Phase 4: Before First Paint              │
│  根组件挂载                                │
│  全局组件（appBar / 播放条）渲染            │
│  首屏数据请求触发                           │
├──────────────────────────────────────────┤
│  Phase 5: Interactive                     │
│  首屏数据返回 + 渲染完成                    │
│  非关键 Module 懒加载                       │
│  启动耗时 trace 上报                        │
└──────────────────────────────────────────┘
```

## 四、铁律

1. **阶段顺序固定**：业务不可调换 Phase 1-5 顺序
2. **阶段可异步 + 可超时**：默认超时 3s，可配
3. **超时即降级**：不阻塞后续阶段，走 fallback
4. **错误隔离**：某层失败 → 该层降级 → 其他层继续
5. **冷热分离**：`onLaunch` 携带 `launchType: 'cold' | 'warm' | 'recover'`
6. **可追踪**：`--trace-lifecycle` 输出每个 phase 的耗时 + 结果

## 五、里程碑

| 里程碑 | 内容 |
|--------|------|
| M1 | 阶段定义 + defineApp API + 类型 |
| M2 | LifecycleOrchestrator 编排器 |
| M3 | Web 端映射 |
| M4 | Skyline 端映射（重点） |
| M5 | App (Native) 端映射 |
| M6 | 页面级 + 组件级生命周期 |
| M7 | 可靠性加固（超时/隔离/恢复/内存） |
| M8 | 可观测（trace/DevTools/CI） |

## 六、验收标准

- [ ] 业务代码零平台分支（不出现 `#ifdef` 式判断）
- [ ] `--trace-lifecycle` 可输出完整 phase 链
- [ ] 冷启动首屏 < 1s（中等机型）
- [ ] 任一层超时/失败，App 仍可降级运行
- [ ] Skyline 下页面级 store `$dispose` 正确挂载 `onUnload`
