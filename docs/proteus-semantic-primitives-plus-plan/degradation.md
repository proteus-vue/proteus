# 原语降级设计（Graceful Degradation）

> 对应 G-32 §1 P5「缺失即降级」。当 Backend 不支持某原语/能力时，**编译期按 `@conditional` 降级，不断链、不报错**（除非显式 `required`）。

---

## 1. 三级降级策略

```
原语声明
   ↓ Compiler 查 Backend.capabilities
   ├─ supported: true    → 正常编译，调用后端实现
   ├─ supported: false
   │     ↓ 查 @conditional 声明
   │     ├─ 有 fallback    → 编译为降级路径
   │     └─ 无 fallback
   │           ↓ 是否 required?
   │           ├─ required: true  → 编译错误（阻断）
   │           └─ required: false → 编译警告 + no-op
   └─ unknown（后端未声明）→ 视为 supported（向前兼容）
```

---

## 2. 声明语法

### 2.1 组件级 `@conditional`

```vue
<p-camera v-conditional:fallback="<p-button @click='chooseFromFile'>选择图片</p-button>">
  <p-button @click="capture">拍照</p-button>
</p-camera>
```

- Backend 支持相机 → 渲染 `<p-camera>` + 拍照按钮
- Backend 不支持 → 渲染 `fallback`（从相册选图，走 `useCamera` 的 photo 模式）

### 2.2 API 级 `required`

```ts
const { capture } = useCamera({
  required: ['photo'],        // photo 模式必须，缺失则编译报错
  fallback: { video: 'photo' } // video 不支持 → 降级为 photo
})

// 调用
const result = await capture({ mode: 'photo' })
if (result.isErr()) {
  // 降级：UI 层处理（如隐藏入口）
}
```

### 2.3 全局 `defineCapability()`（G-30 复用）

```ts
// app.config.ts
defineCapability({
  camera: { supported: true, reason: null },
  nfc: { supported: false, reason: 'iOS 13+ required', fallback: 'qr-code' },
  bluetooth: { supported: true, requiresPermission: 'bluetooth' }
})
```

Compiler 全局可见，无需逐文件声明。

---

## 3. Tier 覆盖矩阵（G-30 Platform = (R, C, J)）

| 原语类别 | Tier 1 (R+C+J) | Tier 2 (缺 C/J) | Tier 3 (仅 R) | Tier 4 (仅 J) |
|---------|---------------|----------------|--------------|--------------|
| ① 布局（12） | ✅ 全支持 | ✅ 全支持 | ✅ 全支持（纯渲染） | ⚠️ 静态布局 |
| ② UI 基础（18） | ✅ | ✅ | ✅ | ⚠️ 无交互 |
| ② UI 媒体（p-media） | ✅ | 🔄 降级（无播放器） | 🔄 静态封面 | ❌ |
| ③ Shell（10） | ✅ | ✅（部分降级） | ⚠️ 无弹层动画 | ⚠️ SSR |
| ④ Gesture（10） | ✅ | 🔄 降级为 click | ❌ | ❌ |
| ⑤ Capability（50） | ✅ | 🔄 按能力降级 | ❌（无原生能力） | ❌ |
| ⑥ Engineering（28） | ✅ | ✅ | ✅ | ✅ |

**规律**：
- Tier 3（纯渲染，如 Flutter/Skia/VR）→ 仅支持 ①②④，⑤ 全部降级
- Tier 4（Headless，如 SSR/Agent）→ 仅 ① 静态 + ⑥，② 无交互、⑤ 走 L2 polyfill

---

## 4. 典型降级示例

### 4.1 `<p-virtual-list>` → 非虚拟化

```vue
<p-virtual-list :items="items" :item-size="'auto'">
  <template #default="{ item }">...</template>
</p-virtual-list>

<!-- Backend 不支持 virtualization（如 Web SSR）→ 编译为 -->
<p-stack>
  <template v-for="item in items">...</template>
</p-stack>
```

**行为差异**：数据量大时性能下降，但**功能完整**。开发者无感知。

### 4.2 `useLocation()` → IP 定位

```ts
const { getCurrent } = useLocation()
const coords = await getCurrent({ type: 'gcj02' })
// Tier 1: 返回真实 GPS
// Tier 2 (无 GPS): 返回 IP 定位（精度降低，但 API 不变）
// Tier 3 (无原生能力): 返回 Err → 业务 @conditional 隐藏地图入口
```

### 4.3 `useBluetooth()` → 无降级

```ts
const { scan } = useBluetooth({ required: true })  // 缺失 → 编译错误
// 或
const { scan } = useBluetooth()  // 缺失 → no-op + 警告
```

**决策权在业务**：`required: true` 表示「该能力是核心功能，缺失应阻断」；否则静默降级。

---

## 5. 与 G-30 conformance 复用

降级路径本身必须被 conformance 测试覆盖：

```ts
// test:component --backend web --tier 3
describe('p-virtual-list degradation', () => {
  it('renders as p-stack when virtualization unsupported', () => {
    const ir = compile('<p-virtual-list ... />')
    expect(ir.children[0].semantic).toBe('layout.stack')  // 降级为 stack
  })
})

// test:component --backend harmony --capability nfc=false
describe('useNFC fallback', () => {
  it('returns Err when nfc unsupported', async () => {
    const { read } = useNFC()
    const result = await read()
    expect(result.isErr()).toBe(true)
  })
})
```

> **原则**：降级不是「事后补救」，而是**IR 层的正式分支**，有 schema、有测试、有覆盖率。

---

## 6. 铁律关联

- **G-30.3**：能力缺失必须显式声明（capabilities 字段），禁止「运行时 undefined」
- **G-32.5**：属性为约束 → 降级时约束语义保持不变（如 `p-grid min-col-width` 降级为 `p-stack wrap`，仍保证「每列不小于 N」）
- **CMP006**（G-31）：属性冲突编译期报错 → 降级不改变此规则

---

## 7. 开发者体验

**目标**：开发者写一份代码，在任何 Tier 的 Backend 上都能跑（功能完整度可能降级，但**不断链**）。

```vue
<!-- 同一份代码 -->
<template>
  <p-button @click="scan">{{ t('scan') }}</p-button>
</template>

<script setup>
const { scanQR } = useQRCode()
const scan = async () => {
  const result = await scanQR()
  if (result.isOk()) {
    // 处理扫码结果
  } else {
    // 降级：弹出手动输入框
  }
}
</script>
```

| Backend | 行为 |
|---------|------|
| iOS/Android | 原生扫码 |
| Web（HTTPS） | WebRTC 摄像头 |
| Web（HTTP/无摄像头） | 手动输入 |
| SSR | 渲染按钮，点击提示「请在客户端打开」 |

**业务代码零修改** —— 这正是「99% 零原生」的降级保障机制。
