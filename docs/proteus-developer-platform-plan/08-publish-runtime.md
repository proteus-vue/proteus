# 08 发布与运行（A5，A→B 桥接点）

> 接续 `07-component-toolkit.md`。**本文是 A 工具链 → B 生态的桥接点**：
> CLI `publish` 的产物（AppPackage）如何被 **G-48 Runtime 加载** + **G-49 沙箱校验** + **B 审核签名**。

---

## 1. publish 流程（完整）

```
CLI build ─▶ BuildArtifact
     │
     ▼
① 审计（04-audit，AUD-01~06）
     │ 失败 → 阻断
     ▼
② 开发者签名（G-45，私钥 = 开发者门户签发）
     │
     ▼
③ 上传 AppPackage 到平台（DeveloperAPI.publish）
     │
     ▼
④ 平台自动扫描（10-autoScan：签名校验 + 恶意代码 + 权限合规）
     │
     ├─ 通过 → ⑤a 人工审核（restricted 能力）/ 直接 ⑥
     └─ 失败 → 驳回（SUBMISSION_REJECTED）
              │
              ▼
⑤ 审核通过 → 平台签名（G-45 双签名：developer + platform）
              │
              ▼
⑥ 分发（11-release：上架 CDN / 应用市场）
              │
              ▼
⑦ 运行时加载（G-48 Runtime）
     ├─ 校验双签名（G-45）
     ├─ 校验 permissions / resources（G-49 Sandbox）
     └─ 创建隔离 PageFrame（G-49 IsolatedPageFrame）
```

**publish 之后 = B 的领域**（09-12）。本文只定义**产物规范与加载契约**，运行时行为归 G-48/G-49。

---

## 2. AppPackage 生命周期（状态机）

```
draft → auditing → [rejected] → draft
                   ↓ (通过)
                approved → released → running → [revoked] → unpublished
                              ↓
                         canary (灰度)
```

**状态由 GovernanceAPI 管理**（见 12）；**状态迁移全部可审计**（G-49 审计风格）。

---

## 3. 运行时加载契约（对接 G-48/G-49）

```typescript
// G-48 Runtime 加载入口（扩展 G-48 PageFrame）
interface RuntimeLoader {
  /** 加载 AppPackage（来自 CDN 或本地） */
  load(ref: AppPackageRef): Promise<IsolatedPageFrame>;  // G-49 隔离帧
}

// 加载时强制校验（顺序固定）
async function load(ref: AppPackageRef) {
  const pkg = await fetchPackage(ref);          // 下载
  assertSignature(pkg, {                        // ★ G-45 双签名校验
    developer: pkg.developerSignature,
    platform: pkg.platformSignature,             // 审核签名（必填）
  });
  assertPermissions(pkg.permissions);            // ★ G-49 CapabilityBridge
  assertQuota(pkg.resources);                    // ★ G-49 ResourceQuota
  return createIsolatedPageFrame(pkg);           // ★ G-49 IsolatedPageFrame
}
```

**任何断言失败 → 拒装**（不降级，不重试）——复用 G-45.8「manifest 哈希防 MITM」（G-45.9 仅限开发态，不延伸线上热更新）+ G-49 deny-by-default。

---

## 4. 热修复（hotfix，11 扩展）

```
原包 v1.0.0 ─▶ 发现 bug
                │
                ▼
发布补丁 v1.0.1-patch（仅 diff）
                │
                ▼
运行时下载补丁 → 校验签名 → 应用 diff → 重启 PageFrame（G-43 Drop 级联）
```

**热修复不更新版本号主段**，仅补丁；**必须双签名**（开发者 + 平台）。

---

## 5. conformance 断言

- `PUB-01`：CLI 产出的 AppPackage 可被 G-48 Runtime 加载（桥接）
- `PUB-02`：**缺失平台签名**的包被运行时拒绝（G-45）
- `PUB-03`：声明的 permissions 与实际调用不一致 → 运行时拒绝（G-49）
- `PUB-04`：资源超限 → QUOTA_EXCEEDED（结构化错误，非异常，G-49.6）
- `PUB-05`：revoke 后正在运行的包被**优雅终止**（G-43 Drop 级联，无泄漏）

---

## 6. 与 G-48/G-49 的接口对齐

| 步骤 | 依赖 | 来源 |
|------|------|------|
| 签名校验 | G-45 签名同源（双签名） | 本份扩展 |
| 权限校验 | G-49 CapabilityBridge | 复用 |
| 配额校验 | G-49 ResourceQuota | 复用 |
| 隔离帧创建 | G-49 IsolatedPageFrame | 复用 |
| 代码包加载 | G-48 PageFrame / setData | 复用 |

> **G-50 不重新实现运行时**，只**定义生产/治理接口** + **加载时的强制校验顺序**。

---

*Phase 1（A 工具链）到此完成。下一份进入 Phase 2（B 生态）：`09-developer-portal.md`。*
