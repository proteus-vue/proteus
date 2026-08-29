# 06 · 超级应用加固：可靠性（M7）

## M7.1 能力加载性能

### 问题
- 大量 adapter 同步初始化 → 启动卡顿
- 低频能力（如支付）首屏不需要

### 方案
- **按需加载**：adapter 默认懒加载
- **预加载提示**：`prefetch: ['payment']`
- **并发限制**：平台 API 调用池

```ts
defineCapability({
  id: 'payment',
  lazy: true,
  prefetch: false,
})
```

---

## M7.2 并发与竞态

- 同一能力多次 `create()` 必须幂等
- 权限请求使用 `Promise` 去重
- 登录/支付等流程加 `lock`

---

## M7.3 内存与生命周期

- Adapter 可持有原生引用（如 AudioContext）
- 页面级能力绑定 `onUnload` 自动释放
- 提供 `capability.dispose()`

---

## M7.4 权限状态缓存

```ts
interface PermissionState {
  granted: boolean
  denied: boolean
  neverAskAgain: boolean
}
```

- 缓存至 Pinia store
- 跨页面复用
- 权限变化主动刷新

---

## M7.5 弱网 / 离线能力

- 网络类 capability 提供 `online/offline` 状态
- 离线时返回明确错误，不静默失败
- 可结合 API 层 Request 重试策略

---

## M7.6 安全边界

- 敏感能力（生物识别、支付）必须声明权限
- Adapter 不持有 token
- 通过 API 层统一鉴权

---

## 验收

- [ ] 首屏不加载低频 adapter
- [ ] 权限请求无竞态
- [ ] 页面销毁释放原生资源
- [ ] 弱网错误可观测
