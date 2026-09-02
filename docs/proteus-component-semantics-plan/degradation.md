# G-31 附录：组件降级与条件渲染

> 配套 `G-31-component-api-semantics.md` §7（G-31.2）+ G-30 §1.2（Tier 模型）。

---

## 1. 核心命题

> **组件的降级路径必须在编译期可用，通过 `@conditional` 或显式 fallback；禁止"该端默默失败 / 运行时才崩"。**（G-30.4 复用）

---

## 2. `@conditional` 原语（G-30 定义，G-31 应用）

```vue
<p-scan-qr v-if="@conditional('capability.scanQR')" @result="onScan" />
<p-button v-else @click="manualInput">手动输入</p-button>
```

Compiler 处理：
1. 查目标 Backend 的 `capabilities.scanQR`
2. 若 `supported: false` → 编译期剔除 `<p-scan-qr>`，保留 `<p-button>`
3. 若 `supported: true` → 保留扫码组件

**结果**：同一份源码，不同 Tier 端得到不同但**合法的**产物。

---

## 3. 属性级降级（G-31.2）

属性也需声明降级（不只是组件整体）：

```vue
<p-button :loading="loading" />
```

| Tier | `loading` 支持 | 降级行为 |
|------|---------------|---------|
| Tier 1/2 | ✅ | 原生 Loading 态 |
| Tier 3（纯渲染） | ⚠️ 部分 | 退化为 `disabled` 态 |

声明方式（C-IR `degradation` 字段）：

```json
{
  "semantic": "ui.button",
  "props": { "loading": true },
  "degradation": {
    "default": "disabled",
    "tiers": { "3": "disabled" }
  }
}
```

未声明降级 → Compiler 报 `CMP006 PROP_NO_DEGRADATION`。

---

## 4. Tier 与组件覆盖矩阵（节选）

| 组件 | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|------|--------|--------|--------|--------|
| `<p-box>` | ✅ | ✅ | ✅ | —（无 UI） |
| `<p-grid>` | ✅ | ✅ | ✅ | — |
| `<p-list>`（虚拟化） | ✅ | ✅ | ⚠️ 退化为普通列表 | — |
| `<p-scan-qr>` | ✅ | ⚠️ 需摄像头能力 | ❌ 编译期剔除 | — |
| `<p-pick-photo>` | ✅ | ⚠️ | ❌ | — |
| `useNative()` | ✅ | ⚠️ 部分能力 | ❌ | ✅（逻辑可跑） |

> **Tier 4（Headless）**：无 UI，组件不渲染，但逻辑（Composition API / `useNative` 的纯计算部分）可跑——这是 SSR / AI Agent 场景的关键。

---

## 5. `defineCapability`（G-30 复用）

业务可在 `app.config.ts` 显式声明所需能力，Compiler 据此裁剪 + 生成权限声明：

```ts
export default defineAppConfig({
  capabilities: {
    camera: { reason: '扫码登录' },
    location: { accuracy: 'when-in-use' }
  }
})
```

→ 自动生成：
- iOS `Info.plist`
- Android `AndroidManifest.xml`
- 鸿蒙 `module.json5`
- **组件中用到的 `<p-scan-qr>` 通过 `@conditional` 校验**

---

## 6. 与 G-28 `BackendCapabilities` 的关系

组件层的 `degradation` 字段**直接消费** G-28 的 `BackendCapabilities`：

```
Backend.capabilities.scanQR = { supported: false, reason: '...' }
        ↓
Compiler 读取
        ↓
<p-scan-qr v-if="@conditional('capability.scanQR')" />
        ↓
编译期裁剪（而非运行时 undefined）
```

**一套 capabilities 机制，同时服务"原生能力"与"组件降级"**——这是方法论支柱 ⑤（可泛化）的又一例证。

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | @conditional 应用 + 属性级降级 + Tier 覆盖矩阵 + defineCapability + G-28 协同 |
