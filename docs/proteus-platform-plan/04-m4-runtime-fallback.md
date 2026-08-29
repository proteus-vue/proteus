# 04 · 运行时降级（M4）

## 目标

> **能力缺失不是异常，而是可设计的用户体验。**

---

## 1. 降级策略

| 情况 | 行为 |
|------|------|
| 能力完全不支持 | 返回 `UnsupportedAPI` |
| 有 fallback 能力 | 自动切换 |
| 权限被拒绝 | 明确错误码 |
| 平台差异过大 | `required: true` 阻断流程 |

---

## 2. UnsupportedAPI 设计

```ts
export const unsupported = (reason: string): any => ({
  isSupported: () => false,
  then() {
    throw new Error(`Capability not supported: ${reason}`)
  },
})
```

业务代码示例：

```ts
const biometrics = useCapability('biometrics')

if (!biometrics.isSupported()) {
  // 明确 UI 分支，不是平台判断
  return showPasswordLogin()
}
```

---

## 3. Fallback 链

```ts
getCapability('share')
  → share.skyline
  → clipboard (fallback)
  → unsupported
```

配置：

```ts
defineCapability({
  id: 'share',
  fallback: 'clipboard',
})
```

---

## 4. 降级级别（配置）

```ts
defineCapability({
  id: 'login.wechat',
  required: true,      // 缺失直接阻断
  fallback: 'login.sms',
})
```

---

## 5. Skyline 专属问题

- Skyline 不支持 → 自动降级 WebView？ **不允许自动切换渲染模式**
- 改为：明确提示 + 提供替代 UI

---

## 6. 错误模型

```ts
interface CapabilityError {
  code: 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'UNAVAILABLE'
  capability: string
  platform: string
  reason?: string
}
```

---

## 7. 验收

- [ ] 缺失能力不崩溃
- [ ] fallback 自动生效
- [ ] required 能力阻断流程
- [ ] 单测覆盖全部降级路径
