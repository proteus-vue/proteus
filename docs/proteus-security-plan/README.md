# Proteus Security Plan

> 跨端框架的安全基线：Web / 微信小程序 Skyline / App(Native) 三端统一。

## 定位

`proteus-security` 是横切层，对接前面所有 plan：
- **Pinia M7.6**（`encrypted` / `volatile` 字段标记）→ 落地为加密存储实现
- **API A4**（auth / token）→ 落地为凭证托管 + 防重放
- **Platform**（capability）→ 落地为权限最小化 + 敏感 API 守卫
- **Compiler / CLI `audit`** → 落地为安全规则集（`proteus audit security`）
- **Build supply-chain**（M7.6）→ 落地为依赖/产物/签名审计

## 防撑爆规则

- 每份 `.md` 单文件 ≤ 1200 行；单批 LLM 输入 ≤ 3 文件
- LLM 执行时只加载 `00-overview + 当前文件 + 直接依赖`（Types、Compiler、CLI）
- 不把 12 份 plan 全部塞入上下文

## 文件结构

```
00-overview.md            架构 + 铁律 + 里程碑 + 依赖图
01-m1-secret-storage.md   B1 敏感字段加密存储（对接 Pinia M7.6）
02-m2-credential.md       B2 token/code/会话 凭证托管 + 防重放
03-m3-permissions.md      B3 权限最小化 + capability 守卫
04-m4-xss-injection.md    B4 Web XSS / 小程序脚本注入 / App 桥安全
05-m5-network.md          B5 HTTPS/证书固定/流量加密/脱敏
06-m6-supply-chain.md     B6 依赖供应链 + 构建产物签名（对接 Build M7.6）
07-m7-runtime-protection.md B7 CSP/沙箱/iframe/WebView 隔离
08-m8-audit-observability.md B8 proteus audit security + 安全事件上报
09-migration.md           存量代码迁移（dangerouslySetInnerHTML 等）
10-testing.md             安全测试矩阵（SAST/DAST/依赖扫描/渗透）
11-execution-batches.md   B1-B8 分批 + Prompt 模板
```

## 与其他 plan 的关系

| 层 | 引用 Security 的点 |
|----|------|
| Pinia | `encrypted` / `volatile` 字段 → 01 |
| API | token 刷新竞态 / 防重放 → 02 |
| Router | 权限树 → 03（permissions 守卫） |
| Platform | capability 权限 → 03 |
| Compiler | 禁止 `eval`/`Function`/`innerHTML` → 04 + 08 |
| Build | 依赖审计 / 签名 / SBOM → 06 |

## 进度

- [ ] B1 敏感存储
- [ ] B2 凭证托管
- [ ] B3 权限最小化
- [ ] B4 注入防护
- [ ] B5 网络安全
- [ ] B6 供应链
- [ ] B7 运行时保护
- [ ] B8 审计 + 可观测
