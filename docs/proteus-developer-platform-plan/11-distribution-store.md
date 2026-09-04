# 11 分发与运行（B3）

> 接续 `10-submission-review.md`。定义 **DistributionAPI**：上架、CDN、灰度、热修复、下架。
> **运行时的"供给侧"**（消费 10 审核通过的 SignedPackage）。

---

## 1. 分发流程

```
SignedPackage (双签名)
   │
   ▼
① release（上架）
   ├── 上传到 CDN（包 + manifest 索引）
   ├── 生成 manifest.json（可用版本清单，供运行时查询）
   └── 写入应用市场索引
   │
   ▼
② canary（灰度，可选）
   ├── 规则：人群 / 地域 / 比例 / 设备
   └── 逐步放量（10% → 50% → 100%）
   │
   ▼
③ 运行时拉取（G-48 Runtime）
   ├── 查询 manifest.json（最新可用版本）
   ├── 下载 AppPackage
   ├── 校验双签名（08 §3）
   └── 创建 IsolatedPageFrame（G-49）
   │
   ├─ 运行中...（治理：配额/审计，见 12）
   │
   ▼
④ unpublish / hotfix（见下）
```

---

## 2. CDN 与 manifest 索引

```json
// manifest.json（运行时查询用）
{
  "packageId": "com.example.demo",
  "latest": "1.2.0",
  "releases": [
    { "version": "1.2.0", "url": "https://cdn.../1.2.0.pkg", "signature": "..." },
    { "version": "1.1.0", "url": "https://cdn.../1.1.0.pkg", "signature": "..." }
  ]
}
```

**运行时只信任 manifest 索引 + 双签名**——CDN 被劫持也不影响（G-45 防 MITM）。

---

## 3. 灰度策略（canary）

```typescript
type CanaryRules = {
  percentage?: number;        // 0-100
  regions?: string[];         // 地域白名单
  userGroups?: string[];      // 人群标签
  devices?: { os?: string; minSdk?: string };
};
```

**灰度失败可一键回滚**（`unpublish` + 切回上一版本）。

---

## 4. 热修复（hotfix，08 已定义协议）

```
v1.0.0 → 发现 bug → 发布 v1.0.1-patch（仅 diff）
  → CDN 更新 → 运行时下载 → 校验签名 → 应用 diff → 重启 PageFrame
```

**热修复限制**：不得新增 capability / 不得改 permissions（需走完整提审）。

---

## 5. 下架（unpublish，治理触发）

```
unpublish(releaseId, reason)
   │
   ├── 从 CDN / 市场索引移除
   ├── 通知运行时（推送 revoke 指令）
   └── 运行时 terminate + Drop 级联（G-43，无泄漏）
```

**下架是"优雅终止"**：正在运行的实例走完当前操作后销毁，**不丢数据、不崩溃**。

---

## 6. conformance 断言

- `DIST-01`：运行时仅加载 manifest 中**已签名**的版本
- `DIST-02`：灰度规则外的用户**看不到**灰度版本
- `DIST-03`：unpublish 后**新用户无法下载**，老用户收到 revoke
- `DIST-04`：hotfix 不得新增 capability（违反 → 审核拒绝）

---

*下一份（B4 收官）：`12-governance-monetization.md`。*
