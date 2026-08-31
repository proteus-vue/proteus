# 五端存储映射（G-35）

> 原则 #10 应用：框架定义配置语义，各端用原生方式存储。

## 映射总览

| 能力 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| 配置存储 | localStorage | wx.setStorageSync | UserDefaults | SharedPreferences / DataStore | preferences |
| 远端拉取 | fetch | wx.request | URLSession | OkHttp | http |
| 持久化缓存 | IndexedDB | wx.setStorage | Codable | DataStore | preferences |
| 响应式通知 | Vue reactive | - | Combine/KVO | LiveData/Flow | @State |
| 启动读取 | 同步 | 同步 | Info.plist + async | BuildConfig + async | module.json5 |

## 各端实现

### iOS — UserDefaults + Codable

```swift
// ProteusAppConfig.swift
struct AppConfig: Codable {
    let app: AppInfo
    let api: APIConfig
    let features: [String: AnyCodable]
}

class ConfigStore {
    private let defaults = UserDefaults.standard

    func save(_ config: AppConfig) {
        if let data = try? JSONEncoder().encode(config) {
            defaults.set(data, forKey: "proteus.config")
        }
    }

    func load() -> AppConfig? {
        guard let data = defaults.data(forKey: "proteus.config") else { return nil }
        return try? JSONDecoder().decode(AppConfig.self, from: data)
    }
}
```

### Android — DataStore (Preference)

```kotlin
// ProteusAppConfig.kt
class ConfigStore(private val context: Context) {
    private val dataStore = context.createDataStore("proteus_config")

    suspend fun save(config: AppConfig) {
        dataStore.edit { prefs ->
            prefs[KEY_CONFIG] = Json.encodeToString(config)
        }
    }

    fun load(): AppConfig? {
        // 同步读取（启动期）
        return runBlocking {
            dataStore.data.first()[KEY_CONFIG]?.let { Json.decodeFromString(it) }
        }
    }
}
```

### 鸿蒙 — preferences

```typescript
// ProteusAppConfig.ts (ArkTS)
import preferences from '@ohos.data.preferences'

export class ConfigStore {
  private static instance: preferences.Preferences | null = null

  static async getInstance(context: Context): Promise<preferences.Preferences> {
    if (!this.instance) {
      this.instance = await preferences.getPreferences(context, 'proteus_config')
    }
    return this.instance
  }

  async save(config: AppConfig) {
    const prefs = await ConfigStore.getInstance()
    await prefs.putString('config', JSON.stringify(config))
    await prefs.flush()
  }

  async load(): Promise<AppConfig | null> {
    const prefs = await ConfigStore.getInstance()
    const json = await prefs.getString('config', '')
    return json ? JSON.parse(json) : null
  }
}
```

### Web — localStorage + IndexedDB

```typescript
// Web 存储
export const webStore = {
  save(config: AppConfig) {
    localStorage.setItem('proteus.config', JSON.stringify(config))
  },
  load(): AppConfig | null {
    const json = localStorage.getItem('proteus.config')
    return json ? JSON.parse(json) : null
  },
}
```

### Skyline — wx.setStorageSync

```typescript
export const skylineStore = {
  save(config: AppConfig) {
    wx.setStorageSync('proteus.config', JSON.stringify(config))
  },
  load(): AppConfig | null {
    const json = wx.getStorageSync('proteus.config')
    return json ? JSON.parse(json) : null
  },
}
```

## 存储层级

```
L0 (内存)    ← 当前生效配置（reactive）
L1 (磁盘)    ← 远端配置缓存（各端原生存储）
L2 (网络)    ← 远端端点
```

## 启动读取策略

```
App 启动
  ├─ 同步读取 L1（磁盘）→ 立即生效（不阻塞 UI）
  ├─ 异步拉取 L2（网络）
  └─ 拉取成功 → 更新 L0 + L1 → 响应式通知
```

**关键**：首屏用 L1 缓存值，**不等待网络**，保证启动速度。
