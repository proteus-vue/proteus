# 00 - Architecture Overview

## 1. 设计目标

Proteus Security 层提供**三端统一的 Web / Skyline / App 安全基线**，把"业务代码不写安全逻辑"作为铁律，所有防护收敛在框架运行时 + 编译期规则。

核心理念对齐框架整体：
- **透明**：每条安全规则可解释、可审计（`--explain`、`proteus audit security`）
- **AI 可读**：规则契约 JSDoc 化，LLM 可查可改
- **最小可用**：默认安全，开发者按需降级并显式标注 `@danger`

## 2. 威胁模型（三端统一）

```
┌──────────────────────────────────────────────────┐
│  不可信输入                                        │
│  URL/query / 用户输入 / 服务端响应 / 深链接        │
└──────────────────┬───────────────────────────────┘
                   ↓ [M3 输入校验 + 转义]
┌──────────────────────────────────────────────────┐
│  应用运行时                                        │
│  Pinia(store) / API(request) / Component(DOM)    │
│  + 凭证托管(M2) + 权限守卫(M3)                    │
└──────────────────┬───────────────────────────────┘
                   ↓ [M4 注入防护 / M7 运行时隔离]
┌──────────────────────────────────────────────────┐
│  持久化 / 网络 / 原生桥                             │
│  Storage(encrypted) / HTTPS / JSBridge           │
└──────────────────────────────────────────────────┘
```

## 3. 分层架构

```
L4 业务页面/组件          ← 禁止直接操作敏感数据、禁止 eval/innerHTML
L3 @proteus/security     ← useSecret / usePermission / withPermission
L2 适配器                ← web(crypto/subtle) / skyline(wx.getStorage encrypted) / app(Keystore/Keychain)
L1 平台原生               ← Web Crypto / wx 加密 API / iOS Keychain / Android Keystore
```

## 4. 铁律

1. **敏感数据不落地明文**：`encrypted` 字段必须经存储加密层；`volatile` 字段不持久化
2. **凭证不进业务代码**：token / secret 只走凭证托管，业务读 `useAuth()` 不读 raw
3. **权限最小化**：capability 调用前必须 `withPermission`，缺权限抛 `PermissionDenied`（不静默失败）
4. **禁止运行时字符串求值**：`eval` / `new Function` / `setTimeout(string)` / `innerHTML` 编译期阻断
5. **网络强制 HTTPS + 证书校验**（生产环境），调试开关需显式 `@danger`
6. **依赖/产物可审计**：SBOM + 签名 + 漏洞扫描，对接 `proteus audit`

## 5. 里程碑

| 里程碑 | 内容 | 依赖 |
|--------|------|------|
| M1 | 架构 + 类型 + 配置 schema | Types |
| M2 | 运行时：secret-storage / credential / permission | Compiler, Pinia |
| M3 | 编译期规则集（禁用 API 列表） | Compiler, CLI |
| M4 | 注入防护（XSS / 脚本注入 / 桥安全） | Component |
| M5 | 网络安全（HTTPS / TLS pinning / 脱敏） | API |
| M6 | 供应链（SBOM / 签名 / 漏洞扫描） | Build |
| M7 | 运行时隔离（CSP / 沙箱 / WebView） | Platform |
| M8 | 审计 + 可观测（audit security + 上报） | DevTools, CLI |

## 6. 依赖图

```
Types ──→ M1 ──→ M2 ──→ M3 ──→ M4
                ↑        ↑        ↑
              Pinia    Compiler  Component
                        CLI      Platform
                        
API ──→ M5 ──→ M6(Build) ──→ M7 ──→ M8(DevTools/CLI)
```

## 7. 验收标准

- [ ] `proteus audit security` 覆盖 M1-M8 全部规则，错误定位到行列
- [ ] `encrypted` 字段在 Storage adapter 层自动加解密，业务无感知
- [ ] token 刷新竞态：并发 N 请求只触发 1 次 refresh
- [ ] `eval` / `innerHTML` / `dangerouslySetInnerHTML` 在业务目录编译报错
- [ ] 权限缺失时 UI 自动 fallback（不白屏、不静默）
- [ ] 依赖漏洞 + 产物完整性在 CI 门禁拦截
- [ ] 敏感字段在 trace / 日志 / 快照中自动脱敏（对接 DevTools M8）

## 8. 与其他 plan 的接口契约

- `Pinia`: `defineStore({ state: { token: { volatile: true }, profile: { encrypted: true } } })`
- `API`: `createRequest({ baseURL, certPinning: true, redact: ['Authorization'] })`
- `Router`: `meta.permissions: ['user:read']` → M3 守卫自动生成
- `Platform`: `defineCapability({ permissions: ['scope.userLocation'] })`
- `Compiler`: transform 扫描禁用 API，输出 `security-report.json`
- `CLI`: `audit security --fix` 自动升级漏洞依赖
