# G-45 调试基座即宿主（Dev Host / Install-Once Host）

> **一句话**：基座是浏览器，不是构建产物——装一次，换插件，永不重打。
>
> **方法论定位**：原则 #0「不绑定」系列第九次投影——**不绑定基座形态**（沿 G-44 计数：平台 API G-31/32 / 渲染 G-27/37 / 编译 G-29/38 / 宿主运行时 G-39 / 执行载体 G-40 / 容器 G-42 / 所有权 G-43 / 测试 G-44 / ★基座 G-45）。

---

## 传统循环 vs G-45 循环

```
uni-app（自定义基座循环）：
  改原生插件 → 云打包自定义基座（分钟级，页面越多越慢）
            → 卸载重装 → 登录态丢失 → 验证 → 再改 → 再打包 …… 循环往复

Proteus（Install-Once Host）：
  改原生插件 → dev server push 插件模块（秒级）
            → 基座装载即验证（签名 + conformance 快检）
            → pending 调用自动回放 —— 基座 0 次重打，JS 上下文 0 次重启
```

**页面越多构建越慢的根因被消除**：构建时间从 O(业务规模) 变为 O(改动)——基座 cacheKey 只由「框架版本 + ABI」决定，与页面数/插件数彻底无关。

---

## 核心机制（四件套）

| # | 机制 | 一句话 | 方法论出处 |
|---|------|--------|-----------|
| 1 | **基座即宿主** | 基座只实现 SPI + 装载协议，对任何具体插件零知识 | 原则 #0 不绑定基座形态 |
| 2 | **插件即动态后端** | 原生插件 = DynamicBackendModule（manifest + 签名 + conformance + factory），运行时装载 | G-28 NativeBackend SPI |
| 3 | **转发桩 pending 语义** | 未装载能力的调用进 pending 队列，装载成功自动回放——业务零重试零崩溃 | G-32.3 非抛语义同源 |
| 4 | **双层产物 + 独立缓存** | 稳定层（基座）/ 变化层（JS + 插件模块）cacheKey 独立，构建 O(改动) | G-38 getCacheKey 已预留 |

**装载即验证**：动态模块装载时跑 conformance 快检（同能力必须产出同 shape 结果，CMP074 思想延伸），不过门禁 → 拒绝装载 + 降级后端兜底（降级不崩溃）。**这不是调试技巧，是 G-37/G-38/G-44 同一套 conformance 方法论在「动态装载」场景的第八套套件。**

---

## 文件清单

| 文件 | 内容 |
|------|------|
| `01-problem.md` | ★ 痛点解剖：自定义基座循环的根因四条 + 竞品横向 |
| `02-architecture.md` | ★ 核心解法：基座即宿主 + 三端动态装载分级 + 发布诚实边界 |
| `03-spi.md` | ★ DevHost SPI + DynamicBackendModule 契约 + 推送协议 + NAT-C conformance |
| `rules.md` | 铁律 G-45.1-6 + CMP082-088 |
| `batches.md` | B1-B6 分批 + DoD |
| **`dev-host-reference.cjs`** | ★ 可运行参考实现（模拟器：装载/回放/热升级/门禁/双层缓存） |
| `verify.sh` | 机器验证（12/12 自检） |
| `architecture-update.md` | 规约增量（原则 #13.28-13.30 + 铁律 + CMP） |

## 快速开始

```bash
# 看演示（传统循环 vs G-45 循环对照）
node dev-host-reference.cjs

# 机器自检
bash verify.sh
```

---

## 依赖关系（与既有 G 表互校）

```
G-39 HostRuntime ── DevHost 是宿主运行时的调试形态（bootstrap/事件/线程归它管）
G-28 NativeBackend ── 插件模块 factory 返回的就是 NativeBackend SPI 实现
G-42 容器/安全网关 ── 签名校验同源（checkBizManifest → G45_SIGN 同思路）
G-38 CompilerBackend ── 双层构建 cacheKey/getArtifactHash 已在 SPI 预留
G-44 Test IR ── conformance 快检用例可序列化（NAT-C 套件跑在 test-ir runner 上）
G-40 ExecutionCarrier ── pending 回放跨 JSI 边界走批处理 + 零拷贝通道
```

## 诚实边界（先说清不承诺什么）

1. **Android / 鸿蒙**：全热替换 tier（DexClassLoader / HSP 动态共享包）——开发与内部分发可用
2. **iOS**：增量重签 tier——代码签名是硬约束（App Store 2.5.2 禁止下载可执行代码），iOS 走「稳定层缓存 + 插件 target 增量编译 + 模拟先行」，把分钟级云打包变成本地秒~分钟级；**商店发布全平台回静态链接（每版本一次，非每次改动）**
3. 动态装载通道**禁止用于规避商店审核**（合规铁律 G-45.6）
4. 调试通道必须签名 + 审计日志（防注入，CMP088）
