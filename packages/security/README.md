# @proteus/security

Proteus 三端统一安全基线（security-plan B1-B2）。

## M1 — SecretStorage（敏感字段加密存储）

```ts
import { SecretStorage, createCipher } from '@proteus/security'

// 字段描述符：volatile = 内存 only；encrypted = 加密落盘；默认明文
const fields = {
  token: { value: '', volatile: true },    // 不持久化
  profile: { value: {}, encrypted: true }, // 加密落盘
  settings: { value: {} },                 // 明文落盘
}
const cipher = await createCipher('用户口令/密钥') // 有 WebCrypto → AES-GCM+PBKDF2；无 → DemoCipher（演示级，警告）
const store = new SecretStorage({ storage: localStorageAdapter, fields, cipher })

await store.setItem('user', { token: 'x', profile: { name: 'P' }, settings: { theme: 'dark' } })
const state = await store.getItem('user')   // token 跳过、profile 解密还原
const safe = store.redact(state)            // profile → '***'
await store.migrate('user')                 // 旧明文 → 加密写回（失败清除不崩溃）
```

## M3 — PermissionRegistry（权限最小化）

```ts
import { PermissionRegistry, withPermission, permissionFor, PermissionDenied } from '@proteus/security'

const registry = new PermissionRegistry({ storage: localStorageAdapter })
registry.grant([permissionFor('camera', 'use')])

try {
  await withPermission(registry, ['camera:use'], async () => capture()) // 缺权限 → PermissionDenied
} catch (e) {
  if (e instanceof PermissionDenied) showGuide(e.permission)
}
```

## 边界（落地评估 v2）

- DemoCipher 为无 WebCrypto 平台（小程序）的演示级降级——生产接 Keystore/服务端加密（v0.6+）
- Router 权限守卫自动生成 / `<PermissionGate>` 组件 / 编译期字段校验 → 后续批次
- M2 凭证托管（createAuth）在 @proteus/api（贴近请求层），见 `docs/proteus-security-plan/06-landing-evaluation.md`
