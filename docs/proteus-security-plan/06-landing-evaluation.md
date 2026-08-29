# Security 落地评估与批次重排（v2）

> 状态：已落地评估（2026-08）  
> 前置：`00-overview.md`（威胁模型/铁律）、`01-m1-secret-storage.md`、`03-m3-permissions.md`  
> 结论先行：**M1（SecretStorage 字段级加解密）+ M3（PermissionRegistry 权限最小化）可完整落地为 `@proteus/security` 包；M2 凭证托管已在 @proteus/api（createAuth）落地（归属说明见下）；M4-M8（注入防护/网络安全/审计）标后续**。

---

## 1. 现状核对（Draft 假设 vs 当前代码库现实）

| # | Draft 假设 | 当前现实 | 结论 |
|---|-----------|----------|------|
| 1 | M1 编译期 transform 扫描 defineStore 校验字段描述符 | 编译器无 security transform（规则注册表需新增）| ⚠️ 首期**运行时 FieldDescriptor 校验**（字段级加解密核心）；编译期 transform 标后续（pinia 集成时）|
| 2 | 三端加密（Web crypto.subtle AES-GCM+PBKDF2 / Skyline 自定义 / App Keystore）| MP 无 crypto.subtle（基础库无原生 AES）| ✅ **Cipher 接口可插拔**：WebCipher（crypto.subtle AES-GCM + PBKDF2，原生零依赖）+ DemoCipher（XOR 演示级降级，文档明确标注非生产）；App Keystore 标 v0.6 |
| 3 | M1 迁移（明文 → 加密）| 无迁移基建 | ✅ `migrate()` 简单版（旧明文 → 加密写回 → 删旧，失败清除不崩溃）|
| 4 | M1 脱敏（encrypted 字段 → `***`）| devtools TraceBus redact 已有（键名命中）| ✅ SecretStorage.redact() 按字段描述符脱敏（比键名更精准），可对接 trace |
| 5 | M3 PermissionRegistry（granted set / request / has / hasAll）| 无权限基建 | ✅ 纯逻辑实现 + granted 持久化（storage 回调，键明文不存凭证）|
| 6 | Router 权限守卫自动生成（meta.permissions → beforeEach）| router 守卫工厂已存在（createRouter auth 检查器）| ✅ **已落地（B2.5）**：RouteMeta.permissions + createRouter options.permissions/onPermissionFail；`<PermissionGate>` 组件与编译期规则标后续 |
| 7 | M3 `<PermissionGate>` 组件 | 组件库已有降级模式（p-error-boundary 等）| ⏸ 组件包装标后续（依赖组件库 + 权限注册表）；首期 API 层足够 |
| 8 | M2 凭证托管归 @proteus/security | M2 已在 @proteus/api（createAuth，贴近请求层）| ✅ **维持现状**：createAuth 留在 api（请求自动 Authorization 同层）；security 包负责存储加密 + 权限 |
| 9 | MP 编译 | 共享模块白名单 `@proteus/*` ✓ | ✅ 纯逻辑 ES5-safe → `_proteus/security` 可用（加密降级到 DemoCipher 或明文 null，文档标注）|

---

## 2. 批次重排

| 批 | 交付物 | 说明 |
|----|--------|------|
| B1 | `@proteus/security`：FieldDescriptor + Cipher 接口（WebCipher/DemoCipher）+ SecretStorage（字段级加解密/volatile 跳过/redact/migrate）| M1，本批 |
| B2 | PermissionRegistry + PermissionDenied + withPermission + granted 持久化 | M3，本批 |
| 后续 | 编译期字段校验 transform / Router 权限守卫自动生成 / `<PermissionGate>` 组件 / audit security 权限矩阵 / App Keystore | 标后续（pinia 集成 / router 守卫对接 / 组件库 / v0.6）|

---

## 3. 验收（B1-B2）

1. 加密 round-trip：`SecretStorage.setItem → getItem` 还原一致；密文与明文不同。
2. `volatile` 字段不写盘（mock storage 断言 write 次数）。
3. `redact`：encrypted 字段 → `***`，明文字段保留。
4. `migrate`：旧明文 → 加密写回 + 删旧；解密失败清除不崩溃。
5. 权限：缺权限 `withPermission` → `PermissionDenied`（含权限名）；grant 后通过；`hasAll`/`clear`（登出清空）。
6. granted 持久化：storage 恢复 / grant 落盘。
7. 每批独立提交，验证 = `npm run verify` 全绿。

---

## 4. 进度追踪

| 批 | 状态 | 说明 |
|----|------|------|
| B1 SecretStorage | ✅ 已落地 | 2026-08——cipher.ts（WebCipher AES-GCM+PBKDF2 / DemoCipher 降级 / hasWebCrypto 探测）+ secret-storage.ts（字段级加解密/volatile 跳过/redact/migrate/Function 检测），7 用例 |
| B2 PermissionRegistry | ✅ 已落地 | 2026-08——permissions.ts（has/hasAll/grant/revoke/clear/request 持久化 + withPermission + PermissionDenied + permissionFor），4 用例 |
| B2.5 Router 权限守卫自动生成 | ✅ 已落地 | 2026-08——RouteMeta.permissions + createRouter options.permissions（PermissionRegistry.hasAll 直接可传）/ onPermissionFail；requiresAuth 之后用户守卫之前自动拦截，6 用例 |
