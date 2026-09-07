# G-45 补丁二：ABI 版本管理

> **配套**：`04-lifecycle-three-state.md`
> **核心命题**：稳定层 ABI 一旦冻结，版本演进必须**可预测、可校验、可回滚**

---

## 1. ABI 版本三元组

```yaml
abi:
  major: 1      # 破坏性变更（接口签名/数据布局/删除能力）
  minor: 3      # 向后兼容的增量（新增 capability/新增末尾字段）
  patch: 0      # 实现修正，契约不变
```

**语义化版本，但比 SemVer 更严格**：minor 只允许"追加"，不允许"修改末尾以外的内容"。

---

## 2. 兼容矩阵

| 基座 \ 插件 | 1.2.x | 1.3.x | 2.0.x |
|------------|-------|-------|-------|
| **1.2.x** | ✅ | ✅（插件 minor ≤ 基座） | ❌（major 不一致） |
| **1.3.x** | ✅ | ✅ | ❌ |
| **2.0.x** | ❌ | ❌ | ✅ |

**校验规则**（可执行）：

```
兼容 ⇔ (基座.major == 插件.major) AND (基座.minor >= 插件.minor)
```

---

## 3. 四类变更的处理

### 3.1 新增可选 capability（minor +1）

```diff
# 基座 expose 的 capabilities
features:
  camera: true
+ haptic_feedback: true   # 新增，可选
```

- 旧插件不声明 `haptic_feedback` → 仍可链接
- 新基座保留旧能力 → 向后兼容

### 3.2 修改接口签名（major +1）★ 破坏性

```diff
- takePhoto(options: {quality: number}): Promise<Image>
+ takePhoto(options: {quality: number, format: 'jpeg'|'png'}): Promise<Image>
```

- **必须 major +1**
- 旧插件在新基座上 → 链接失败，conformance 拒绝
- 解决路径：并行暴露 v1/v2 接口，一个版本周期内迁移，下个版本移除 v1

### 3.3 删除 capability（major +1）

```diff
- features.sms_send: true   # 移除
```

- 任何声明依赖此能力的插件 → 链接失败
- 必须先标记 deprecated（至少一个 minor 周期），再移除

### 3.4 新增末尾字段（minor +1，兼容）

```diff
interface RenderResult {
  nodeTree: IRNode
+ diagnostics: Diagnostic[]   # 末尾新增，旧消费方可忽略
}
```

- 旧插件不读 `diagnostics` → 正常
- 新插件在旧基座上 → 字段为 undefined，需做防御性判断

---

## 4. 跨版本升级策略

### 4.1 双版本并行（推荐）

```
v1.3 基座 ── 同时 expose v1 API 与 v2 API（标记 deprecated）
    ↓ 一个版本周期内，插件迁移到 v2
v2.0 基座 ── 移除 v1 API
```

### 4.2 强制升级（仅 breaking）

```
基座 2.0 发布 → 插件必须升级到兼容 2.x 的版本
    → 发布新版本（每版本一次，非每次改动）—— 这是 G-45 允许的
```

**关键**：强制升级发生在**发布态**，不是运行态。用户更新 App 是正常的，热更新绕过审核才违规。

### 4.3 回滚

- ABI minor 变更 → 可直接回滚（兼容）
- ABI major 变更 → **不可直接回滚**（旧基座无新能力）
- 回滚预案：保留上一版本基座 + 插件 manifest，通过商店审核走正常更新

---

## 5. cacheKey 精确化

G-45 主文档定义了 `getCacheKey()`，此处精确化：

```
cacheKey(稳定层) = hash(
    framework.version,
    abi.major,
    abi.minor,
    backendManifestHash,    # 所有插件 manifest 的哈希
    signatureChainHash      # 签名证书链哈希
)

cacheKey(变化层) = hash(
    jsBundleHash,
    pluginModuleHashes[]     # 仅变化的插件模块
)
```

**性质**：
- 稳定层 cacheKey 与**页面数/业务规模**无关 ✓
- 任一插件 manifest 变更 → 稳定层 cacheKey 变化 → 触发发布构建
- JS 改动 → 仅变化层 cacheKey 变化 → 开发态秒级热更

---

## 6. conformance 用例（复用 G-44 Test IR）

```
ABI-01  同 major + 插件 minor ≤ 基座 → 链接成功
ABI-02  插件 major > 基座 major      → 链接失败，明确报错
ABI-03  插件声明未 expose 的 feature  → 链接失败
ABI-04  新增末尾字段，旧消费方可忽略  → 运行正常
ABI-05  major 变更后旧插件调用       → 降级后端兜底（不崩溃）
ABI-06  签名链不同源                 → 拒绝装载（G-45.7）
ABI-07  manifest 哈希不匹配推送清单  → 拒绝装载（G-45.8）
ABI-08  运行时尝试加载未预注册模块   → 拒绝执行（G-45.10）
```

**落地状态**：ABI-01~08 已固化为 `@proteus-vue/dev-host` 的 `checkAbiCompat()` + DevHost 装载门禁扩展（mode/ABI/推送清单哈希三道新门），见 `tests/dev-host.test.ts`（#371）。

---

## 7. 发布态产物结构

```
release-artifact/
├── base.apk / base.ipa / base.hap      # 稳定层（基座 + 静态链接插件）
├── manifest.json                        # ABI 声明 + capability 清单
├── compliance-report.json               # 合规报告（能力来源 + 签名链）
├── artifact-hash.txt                    # 产物哈希（升级校验）
└── changelog-abi.md                     # ABI 变更说明（breaking/deprecated）
```

---

## 8. DoD

- [x] `getCacheKey()` 精确实现，单元测试覆盖（#371：backendManifestHash/signatureChainHash 进 base cacheKey）
- [x] 兼容矩阵有自动化校验（ABI-01~08 全部 PASS，#371）
- [ ] 双版本并行迁移路径有参考实现（B6）
- [ ] 产物结构符合第 7 节规范（B6 发布构建脚本）
- [ ] changelog-abi.md 模板化，breaking change 必须填写（B6）
