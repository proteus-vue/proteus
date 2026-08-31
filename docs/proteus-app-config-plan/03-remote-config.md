# 远端下发（Remote Config）设计（G-35）

## 1. 集成模型

```
启动
  ├─ ① 读取本地配置（默认 + env + platform）
  ├─ ② 异步拉取远端配置
  ├─ ③ 合并 → 校验 → 生效（响应式更新）
  └─ ④ 缓存到 L1（对接 Cache G-28）
```

**首屏不阻塞**：② 异步执行，首屏用本地默认值渲染。

## 2. Source 配置

```typescript
remote: {
  enabled: true,
  source: {
    type: 'https',          // 'https' | 'firebase' | 'custom'
    url: 'https://config.example.com/v1/app',

    // 自定义拉取（可选，对接企业平台）
    fetcher: async (ctx) => {
      const res = await fetch(ctx.url, {
        headers: { 'X-App-Version': ctx.version },
      })
      return res.json()
    },
  },
  strategy: {
    fetchOnLaunch: true,     // 启动时拉取
    fetchInterval: 3600000,  // 每小时轮询
    cacheToDisk: true,       // 缓存到 L1
  },
  fallback: 'cache-or-default',  // 'cache-or-default' | 'default-only'
},
```

**支持 source 类型**：
- `https`：自建端点（JSON）
- `firebase`：Firebase Remote Config
- `custom`：实现 `RemoteSource` 接口（LaunchDarkly / Split.io / 自研）

## 3. 远端配置格式

```json
{
  "features": {
    "glassEffect": false,
    "newHomePage": "variant-b"
  },
  "api": {
    "timeout": 8000
  }
}
```

**合并逻辑**：远端只覆盖它声明的字段（深合并），未声明的保留本地值。

```
本地: { api: { baseUrl: 'A', timeout: 10 }, features: { x: true } }
远端: { api: { timeout: 8 }, features: { x: false, y: 1 } }
合并: { api: { baseUrl: 'A', timeout: 8 }, features: { x: false, y: 1 } }
```

## 4. 降级链（fail-fast 但永不崩溃）

```
远端拉取成功？
  ├─ ✅ → 校验通过？
  │     ├─ ✅ → 生效（响应式更新）
  │     └─ ❌ → 拒绝 + 告警 + 保留当前
  └─ ❌ → 有本地缓存？
        ├─ ✅ → 用缓存
        └─ ❌ → 用默认值（硬编码 fallback）
```

**核心原则**：**应用永不因配置失败而崩溃。**

## 5. 安全考量

| 风险 | 防护 |
|------|------|
| 恶意下发 | 签名校验（HMAC-SHA256） |
| 篡改 | 可选加密（AES-GCM） |
| 非法值 | Schema 校验（见 04-validation.md） |
| 过度频繁拉取 | 节流 + 最小间隔（默认 5min） |
| **敏感信息泄露** | **远端配置只放非敏感开关** |

### 敏感信息归位

> ⚠️ **架构铁律**：远端配置 **绝不承载敏感信息**。

| 信息类型 | 存放位置 |
|----------|---------|
| API 密钥、第三方 Secret | 原生端安全存储（Keychain / KeyStore / 鸿蒙 KeyStore） |
| 用户 Token | 原生端 Keychain + JSI 暴露 `useAuthToken()` |
| 功能开关、参数、域名 | ✅ 远端配置（本方案） |

```typescript
// ✅ 正确：敏感信息走原生安全存储
const token = useAuthToken()  // JSI → Keychain

// ✅ 正确：非敏感开关走远端配置
const flag = useFeatureFlag('newHomePage')
```

## 6. 企业级集成示例

### LaunchDarkly

```typescript
remote: {
  source: {
    type: 'custom',
    fetcher: async (ctx) => {
      const ld = await import('launchdarkly-js-client-sdk')
      const client = ld.initialize('client-id', { kind: 'anonymous' })
      await client.waitForInitialization()
      return {
        features: {
          newHomePage: client.variation('new-homepage', 'control'),
          glassEffect: client.variation('glass-effect', true),
        },
      }
    },
  },
}
```

### Firebase Remote Config

```typescript
remote: {
  source: {
    type: 'firebase',
    fetcher: async () => {
      const { remoteConfig } = await import('firebase/remote-config')
      await remoteConfig().fetchAndActivate()
      return remoteConfig().getAll()  // 转为 AppConfig 结构
    },
  },
}
```

## 7. 缓存策略（对接 Cache G-28）

```
L0 (内存)    ← 当前生效配置（reactive 对象）
L1 (磁盘)    ← 上次成功拉取的远端配置（持久化）
L2 (网络)    ← 远端端点
```

**读取**：L0 → (miss) → L1 → (miss) → 默认值
**写入**：远端拉取成功 → 更新 L0 + L1

## 8. 调试（DevTools G-34）

DevTools 面板展示：
- 当前生效配置（合并后）
- 各层级来源标注（默认/env/platform/remote）
- 配置变更时间线
- 校验失败记录

```
[AppConfig] glassEffect: true (source: remote)
[AppConfig] newHomePage: 'variant-b' (source: remote, updated 2s ago)
[AppConfig] ✘ api.timeout rejected: 99999 > 60000 (fallback to 10000)
```
