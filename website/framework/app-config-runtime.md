---
title: 运行时配置消费
order: 34
group: 数据与状态
---

# 运行时配置消费

app.config 的运行时机制（`@proteus-vue/app-config`）：**多层级合并 → 校验 → 响应式消费 → 远端热更新**。

## 合并层级（优先级从低到高）

```
defaults（app.config.ts） < env（app.config.{env}.ts） < platform（端覆盖） < remote（远端下发）
```

- **env 覆盖**：`app.config.prod.ts` 按 `env` 字段选择合并
- **platform 覆盖**：`platform?: Partial<Record<Platform, DeepPartial<AppConfig>>>`——按端做 **DeepPartial 深层覆盖**（只覆盖差异字段，如 iOS 关玻璃、MP 调超时）
- **remote 下发**：`config.remote` 声明策略（fetchOnLaunch / fetchInterval / cacheToDisk / fallback: last-cached | defaults）

```ts
// 平台覆盖示例
platform: {
  'mp-weixin': { api: { timeout: 5000 } },   // 只覆盖这一格，其余继承
  web: { features: { glassEffect: false } },
}
```

## 消费 API 全表

| API | 签名 | 场景 | 说明 |
|---|---|---|---|
| `useAppConfig()` | `() => AppConfig` | 页面/组件 setup 内 | 响应式读全量配置（ref 代理；setup 外调用报错，同 useRoute 语义） |
| `useFeatureFlag(key)` | `(key: string) => FeatureFlagResult` | 页面/组件 setup 内 | 功能开关：读 `features[key]`，返回 `{ enabled, variant }` |
| `getConfig()` | `() => AppConfig` | 工具层/启动期 | 非响应式读取（未初始化抛错——启动必须 init） |
| `setConfig(input)` | `(DeepPartial<AppConfig> 或 ((cur) => DeepPartial)) => { ok, errors }` | 运行时更新 | 深合并 → 校验：非法**拒绝更新 + 告警**（不抛错），合法则触发响应式通知 |
| `getFeatureFlag(config, key)` | 纯函数 | 测试/非响应式场景 | `useFeatureFlag` 的纯函数版（setup 外可测） |
| `initAppConfig(defaults)` | `(AppConfig) => void` | 应用启动 | 初始化配置存储（重复调用 = 覆盖默认 + 保留已合并层） |

**`FeatureFlagResult` 结构**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 值非 `false` 且非 `undefined` 即 true |
| `variant` | `boolean 或 string 或 number 或 undefined` | 开关值原样（布尔开关 / A/B 分组字符串） |

```ts
// 典型消费
const config = useAppConfig()
const { enabled, variant } = useFeatureFlag('newHomePage')

if (enabled && variant === 'variant-a') {
  // 实验组首页
}
```

## 校验语义

| 场景 | 行为 |
|---|---|
| `setConfig` 合法 | 深合并 → 生效 → 所有 `useAppConfig` 消费者响应式更新 |
| `setConfig` 非法 | **拒绝更新 + console.warn**（返回 `{ ok: false, errors }`）——不静默破坏配置 |
| 必填缺失 / 类型错 | `validateAppConfig` 规则表逐条报（路径级 `errors: [{ path, message }]`） |
| 远端拉取失败 | 按 fallback 回退（见下），**应用永不因配置失败崩溃** |

校验规则表（RULES）与应用配置字段全表一一对应（[应用配置](/docs/11-app-config) 的「校验规则」列），新增字段补录 RULES 即自动覆盖。

## 远端热更新

`config.remote` 声明后：

- **fetchOnLaunch**：启动时拉取远端配置
- **fetchInterval**：周期刷新（ms）
- **cacheToDisk**：拉取结果写磁盘（L1 缓存抽象——缺省内存实现，对接 Cache G-28 时替换存储实现、接口不变）
- **fallback**：拉取失败 → `last-cached`（优先用最近一次成功缓存）或 `defaults`（直接回默认值）

生效链路：远端值 → 校验（同 setConfig 语义，非法拒绝）→ 深合并 → 响应式通知。**运行态配置变更不需要发版**。

## 校验与工具

- `proteus app-config:check app.config.ts`：字段/类型/迁移校验（缺文件跳过不阻断，独立命令报错）
- `proteus gen config`：生成类型安全骨架

## 下一步

- [应用配置 app.config](/docs/11-app-config)：字段全表与校验规则
- [页面间数据传递](/docs/framework/page-data)
