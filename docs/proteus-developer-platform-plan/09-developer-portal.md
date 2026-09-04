# 09 开发者门户（B1）

> 接续 `08-publish-runtime.md`。定义 **DeveloperPortalAPI**：开发者注册、应用管理、密钥、成员协作。
> **B 生态的起点**（Phase 2）。

---

## 1. 核心资源模型

```
Developer (开发者)
  ├── APIKey (密钥对：publicId + secretKey)
  ├── Member[] (成员，RBAC)
  └── App[] (应用)
        ├── AppVersion[] (版本)
        ├── Submission[] (提审记录)
        └── Release (上架版本)
```

**packageId 全局唯一**（反向域名），归属一个 Developer。

---

## 2. 接口（对应 03-spi.ts DeveloperPortalAPI）

| 方法 | 说明 | 权限 |
|------|------|------|
| `registerDeveloper` | 注册（实名/企业资质） | 公开 |
| `createApp` | 创建应用（生成 packageId） | 开发者 |
| `rotateKey` | **轮换密钥**（安全，建议 90 天） | 开发者/管理员 |
| `manageMembers` | 邀请/移除成员、分配角色 | 管理员 |

**所有调用过 G-42 安全网关**（能力调用网关，host-container 复用）。

---

## 3. 密钥体系（G-46 凭证隔离的应用）

```
Developer
  └── APIKey (主密钥，用于门户 API 调用)
        │
        └── AppSecret (每个 App 独立，用于 CLI publish)
              │
              └── SigningKey (签名私钥，用于 G-45 开发者签名)
```

**三级隔离**：门户凭证 / 应用凭证 / 签名凭证**互不通透**——
**一个 AppSecret 泄漏 → 仅影响该应用，不波及开发者账户**（G-46 凭证隔离原则）。

---

## 4. RBAC 角色

| 角色 | 权限 |
|------|------|
| Owner | 全部（含删除应用、结算） |
| Admin | 管理成员、提审、发布 |
| Developer | 开发、调试、提交 |
| Viewer | 只读（数据分析） |

---

## 5. 实名与资质（合规前置）

- **个人**：手机号 + 身份证（加密存储，对齐 devtools-plan 隐私脱敏铁律）
- **企业**：营业执照 + 对公验证
- **受限能力（payment 等）需额外资质**（restricted = true → 审核强制，见 10）

---

## 6. conformance 断言

- `PORTAL-01`：注册 → 创建应用 → 获取密钥 流程闭环
- `PORTAL-02`：**密钥轮换后旧密钥立即失效**（安全）
- `PORTAL-03`：成员移除后立即失去权限（无缓存窗口）
- `PORTAL-04`：一个开发者最多 N 个应用（防滥用，配额）

---

*下一份：`10-submission-review.md`（B2：提审与审核，含双签名）。*
