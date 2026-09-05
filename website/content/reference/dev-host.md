---
title: 调试基座 dev-host
order: 45
group: 开发者工具
---

# 调试基座 dev-host

**Install-Once Host**（G-45）：调试基座=宿主，**主机插件永不重装**——开发期热换后端（插件），三态生命周期保证产物确定性，push 协议带完整性门禁。`@proteus-vue/dev-host` 是宿主壳实现。

## 三态生命周期（`DevHostMode`）

| 态 | 语义 |
|---|---|
| `dev` | 开发：插件热装/热换，调试面全开 |
| `release` | 发布：产物确定（ABI 冻结下的稳定层重建） |
| `runtime` | 运行：参数灰度（FeatureFlag 形态——**非代码下发**，G-45.10） |

## push 协议（ModulePushMessage 载荷）

`proteus host push <module-dir>`：插件模块前置校验 → push 信封（G-45.8 完整性）：

| 字段 | 说明 |
|---|---|
| `manifest` | BackendManifest（插件清单） |
| `conformance` | **语义快检用例**（真实 transport 以 Test IR 序列化传输——G-44） |
| `bundle` | 插件源码包（真实 transport 为二进制） |
| `bundleHash` / `manifestHash` | 完整性哈希——接收端校验，篡改即拒 |

协议信封 `ProtocolEnvelope` 覆盖 Hello / HelloAck / ModulePush / LoadReport（含错误原因——protocol report reason 语义）。

## ABI 感知的稳定层缓存

`stableLayerCacheKey`：`base:{frameworkVersion}:{abi}` + `:{m}:{backendManifestHash}` + `:{s}:{signatureChainHash}`——稳定层重建**与页面数/业务规模无关**（CMP086），但 **manifest/签名链变化会合理失效**（ABI 冻结下安全增量）。ABI 形态 `abi.major.minor`（如 `1.3`）。

## CLI 门禁（proteus host push）

```
前置校验：proteus.plugin.json 完整性 / 签名 sig-* / conformance 覆盖率（CMP084/087）
→ push 信封生成（manifestHash + bundleHash）→ 设备推送
FAIL → exit 1（CI 阻断）
```

后续能力随 B4 transport 适配器落地：`devices/logs/serve`。

## 源码分层（packages/dev-host/src）

`abi.ts`（三态 + ABI cacheKey）/ `protocol.ts`（信封与报告）/ `dev-server.ts` + `device-session.ts`（会话）/ `build-planner.ts`（分层 BuildPlan：PluginLayerPlan——层化构建）/ `shape.ts` + `types.ts`。

## 诚实边界

- dev-host 面向插件化调试（G-58/59 生态的前置）；单工程（无插件）调试走 debug:mp 即可，无需基座
- 协议字段为当前实现面；B4 transport 适配器未落地前 CLI 只到 push 信封

## 下一步

- [DevTools 面板与扩展](/docs/reference/devtools-open-api)：调试消费面
- [插件 API](/docs/plugin/host)：G-58 插件形态
