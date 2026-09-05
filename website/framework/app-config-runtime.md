---
title: 运行时配置消费
order: 34
group: 数据与状态
---

# 运行时配置消费

app.config 的运行时机制（`@proteus-vue/app-config`）：**多层级合并 → 响应式消费 → 远端热更新**。

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

## 消费 API

| API | 说明 |
|---|---|
| `useAppConfig()` | 响应式读全量配置（页面/组件内） |
| `useFeatureFlag(key)` | 功能开关：返回 `{ enabled, variant }`（features[key] 驱动，A/B 实验分组友好） |
| `getConfig()` / `setConfig()` | 非响应式读写（工具层/启动期） |
| `getFeatureFlag(config, key)` | 纯函数版（测试友好） |

## 远端热更新

`config.remote` 声明后，启动拉取（fetchOnLaunch）+ 周期刷新（fetchInterval）+ 磁盘缓存（cacheToDisk）；拉取失败按 fallback 回退 last-cached 或 defaults——**运行态配置变更不需要发版**。

## 校验与工具

- `proteus app-config:check app.config.ts`：字段/类型/迁移校验（缺文件跳过不阻断，独立命令报错）
- `proteus gen config`：生成类型安全骨架

## 下一步

- [页面间数据传递](/docs/framework/page-data)
