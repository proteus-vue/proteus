# G-53 · 模拟器池化与远程共享

> ★ 独有增量。解决"买不起机型"的核心：**一台 Mac 装 Xcode，全团队共享模拟器**。

## 1. 先澄清：iOS 模拟器不能独立

**硬约束**：iOS Simulator **无法**脱离完整 Xcode 运行。

- 单独装 Command Line Tools（2-3GB）**不含** `simctl`、`xcodebuild`、iOS SDK
- `simctl` 位于 Xcode.app 内部，**必须完整安装 Xcode.app**
- 社区工具（speedwagon）能下载 runtime 不装 Xcode，但作者明确写了「doesn't currently offer any functionality to install them」——**下载能独立，运行不能**

**结论：不存在"免 Xcode 的 iOS 模拟器"。** 这是 Apple 的约束，不是能力问题。

## 2. 但"几十 G"是误解

| 组件 | 大小 |
|------|------|
| **Xcode 16 本体** | **2.63 GB** |
| Command Line Tools | 0.74 GB |
| **iOS 18 Simulator Runtime** | **7.85 GB** ← 真正的大头 |
| watchOS 11 Runtime | 3.90 GB |
| visionOS 2 Runtime | 7.60 GB |

**Xcode 本体只占 2.6G。** 感觉"几十 G"是因为累积：多版本 runtime + DeviceSupport（5-20G）+ CoreSimulator（10-40G）+ DerivedData。

**清理命令**：
```bash
xcrun simctl delete unavailable              # 清无效设备（安全，最先做）
xcrun simctl runtime delete "iOS 17.2"       # 删不测的旧 runtime
xcrun simctl erase all                       # 重置设备数据
rm -rf ~/Library/Developer/Xcode/iOS\ DeviceSupport/16.*
rm -rf ~/Library/Developer/Xcode/DerivedData
```
只保留当前 + 一个最低支持版本，通常能从 80G 砍到 20G 以内。

**还有一点**：装了 Xcode **完全不需要打开 GUI**。所有 CI 系统都是靠 `xcodebuild` + `xcrun simctl` 跑的，界面一次都不用开。

## 3. Codex 的做法：不是免 Xcode，是服务化

Codex（OpenAI）的 iOS 测试技术栈：

```
XcodeBuildMCP    → 封装 xcodebuild / simctl CLI
serve-sim        → simctl io 抓 framebuffer → MJPEG 流 + WebSocket 控制
SnapshotPreviews → 提取 SwiftUI #Preview 快照
```

**底部依然 `simctl`，没绕开 Xcode。**

**但真正聪明的是**——把模拟器从"屏幕上弹出的窗口"变成"一个 URL"：

> Host your simulator for use with Agent tools — **locally, over your LAN, or host on a remote Mac and tunnel anywhere.**

| 动作 | 实现 |
|------|------|
| 画面 | `simctl io` 抓 framebuffer → **MJPEG 60fps** |
| 控制 | **WebSocket**（点击/输入/手势/键盘） |
| 日志 | 转发模拟器日志 → agent 可读 |

## 4. 池化架构

```
一台 Mac（或云 Mac：MacStadium / GitHub Actions macOS runner）
   ├─ simctl 起 N 个模拟器：iPhone SE / 17 Pro / iPad …
   │       （每个只是 runtime 里的 device，不用买硬件）
   ├─ serve-sim × N → 每个一个 URL/端口
   └─ 隧道暴露给团队/CI
              ↓
   G-51 TestIRRunner 经 SimulatorBackend(endpoint) 连上去跑 suite
              ↓
   G-52 设备矩阵自动收集报告
```

**成本对比**：

| 方案 | 成本 |
|------|------|
| 买 8 台真机 | 3-5 万 + 折旧换新 + 专人维护 |
| 每人装 Xcode（8 人 × 80G） | 磁盘爆炸 + 版本不一致 |
| **一台共享 Mac 起 8 个模拟器** | **硬件 0 新增**（公司大概率已有 Mac） |
| 云 Mac 按需 | 约 $79-149/月 |

## 5. SPI 支持

```typescript
{ kind: 'ios-sim', endpoint: 'wss://mac-01.internal:8080/iphone17' }
```

- **无 `endpoint`** → 本机 `simctl`
- **有 `endpoint`** → 远程共享池

编排器不关心是哪个——**设备只是矩阵里的一个普通节点**（与 G-52 平级）。

## 6. 许可边界（必须遵守）

**Apple EULA 明确约束**：

- macOS 限于 **Apple-branded 硬件**
- 每台 Mac 允许运行最多 **2 个虚拟机实例**用于开发/测试
- **明确禁止** service bureau、time-sharing 等对外服务

**因此本方案的共享范围**：

| 场景 | 是否允许 |
|------|---------|
| 内部团队共享一台 Mac | ✅ 允许 |
| 内部 CI 使用 | ✅ 允许 |
| **对外提供"云 iOS 模拟器"服务** | ❌ **禁止，需法务确认** |

**这是法律边界，不是技术建议。** 若未来要对外提供设备云服务，必须走法务流程。

## 7. 替代方案（均为真机/真虚拟化）

| 方案 | 说明 | 成本 |
|------|------|------|
| Corellium | ARM-on-ARM **真虚拟化**（非模拟） | 企业级约 $9,995/年 |
| Appetize.io | 浏览器流式**真模拟器** | 适合 demo，非 CI |
| MacStadium | 云 Mac 租用 | $79-149/月 |

## 8. 实施步骤

1. **准备一台 Mac**（现有即可，无需新增采购）
2. 装 Xcode + 仅保留 1-2 个 runtime（清理命令见 §2）
3. 部署 serve-sim，起 N 个模拟器实例各占端口
4. 在 G-53 profile 中登记 endpoint
5. 编排器按 `endpoint` 有無自动选本机/远程

## 9. 诚实边界

- **模拟器 ≠ 真机**：摄像头、蓝牙、Face ID、气压计、真实性能**全测不了**
- 共享 Mac 的**并发上限未实测**，8 个模拟器同时跑的资源压力需压测——**不得承诺具体数字**
- serve-sim 是社区开源项目，非 Apple 官方维护，升级兼容性需自行兜底
- Apple Xcode 27 引入官方 **Device Hub**（支持 agent 通过 MCP/ACP 与模拟器交互）——方向已被官方认可，但本份基于社区方案，官方方案成熟后应优先切换
- **国产 ROM 与 iOS 模拟器无关**，需走 Android 云真机
