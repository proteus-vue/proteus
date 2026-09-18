# 01 · Capability 契约（M1）

## 设计目标

> **业务依赖“能力”，不依赖“平台”。**

---

## 1. Capability 定义

```ts
// shared/capabilities/types.ts
export interface CapabilityMeta {
  id: string               // 'share' | 'login.wechat' | 'biometrics'
  tier: 1 | 2 | 3 | 4
  since?: string           // 支持的最低基础库/版本
  permissions?: string[]
}

export interface CapabilityAPI {
  isSupported(): boolean | Promise<boolean>
}

export interface Capability<T extends CapabilityAPI> {
  meta: CapabilityMeta
  api: T
}
```

---

## 2. 业务使用 API

### 2.1 组合式 API（推荐）

```ts
const share = useCapability('share')

if (!share.isSupported()) {
  showToast('当前环境不支持分享')
  return
}

await share.api.share({
  title: 'Proteus',
  imageUrl: 'https://...',
})
```

### 2.2 命令式 API（基础设施使用）

```ts
const clipboard = getCapability('clipboard')
```

---

## 3. 能力描述文件（关键）

每个能力必须有一个描述文件：

```ts
// capabilities/share.capability.ts
export default defineCapability({
  id: 'share',
  tier: 2,
  permissions: [],

  adapters: {
    web: () => import('./adapters/share.web'),
    skyline: () => import('./adapters/share.skyline'),
    app: () => import('./adapters/share.app'),
  },

  fallback: 'clipboard', // 可选降级能力 id
})
```

> ✅ **平台映射集中在此文件，不在业务代码。**

---

## 4. 能力探测（Feature Detection）

### 4.1 同步探测

```ts
isSupported(): boolean {
  return typeof navigator.share === 'function'
}
```

### 4.2 异步探测（权限/设备）

```ts
async isSupported() {
  const res = await wx.getDeviceInfo()
  return res.platform !== 'devtools'
}
```

---

## 5. Skyline 特殊约束

- Skyline 能力探测必须在 **UI 线程 Worklet 外**完成
- 涉及权限的能力需显式声明 `permissions`
- 不支持的能力返回 `{ supported: false, reason }`，不抛异常

---

## 6. 编译期契约

- 所有 `capabilities/*.capability.ts` 可被静态扫描
- CLI 生成：`capability-manifest.json`
- 用于：
  - 构建分叉
  - 回归矩阵
  - DevTools 展示

---

## 7. 验收标准

- [ ] 业务代码无平台判断
- [ ] 每个能力有 `isSupported`
- [ ] 每个能力有描述文件
- [ ] 缺失能力不抛异常（除非 `required: true`）

---

## 8. trace-transform 映射

```
capability 描述文件
  → capability-manifest.json
  → 平台 adapter 选择
  → 产物代码
```

可通过 `--trace-capability` 查看。
