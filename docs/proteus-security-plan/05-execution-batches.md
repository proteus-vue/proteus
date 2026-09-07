# 05 - Execution Batches & Migration

## 分批策略（8 批，防撑爆）

每批 = 1 PR = LLM 单次 ≤3 文件；执行时只加载 `00-overview + 当前文件 + 直接依赖`。

### B1（M1）— SecretStorage + 字段描述符
- **输入**：`01-m1-secret-storage.md` + Types `FieldDescriptor` + Compiler transform 骨架
- **产出**：`@proteus-vue/security/secret-storage.ts` + Storage adapter 加密层 + 单测
- **验收**：encrypted round-trip / volatile 不落盘 / trace 脱敏

### B2（M2）— CredentialStore + 刷新竞态
- **依赖**：B1（encrypted 存储）
- **产出**：`useAuth` + refresh 队列 + 防重放 nonce
- **验收**：并发 10×401 → 1 次 refresh

### B3（M3）— PermissionRegistry + withPermission
- **依赖**：Types `Platform` 联合
- **产出**：`defineCapability` + `PermissionGate` 组件 + Router 守卫生成
- **验收**：缺权限 → PermissionDenied + fallback UI

### B4（M4）— 注入防护 + 禁用 API 规则集
- **依赖**：Compiler transform API、Component `SafeHtml`
- **产出**：ESLint 规则 + Semgrep 规则 + `no-eval` 测试 fixtures
- **验收**：`eval`/`innerHTML` 编译报错

### B5（M5）— 网络安全 + 脱敏
- **依赖**：API `createRequest`
- **产出**：HTTPS 强制 + certPinning + redact 中间件
- **验收**：日志中 token 为 `***`

### B6（M6）— 供应链（SBOM / 签名 / 扫描）
- **依赖**：Build pipeline、CLI
- **产出**：`audit security` 规则 + CI job + `sbom.json` 生成
- **验收**：高危漏洞 CI 阻断

### B7（M7）— 运行时隔离（CSP / 沙箱）
- **依赖**：Platform adapter、Lifecycle `onDestroy`
- **产出**：CSP middleware + WebView 白名单校验
- **验收**：DOM 注入型 XSS 被 CSP 拦截

### B8（M8）— 审计 + 可观测
- **依赖**：DevTools TraceBus、CLI reporter
- **产出**：`proteus audit security` + 安全事件上报
- **验收**：全规则覆盖 + 行列定位 + DevTools 面板

## 依赖图

```
Types ──→ B1 ──→ B2 ──→ B3 ──→ B4
                ↓        ↓        ↓
              Pinia    API     Component
                        ↓
                      B5 ──→ B6(Build/CLI) ──→ B7(Platform/Lifecycle)
                                          ↓
                                        B8(DevTools)
```

## 迁移批次

| 存量问题 | 迁移动作 | 工具 |
|----------|---------|------|
| `localStorage.setItem('token')` | → `useAuth().login()` | `audit security --fix` |
| `wx.authorize(...)` | → `defineCapability` | codemod |
| `v-html` / `dangerouslySetInnerHTML` | → `<SafeHtml>` + DOMPurify | 手动 + lint |
| 明文 store 字段 | → `{ value, encrypted: true }` | codemod |
| HTTP 接口 | → HTTPS | 手动 |
| 无 CSP | → 默认 strict CSP | middleware |

## 测试策略

- **单元**：加密、权限、刷新队列（vitest，mock 平台 API）
- **集成**：`withPermission` + Router 守卫端到端
- **SAST**：ESLint + Semgrep 规则自测（fixtures 含正反例）
- **DAST**：Web 产物跑 ZAP baseline
- **渗透**：手工验证防重放 / 权限绕过

## Prompt 模板（喂 LLM）

```
你是 Proteus Security 模块实现者。
【绝对不要】
- 使用 eval / Function / innerHTML
- 把 token 存 localStorage 明文
【必须】
- 读 00-overview.md + 01-m1-secret-storage.md
- 实现 B1 验收标准（encrypted round-trip / volatile / redact）
- 每个文件顶部 JSDoc 标注：输入/输出/平台差异
- 三端 adapter 放 platforms/{web,skyline,app}/
- 对齐 --trace-transform 与 audit 输出格式
```

## 进度追踪

- [ ] B1 SecretStorage
- [ ] B2 Credential
- [ ] B3 Permission
- [ ] B4 Injection
- [ ] B5 Network
- [ ] B6 Supply Chain
- [ ] B7 Runtime
- [ ] B8 Audit
