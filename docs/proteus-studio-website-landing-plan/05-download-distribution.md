# G-60 下载分发与更新通道

> 核心风险（P5，官方文档原文）：
> **if you lose this key, you will NOT be able to publish new updates to your current user base.**
> 这不是"会很麻烦"，是**永久失去**向已安装用户推送更新的能力。

## 1. 下载页不是"放几个链接"

它是**一条带签名验证的更新通道的入口**。两者区别：

| 视角 | 下载页 | 更新通道 |
|------|--------|---------|
| 触发 | 用户主动 | 应用自动 |
| 频率 | 一次 | 持续 |
| **失败后果** | 用户装不上 | **已装用户永远卡住** |

第二行决定了私钥管理的严肃性。

## 2. 平台矩阵

```
             x86_64        aarch64       i686        armv7
linux        ✅ AppImage   ✅ AppImage   ✅          ⚠️
windows      ✅ MSI/NSIS   ⚠️            ✅         —
darwin       ✅ app        ✅ app        —          —
```

Tauri 官方支持的 target / arch 变量值：

| 变量 | 取值 |
|------|------|
| `{{target}}` | `linux` \| `windows` \| `darwin` |
| `{{arch}}` | `x86_64` \| `i686` \| `aarch64` \| `armv7` |

**updater endpoint 模板**：

```
https://releases.proteus.dev/{{target}}/{{arch}}/{{current_version}}
```

生产模式**强制 TLS**（官方约束，不可关闭）。

## 3. 产物清单（manifest）

```json
{
  "version": "0.4.2",
  "notes": "修复 WASM 沙箱在网络白名单未命中时的越权返回",
  "pub_date": "2026-08-01T10:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ...",
      "url": "https://releases.proteus.dev/0.4.2/Proteus_Studio_aarch64.app.tar.gz"
    }
  }
}
```

**必填字段**：`version` / `notes` / `pub_date` / `platforms[*].signature` / `platforms[*].url`

**缺 `signature` 即拒绝发布**（错误码 `ARTIFACT_UNSIGNED`）。
理由：无签名产物一旦分发，等于开放了任意代码执行通道。

## 4. 私钥管理铁律

| # | 铁律 |
|---|------|
| 1 | 私钥**永不**进入代码仓库 |
| 2 | 存 CI 加密 secret，构建时自动签名 |
| 3 | **离线冷备份，异地多份**（如保险柜 + 银行保管箱） |
| 4 | 轮换须走正式流程，**旧公钥必须继续保留在旧版本 app 内** |
| 5 | 密钥负责人变更时须完成交接验证（用旧私钥签名一次测试包并验证） |

第 4 条最容易被忽略：**轮换私钥后，已安装的旧 app 内嵌的是旧公钥**。
如果服务器只提供新私钥签名的更新，旧 app 会全部验签失败。
所以更新服务必须**按客户端版本返回对应签名**。

## 5. 平台签名要求

| 平台 | 要求 | 缺失后果 |
|------|------|---------|
| macOS | Developer ID + **notarization** | **Gatekeeper 拦截安装** |
| Windows | Authenticode（推荐） | SmartScreen 警告 |
| Linux | AppImage（Tauri 内置签名） | 无强制，但应签名 |

**macOS notarization 是硬性门槛**——未公证的应用在用户机器上直接被拦，
用户会以为是"软件有问题"而非"没签名"。

## 6. 分发渠道

| 渠道 | 用途 | 成本 |
|------|------|------|
| GitHub Releases | 主分发（免费 CDN + 下载统计） | 免费 |
| 官网下载页 | 检测平台 → 跳转对应产物 | — |
| 包管理器 | winget / Homebrew Cask / AUR | 低 |

**推荐**：GitHub Releases 为源，官网下载页做平台检测后跳转。
这样下载统计、CDN、历史版本归档全部免费获得。

## 7. 降级路径

| 场景 | 行为 |
|------|------|
| 平台无匹配产物 | **返回 null，明确提示**"暂不支持该平台"——不猜测 |
| 更新检查失败 | 静默重试，**不弹错误打扰用户** |
| 验签失败 | **拒绝安装 + 明确告警**（可能是攻击） |
| 私钥丢失 | **不可降级**——只能引导用户手动下载重装 |

最后一行是唯一没有技术方案的风险，**只能靠备份预防**。

## 8. 与官网其他部分的关系

```
/download   →  读取 manifest → DownloadMatrix.pick()
/plugins    →  插件市场（G-61，复用同一套签名验证）
/docs       →  版本化文档（快照由 tag 触发，与发布同源）
```

**三者共用同一个 release tag**：打 tag 时
① 构建产物并签名 ② 生成文档快照 ③ 更新 manifest
——**一次触发，三件事原子完成**，避免"文档说 0.4 但下载还是 0.3"。
