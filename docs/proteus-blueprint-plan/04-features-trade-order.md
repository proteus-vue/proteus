# 功能域 2：交易模块（电商式闭环）

> **目标**：验证 Router(guard) + API(Payment) + Security(凭证/签名) + i18n + Pinia(auth) 五层联动
> **说服力**：支付是全链路强校验场景，任何一层出问题用户直接损失

---

## 4.1 功能规格

| 页面 | 路径 | chunk | 权限 |
|------|------|-------|------|
| 商品详情 | `/trade/product/:id` | trade | public |
| 购物车 | `/trade/cart` | trade | user |
| 确认订单 | `/trade/checkout` | trade | user |
| 支付 | `/trade/pay/:orderId` | trade | user |
| 支付成功 | `/trade/pay/success` | trade | user |
| 订单列表 | `/trade/orders` | trade | user |
| 订单详情 | `/trade/order/:id` | trade | user+owner |
| 退款 | `/trade/refund/:id` | trade | user+owner |

**路由分包**：整个 trade 模块 = 1 个分包（用户未进入交易流程时不加载）

## 4.2 权限树（Security M3 + Router M8）

```ts
// config/permissions.ts
export const permissions = {
  'trade:cart': ['user'],
  'trade:checkout': ['user', 'verified'],  // ← 需实名认证
  'trade:pay': ['user', 'verified', 'hasPaymentMethod'],
  'trade:refund': ['user', 'owner'],
}
```

**Router 守卫自动生成**（Router M8.1）：
```ts
// 开发者不写守卫逻辑，只声明权限
{
  path: '/trade/pay/:orderId',
  meta: { permissions: ['user', 'verified', 'hasPaymentMethod'] },
}

// ← Compiler 自动生成：
// beforeEach((to) => {
//   const auth = useAuthStore()
//   if (!auth.hasAll(to.meta.permissions)) return '/auth/login'
// })
```

**验收点**：
- [ ] `proteus audit route` 输出权限矩阵（8 页 × 权限组合）
- [ ] 未登录访问 `/trade/cart` → 自动跳 `/auth/login?redirect=/trade/cart`
- [ ] 未实名访问 `/trade/checkout` → 跳实名认证页
- [ ] 无支付方式访问 `/trade/pay` → 跳绑卡页
- [ ] 非订单主人访问 `/trade/order/123` → 403 页（不是白屏）

## 4.3 支付流程（API Payment + Security）

```ts
// api/payment.ts
export async function createPayment(order: Order) {
  const auth = useAuthStore()

  // 1. Security: 请求签名（防篡改）
  const signed = await signRequest({
    orderId: order.id,
    amount: order.total,
    timestamp: Date.now(),
  }, auth.secretKey)

  // 2. 调用支付 API
  const { prepayId } = await request.post('/api/pay/create', signed)

  // 3. Platform: 拉起支付
  return paymentCapability.pay({
    provider: 'wechat',
    prepayId,
    // Security: 敏感字段 encrypted
    sensitiveData: encrypt(order.userInfo, auth.publicKey),
  })
}
```

**验收点**：
- [ ] 请求体带签名，篡改金额 → 服务端拒绝（抓包验证）
- [ ] `secretKey` 走 Security `encrypted` 存储，不在 DevTools 明文可见
- [ ] 三端支付方式：微信支付（Skyline）/ Stripe（Web）/ Apple Pay（App）
- [ ] 支付取消/失败/超时 → 状态机正确处理，不重复扣款

## 4.4 国际化（i18n）

```vue
<!-- pages/trade/checkout.vue -->
<template>
  <view class="checkout">
    <text>{{ $t('trade.checkout.title') }}</text>
    <text>{{ $t('trade.checkout.total', { amount: total }) }}</text>
    <!-- ICU 复数 -->
    <text>{{ $tc('trade.cart.items', cartCount) }}</text>
  </view>
</template>
```

**验收点**：
- [ ] 中文：`共 3 件商品`（复数正确）
- [ ] 英文：`3 items`
- [ ] 阿拉伯语：RTL 布局，价格格式 `د.إ 123`
- [ ] `proteus audit i18n` 检测：
  - [ ] 无 hardcoded 中文/英文
  - [ ] 无 dynamic key（`$t(variable)` 报错）
  - [ ] 无 missing translation
- [ ] 语言包分包：`dist/mp/locales/en-US.js` 独立文件，进入交易页才加载

## 4.5 状态恢复（Lifecycle + Pinia）

```
场景：用户在「确认订单」页填写备注 → 切后台 → 被杀进程 → 重新打开
```

**期望行为**：
- `launchType: 'recover'`（Lifecycle M1）
- 从 `onRecover` 恢复：订单草稿 + 已选优惠券 + 填写中的备注
- 恢复到「确认订单」页（深层链接还原）

**验收点**：
- [ ] DevTools 导出快照 → 模拟杀进程 → 导入 → 页面 + 表单完整恢复
- [ ] `volatile` 字段（如倒计时）不恢复（正确）
- [ ] `encrypted` 字段（如支付凭证）恢复后仍加密

## 4.6 LLM 执行批次

```
Batch-F2.1: 权限树定义 + Router 守卫生成
Batch-F2.2: 支付 API + 签名 + Security 集成
Batch-F2.3: i18n 消息清单 + 语言包分包
Batch-F2.4: 订单状态机 + 状态恢复
Batch-F2.5: 端到端支付流程验证
```

**依赖**：Router M7-M8 ✅ / API A1,A5 ✅ / Security 全部 ✅ / i18n 全部 ✅

---

## 跨功能域依赖图

```
功能域 1（播放器）──┐
                    ├─→ 共享：Pinia stores / Router config / Platform capabilities
功能域 2（交易）────┤
                    │
功能域 3（社交）────┤  ← 见 05-features-social-realtime.md
功能域 4（内容）────┘  ← 见 06-features-content-discovery.md
```

**关键约束**：功能域之间**只允许通过 Module Boundary 通信**（Module M2），禁止直接 import 对方 store。

---
