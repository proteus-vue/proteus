---
title: 可插拔架构
order: 9
---

# 可插拔架构：宿主层三件套（G-41/42/43）

## 宿主接入（G-41）：三方正交

框架 × 渲染引擎 × 宿主三方独立演进：

- 框架不碰线程/原生 View/平台 SDK
- 宿主不解析 IR、不干预 Diff
- 引擎不感知 Vue（不 import 任何前端框架）

nodeOps Dispatcher 让"切换渲染引擎 = 一次赋值"。6 宿主 × 6 引擎 = 36 组合矩阵，Tier 1 组合全部通过 conformance。

## 宿主容器（G-42）：六容器策略

页面组织方式是**可插拔策略**，不是硬编码：

| 容器 | 适用 |
|------|------|
| Stack | 常规页面栈 |
| SuperApp | 超级应用：业务沙箱 + 崩溃隔离 + 自动重启 + 签名/白名单网关 |
| Window | 多窗口（PC / 折叠屏） |
| MiniProgram | 小程序宿主 |
| Embedded | 嵌入宿主 App |
| SinglePage | 单页 |

**IR 单一 Owner + 五原子销毁**（unmount→unbindEvents→releaseResources→destroyIR→releaseQuota）消灭栈泄漏；**严禁 fork** 框架源码（`proteus conformance --repo` 一键扫描）。

## 资源所有权（G-43）：GC 管可达性，所有权管意图

```ts
const file = new Owned(openFile(path))   // 边界资源创建即登记所有权图
file.transferTo(pool)                    // Move 语义：原所有者再访问 → 编译期拦截
```

- **借用检查器**（PSS strict 编译期完备）：use-after-move / double-move / 借用逃逸 / drop 活跃借用全部编译期报错
- **Drop 五阶段协议**：确定性释放，不依赖 GC 时机
- **所有权图 100% 可观测**：DevTools 所有权视图定位泄漏
