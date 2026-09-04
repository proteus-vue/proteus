# G-53 移动端验证编排

> 原则 #0「不绑定」系列，第 15 次泛化。
> 编号：G-53 · 依赖：G-51（TestIRRunner）、G-52（跨设备一致性）· 被依赖：G-54+

## 1. 问题：机型碎片化是个伪命题

移动端人工测试的痛点是真实的：**机型众多，不可能每台都买**。

但这个痛点的**归因通常是错的**。看 2026 Q1 中国市场（Omdia）：

| 品牌 | 份额 | 同比 |
|------|------|------|
| 华为 | **20%** | +7% |
| 苹果 | **19%** | +42% |
| OPPO | 16% | -3% |
| vivo | 15% | 0% |
| 小米 | 12% | -35% |
| 荣耀 | 11% | — |

**前六大占 82%，华为 + 苹果占近 40%。**

所谓"机型众多"是错觉——**真正影响 95% 用户的只有 8-10 台代表机型**。剩下几百款是长尾，用崩溃监控兜底即可，不值得提前测。

## 2. 真正的三个问题

拆开看，痛点其实是三件事，解法完全不同：

### 问题 A：误以为需要覆盖所有机型

**解法：等价类 + 代表采样**（G-52 已有理论，本份落地清单）。
不按"机型"测，按**四维漂移（屏幕/系统/输入/环境）× 市场份额**划分等价类。

### 问题 B：误以为每台机器都要买

**解法：模拟器池化 + 云真机按分钟付费**。

| 方案 | 成本 |
|------|------|
| 买 8 台真机 | 3-5 万 + 折旧换新 + 专人维护 |
| 每人装 Xcode（8 人 × 80G） | 磁盘爆炸 + 版本不一致 |
| **一台共享 Mac 起 8 个模拟器** | **硬件 0 新增** |
| 云 Mac 按需 | 约 $79-149/月 |
| **云真机按分钟** | **¥0.5/分钟，8 台 × 5 分钟 = ¥20/次** |

云真机成本是买真机的 **1/50**。

### 问题 C：★ 误以为所有测试都需要真机（最关键）

**这才是主战场。** 回顾 G-51 三阶梯度：

```
L0 文档自检     ← 零成本，秒级
L1 IR 模拟      ← 零成本，秒级，覆盖绝大部分断言
L2 真运行时     ← 才需要真机/云真机
```

G-46~G-52 的 conformance 参考实现（37/37、44/44、31/31）**全是零依赖 node 跑出来的**。

**机型碎片化这个难题，在 SPI-First 架构里绝大部分已被消解**，剩下的才需要设备。这是方法论的复利——**把"必须真机"的面积压到最小**。

## 3. 一个必须澄清的误解：iOS 模拟器无法独立

**硬约束**：iOS Simulator **不能**脱离完整 Xcode 运行。

- 单独装 Command Line Tools（2-3GB）**不含** `simctl`、`xcodebuild`、iOS SDK，`xcrun simctl` 直接报 not available
- `simctl` 位于 Xcode.app 内部，必须完整安装 Xcode.app
- 社区工具（如 speedwagon）能**下载** runtime 但不装 Xcode，作者明确写了「doesn't currently offer any functionality to install them」——**下载能独立，运行不能**

**但磁盘真相和直觉相反：**

| 组件 | 大小 |
|------|------|
| **Xcode 16 本体** | **2.63 GB** |
| Command Line Tools | 0.74 GB |
| **iOS 18 Simulator Runtime** | **7.85 GB** ← 真正的大头 |
| watchOS 11 Runtime | 3.90 GB |

**Xcode 本体只占 2.6G，一个 iOS runtime 就是 8G。** 感觉"几十 G"是因为累积了：多版本 runtime + DeviceSupport（5-20G）+ CoreSimulator（10-40G）+ DerivedData。

**立刻能省**：
```bash
xcrun simctl delete unavailable              # 清无效设备（安全，最先做）
xcrun simctl runtime delete "iOS 17.2"       # 删不测的旧 runtime
xcrun simctl erase all                       # 重置设备数据
rm -rf ~/Library/Developer/Xcode/DerivedData
```
只保留当前 + 一个最低支持版本，通常能从 80G 砍到 20G 以内。

## 4. Codex 的启示：不是免 Xcode，是让模拟器变成服务

Codex（OpenAI）的 iOS 测试能力技术栈已明确：

```
XcodeBuildMCP   → 封装 xcodebuild / simctl CLI
serve-sim       → simctl io 抓 framebuffer → MJPEG 流 + WebSocket 控制
SnapshotPreviews → 提取 SwiftUI #Preview 快照
```

**底部依然是 Apple 的 Simulator，依然是 `simctl`**——它没绕开 Xcode，因为绕不开。

**但它真正聪明的地方在于**：

> 把模拟器从"在你屏幕上弹出的窗口"变成了"一个 URL"。

`serve-sim` 的 README 第一句：
> Host your simulator for use with Agent tools — **locally, over your LAN, or host on a remote Mac and tunnel anywhere.**

| 动作 | 实现 |
|------|------|
| 画面 | `simctl io` 抓 framebuffer → **MJPEG 60fps** |
| 控制 | **WebSocket**（点击/输入/手势/键盘） |
| 日志 | 转发模拟器日志 → agent 可读 |

**这直接解开了死结**：不是每个开发者装 Xcode，而是**一台 Mac 装 Xcode，全团队共享**。

## 5. 本份要解决的

给出一套**可编排、可降级、可度量**的移动端验证方案：

1. 等价类清单（含市场份额权重）
2. 模拟器池化与远程共享
3. 云真机适配
4. **覆盖率门槛**——让"要不要跑真机"变成自动决策，而非开发者负担

## 6. 诚实边界

- **给不了"免 Xcode 的 iOS 模拟器"**——技术和许可上都不存在合规路径
- **iOS 侧是模拟器设备，不是真机**——屏幕/系统版本能覆盖，**摄像头、蓝牙、Face ID、气压计、真实性能全都测不了**
- **国产 ROM 深度定制**（MIUI 杀后台、悬浮窗权限）iOS 模拟器完全无关，需走 Android 云真机
- **Apple EULA**：macOS 限于 Apple-branded 硬件；每台 Mac 最多 2 个虚拟机实例用于开发测试；**明确禁止 service bureau / time-sharing**。因此**共享仅限内部团队与 CI，不得对外提供云服务**——这是法律边界，不是技术建议
- **"95% 断言不需真机"是基于 G-46~52 断言构成的判断**，落地需实际统计各 plan 的 L1/L2 用例分布才能确认，**不得直接对外宣称**（G-37 未实测不宣称）
- 共享 Mac 的并发上限未实测，8 个模拟器同时跑的资源压力需压测——不得承诺具体数字
