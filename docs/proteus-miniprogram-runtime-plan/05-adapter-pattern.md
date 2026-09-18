# G-48 Platform Adapter 规范与兼容矩阵

> **核心命题**：平台差异**全部封装在 Adapter 里**，运行时内核**零平台知识**。每个 Adapter 必须声明**兼容级别**（L0/L1/L2/L3），运行时据此给出**兼容矩阵报告**。

---

## 1. Adapter 结构规范

```typescript
interface PlatformAdapter {
  readonly platform: 'wechat' | 'alipay' | 'douyin' | 'harmonyos';
  readonly version: string;
  readonly capabilities: Record<string, CapabilityLevel>; // 能力 → 级别
  create(ctx: AdapterContext): BackendInstance;
  conformanceCheck(): CheckResult;  // G-45 装载即验证
}
```

**约定**：

- 一个平台 = 一个 Adapter 文件（如 `wechat.adapter.cjs`）
- Adapter **只做映射**（平台 API ↔ 统一语义），**不含业务逻辑**
- Adapter **必须可独立测试**（不依赖具体小程序）

---

## 2. 兼容级别（★ 诚实承诺的核心）

| 级别 | 含义 | 运行时行为 |
|------|------|-----------|
| **L0 完全一致** | API 形态 + 语义完全对齐 | 直接转发 |
| **L1 语义一致，形态适配** | 参数/回调需映射 | Adapter 内部转换 |
| **L2 部分支持** | 子集可用 | 降级 + 警告 |
| **L3 不支持** | 平台无此能力 | **明确 reject + 列入不支持清单** |

**G-48 铁律**：**L0 + L1 ≥ 90%**（标准 API）；**L2 必须显式降级**；**L3 必须明确声明，禁止静默失败。**

---

## 3. 兼容矩阵（自动生成）

运行时启动时，**汇总所有已注册 Adapter 的能力级别**，生成矩阵：

```
能力                | 微信   | 支付宝 | 抖音   | 鸿蒙
--------------------|--------|--------|--------|--------
getSystemInfo       | L0     | L0     | L0     | L0      ← 全兼容
login               | L0     | L1     | L1     | L1      ← 需适配
requestPayment      | L0     | L1     | L2     | L2      ← 部分/需资质
shareTimeline       | L0     | L3     | L3     | L3      ← 仅微信
livePlayer          | L1     | L2     | L3     | L2
bluetooth           | L1     | L1     | L2     | L0
```

**业务侧使用**：

```javascript
const matrix = runtime.getCompatibilityMatrix();
if (matrix.login === 'L3') {
  // 显式处理不支持（不崩溃）
  showToast('当前平台不支持登录');
}
```

**关键**：兼容矩阵是**运行时可查询的数据**，不是文档——业务可据此做**条件 UI**。

---

## 4. 各平台 Adapter 要点

### 4.1 WeChat Adapter（MVP 优先，几乎零适配）

- 微信小程序语法 = **我们的标准** → 大量 L0
- `wx.login` / `wx.requestPayment` 直接映射统一语义
- **MVP 重点验证对象**：证明容器可用

### 4.2 Alipay Adapter

- 差异：`my.login`（前缀 `wx→my`）、`my.getAuthCode`
- 大部分能力 L0/L1，**适配集中在前缀 + 参数名**

### 4.3 Douyin Adapter

- 支持微信小程序项目导入（官方能力）→ **L0 比例高**
- 差异：字节系特有 API（如内容安全）

### 4.4 HarmonyOS Adapter

- ArkUI 原生支持小程序结构 + `@ohos` API
- **组件渲染走 G-27 NativeBackend**（ArkUI 后端）
- 差异：权限模型（`requestPermissions`）、API 命名（`@ohos.account`）

---

## 5. 能力适配示例（login：L0/L1）

```typescript
// 统一语义（运行时侧）
interface LoginCapability {
  login(scope?: string): Promise<AuthResult>;
}

// 微信 Adapter（L0）
class WeChatLogin implements LoginCapability {
  async login(scope) {
    const res = await wx.login({ scope });
    return { scopedToken: res.code, userId: res.openid, expiresAt: Date.now() + 7200_000 };
  }
}

// 支付宝 Adapter（L1：前缀 + 参数映射）
class AlipayLogin implements LoginCapability {
  async login(scope) {
    const res = await my.getAuthCode({ scopes: scope }); // 参数名映射
    return { scopedToken: res.authCode, userId: res.userId, expiresAt: Date.now() + 7200_000 };
  }
}
```

**注意**：返回 `scopedToken`（按 AppID 派生），**不是原始登录态**（RSC-01）。

---

## 6. conformance 快检（装载即验证）

每个 Adapter 装载时跑：

| 编号 | 校验 |
|------|------|
| ADAPT-01 | 所有声明的 L0/L1 能力**有实现**（缺 → 拒绝装载） |
| ADAPT-02 | 同能力**跨 Adapter 结果 shape 一致**（NAT-C） |
| ADAPT-03 | L3 调用 → **明确 reject**（含降级提示），不静默 |
| ADAPT-04 | 返回凭证 = `scopedToken`（非原始登录态） |
| ADAPT-05 | 异步能力走 `setData` 通道，不直连视图层 |
| ADAPT-06 | 声明的能力级别与实际行为**一致**（矩阵可信） |

不过门禁 → **拒绝装载 + 降级后端兜底**（原则 #4）。

---

## 7. 反模式（AP-Adapter）

| 编号 | 反模式 | 后果 |
|------|--------|------|
| AP-01 | Adapter 内含业务逻辑 | 无法复用，违反单一职责 |
| AP-02 | L3 能力静默返回 mock | 业务以为成功，实则失败 |
| AP-03 | 直接返回原始登录态 | 凭证泄漏（违反 RSC-01） |
| AP-04 | 能力级别声明与实际不符 | 兼容矩阵不可信 |
| AP-05 | 绕过 setData 直连视图层 | 破坏双线程隔离 |
| AP-06 | 一个 Adapter 覆盖多平台 | 退化为条件分支（PRIM001） |

---

## 8. MVP 范围（已确认）

- ✅ **微信 Adapter**：完整 L0/L1，验证容器
- ✅ **鸿蒙 Adapter（模拟）**：验证跨平台切换（逻辑零修改）
- ⏭️ 支付宝 / 抖音：结构同微信，**可并行扩展**（不在 MVP 阻塞主线）
- ✅ **兼容矩阵生成 + 查询 API**
- ✅ **降级行为**（L2/L3 不崩溃）

**MVP 目标**：用**微信 + 鸿蒙模拟**证明"**换 Adapter 业务逻辑零修改**"——这是 G-48 的核心价值命题，必须被 conformance 验证。
