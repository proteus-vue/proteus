---
title: 插件开发指南
order: 1
group: 插件 API
---

# 插件开发指南

> [host](/docs/plugin/host) / [manifest](/docs/plugin/manifest) / [contributions](/docs/plugin/contributions) 是 **WIT 自动生成的 API 参考**（字段/方法级）；本页讲「为什么 / 怎么做」——插件如何安全地跑起来。

## 安全模型：Capability-based Security（不是审核式）

VSCode 扩展主机的权限模型是结构性缺陷（Tanium 研究原文）：**扩展宿主的权限 = IDE 权限**——装一个主题插件等于交出完整文件/网络/进程权限。Proteus 换模型：

```
VSCode 模型：  插件 ⊂ IDE 进程 ⇒ 插件权限 = 用户权限
Proteus 模型： 插件 ⊂ WASM 沙箱 ⇒ 默认零权限 + capability 白名单
```

- **默认零权限**：插件能做什么由 manifest 声明的 capabilities 决定（越权调用 → denied，不终止进程）
- **权限建在数据敏感度上，不建在 API 危险度上**（G-59：clipboard 能窃取助记词——有限集合建模）
- **WASM 崩溃隔离**：插件崩溃不影响宿主（资源限额强制）

## 生命周期（宿主按激活时机契约驱动）

| 阶段 | host API | 契约 |
|---|---|---|
| 安装 | （manifest 登记） | 代码哈希 + 签名登记（sig-*） |
| **激活** | `activate(plugin-id)` | 宿主按 **activationEvents** 决定时机——**激活时机是契约，不是优化项**（G-59：禁通配符事件） |
| 调用 | `invoke` | 经 capability 网关（越权 denied） |
| 挂起 | `suspend` | **deactivate 必须对称清理**（未清理项记入审计并降信任分） |
| 卸载 | `uninstall` | 对称清理回收 |

## 编写一个插件（骨架）

```ts
// proteus.plugin.json（manifest）——capabilities 白名单声明
{ "name": "my-panel", "version": "0.1.0", "apiVersion": "0.1.0",
  "activationEvents": ["studio:onPanelOpen"],   // 精确事件，禁通配符
  "capabilities": ["studio:panel.render"],       // 默认零权限 → 最小白名单
  "entry": "plugin.wasm" }
```

- **api-surface**（`host.api-surface`）：插件查询宿主当前能力集——**API 只增不改**，稳定版冻结永不修改
- **版本并存**：WIT 版本化（`since_v0_1_0`）——不同 apiVersion 的插件可并存，不跟随宿主强制升级
- 面板/视图扩展走 `contributions`（贡献点声明）

## 信任与治理（G-59 生态红线）

- **信任不可继承**：代码哈希变化即撤销重授权——不检测"恶意"，切断"信任继承"假设
- **去激活对称审计**：suspend/uninstall 未清理 → 审计 + 信任降级
- **资源限额强制**：超预算拒绝加载（非警告）
- **只读优先**：默认只读能力；写能力需显式授权
- 生态质量面（破坏率看板 / 版本废弃）详见插件生态规划

## 诚实边界

- 插件 API 目标宿主是 **Studio**（面板扩展/工具链扩展）；业务工程复用走[组件分发](/docs/framework/components-distribution)（源码级）
- 当前 WIT v0.1.0 为 API 冻结起点——新增类型以版本并存方式演进

## 下一步

- [host API 参考](/docs/plugin/host)：activate/suspend/invoke/api-surface 逐方法签名
- [manifest 参考](/docs/plugin/manifest)：字段全集
