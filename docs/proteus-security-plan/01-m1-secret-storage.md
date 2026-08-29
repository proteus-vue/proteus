# M1 - Secret Storage（敏感字段加密存储）

> 对接 Pinia M7.6 的 `encrypted` / `volatile` 字段标记。业务 state 声明字段属性，Storage adapter 自动加解密。

## 1. API 设计

```ts
// stores/user.ts
export const useUserStore = defineStore('user', {
  state: () => ({
    token: { value: '', volatile: true },        // 不持久化
    profile: { value: {}, encrypted: true },      // 加密落盘
    settings: { value: {}, encrypted: false },    // 明文落盘（默认）
  }),
})
```

编译期 / 运行时归一化为 `FieldDescriptor`：

```ts
type FieldDescriptor<T> =
  | { value: T; volatile?: false; encrypted?: boolean }
  | { value: T; volatile: true }   // 内存 only
```

## 2. Storage Adapter 加解密层

```
setItem(key, value):
  for each field in value:
    if field.volatile → skip（不写盘）
    if field.encrypted → encrypt(field.value) → base64
  write to platform storage

getItem(key):
  raw = read from platform storage
  for each field:
    if field.encrypted → decrypt(raw.field)
  return hydrated state
```

### 三端加密实现（L2 adapter）

| 平台 | 实现 |
|------|------|
| Web | `crypto.subtle` AES-GCM，key 派生自 PBKDF2（用户口令 / 固定 salt） |
| Skyline | `wx.getStorage` + 自定义加密；或 `wx.setStorage` 前 `CryptoJS.AES` |
| App | iOS Keychain / Android Keystore，key 由系统托管 |

> **关键**：加密密钥**不**硬编码在代码里。Web 端 key 来自登录口令派生；App 端交系统 Keystore。

## 3. 编译期校验

Compiler transform 扫描 `defineStore` 的 `state`，校验：
- `encrypted: true` 的字段类型必须可序列化（禁止 Function / Class 实例）
- `volatile` 字段不得出现在 `persisted()` 的 `paths` 白名单
- 同一 store 不得 `volatile` 与 `encrypted` 同时为 true

报错示例：
```
[proteus/security] stores/user.ts:12
  field "token" is marked `volatile`, but included in persisted.paths.
  → remove from paths or change to `encrypted`.
```

## 4. 迁移：存量明文 → 加密

启动时检测旧版明文数据（`__v` 字段缺失），一次性 migrate：
1. 读明文 → 加密写回 → 删明文
2. 迁移失败（key 不可用）→ 清除该 store，触发重新登录

## 5. 脱敏（对接 DevTools / trace）

`encrypted` 字段在 trace / 日志 / 快照导出时自动替换为 `***`：
```ts
redact(state) → { token: '***', profile: '***', settings: {...} }
```

## 6. 测试

- 单元测试：加密 round-trip、volatile 不落盘（mock storage 验证 write 次数 = 0）
- 跨端一致性：同一明文在三端加密后密文不同（key 来源不同），但解密结果一致
- 迁移测试：v0 → v1 带明文数据，启动后转为加密

## 7. 验收

- [ ] `encrypted` 字段业务侧无感知自动加解密
- [ ] `volatile` 字段进程重启后丢失（符合预期）
- [ ] trace / 快照中敏感字段为 `***`
- [ ] 迁移失败不崩溃，触发重新登录
