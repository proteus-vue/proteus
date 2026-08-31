# Architecture 规约更新 — G-35 应用全局配置

## 新增执行位

### G-35：应用全局配置（P1）

**区别于 `proteus.config`（工程/框架构建配置）**，提供应用级运行时配置的统一抽象。

**职责**：
- 应用标识、版本、环境（dev/staging/prod）
- API 域名、超时、缓存策略
- 功能开关（Feature Flags）、实验分组
- 主题/字体/安全区默认值
- 多端差异化配置
- 远端下发（Remote Config）热更新

**禁止**：
- 禁止在业务代码中硬编码 API 域名（必须用 `config.api.baseUrl`）
- 禁止用 `process.env.NODE_ENV` 判断环境（用 `config.env`）
- 禁止在平台覆盖中散落 `if (platform === 'ios')`（用 `platform` 字段）
- 禁止在远端配置中放置敏感信息（密钥走原生安全存储）

## 概念边界（铁律）

> **G-35.1**：`proteus.config` 与 `app.config` 必须严格分离。
> - `proteus.config` → 构建期，Compiler/CLI 消费
> - `app.config` → 运行时，Runtime/业务消费

## 配置层级（优先级）

```
① 默认值 < ② env < ③ platform < ④ remote
```

深合并，数组替换。

## 原则 #10 应用

> App Config 是原则 #10「统一语义 + 原生实现」在配置管理领域的应用：
> - 框架定义配置语义（Schema + API）
> - 各端用原生方式存储和拉取（UserDefaults / SharedPreferences / preferences）

## 与既有执行位的关系

| 执行位 | 关系 |
|--------|------|
| G-27 Theme | App Config 提供 `theme.default` |
| G-27 Font | App Config 提供 `font.defaultScale` |
| G-25 Memorial | App Config 提供 `features.memorialGray` |
| G-31 Style Safety | 共用校验哲学（降级 + fail-fast） |
| G-28 Cache | 远端配置缓存到 L1 |
| G-33 CLI | `proteus check config` / `gen config-types` |
| G-34 DevTools | 配置变更可视化 |

## 全景图更新

```
Layer 5: 应用层
  ├─ Glass (G-29)
  ├─ Theme/Font/Cache (G-27/14/15)
  ├─ Style Safety (G-31)
  └─ **App Config (G-35)** ← 新增（支撑所有能力模块）

Layer 4: 工程化层
  ├─ Router (G-32)
  ├─ CLI (G-33)
  └─ DevTools (G-34)
```
