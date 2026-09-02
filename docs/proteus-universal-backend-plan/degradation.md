# Degradation: 降级原语与编译期裁剪

> 配套 G-30 B4，给开发者的"端差异处理"工具。

---

## 1. 问题

不同端能力不同（车机无相机、Web 无蓝牙、小程序无 NFC）。传统框架让开发者手写 `#ifdef`，Proteus 提供**语义级降级原语**。

---

## 2. `@conditional` 组件

```vue
<p-conditional
  capability="scanQR"
  :fallback="manualInput"
>
  <template #default>
    <p-button @click="scan">扫码</p-button>
  </template>
  <template #fallback>
    <p-input v-model="code" placeholder="请手动输入" />
  </template>
</p-conditional>
```

**Compiler 行为**：

```
目标端 scanQR.supported === true  →  渲染 #default
目标端 scanQR.supported === false →  渲染 #fallback
                                     （无需开发者手写 ifdef）
```

---

## 3. 命令式降级：`defineCapability`

```ts
// 某端缺 scanQR，业务自己提供降级实现
defineCapability('scanQR', async () => {
  // 例如：打开一个输入弹窗
  return { text: await showManualInput() }
})
```

**优先级**：`backend.config.ts` 声明 > `defineCapability` > 编译期报错。

---

## 4. 编译期裁剪（Tier-aware）

```ts
// 代码
await native.scanQR()

// 目标：车机（capabilities: scanQR: false, no fallback）
// Compiler 报错：
//
//  [Proteus] `scanQR` unsupported on "car-infotainment".
//  解决方式：
//    1. 用 <p-conditional capability="scanQR"> 提供 fallback UI
//    2. defineCapability('scanQR', ...) 提供自定义实现
//    3. 移除该能力依赖
```

**关键**：错误在**编译期、语义层**，不在运行时。开发者不需要等到车机真机测试才发现崩了。

---

## 5. 多端构建矩阵

```ts
// app.config.ts
export default defineAppConfig({
  targets: [
    { name: 'ios',      backend: 'native' },
    { name: 'android',  backend: 'native' },
    { name: 'web',      backend: 'vue-dom' },
    { name: 'car',      backend: 'native', tier: 2 },  // 受限
    { name: 'headless', backend: 'headless', tier: 4 }, // SSR/Agent
  ]
})
```

`proteus build` 对每个 target 独立编译 → 各自裁剪 → 产出对应包。

---

## 6. 降级测试

每个 Backend 包需包含：

```bash
# 模拟"该端缺失某能力"场景，验证降级路径
pnpm test:degradation --capability=scanQR --mode=unsupported
  ✓ @conditional 渲染 #fallback
  ✓ defineCapability 生效
  ✓ 无 defineCapability 时编译期报错
```

---

## 7. 设计原则

> **端差异不可消除，但可以收敛到语义层。**
>
> Proteus 不承诺"每端体验一模一样"——那是不可能的。
> 它承诺的是：**差异在编译期可见、可处理、可测试，而不是在运行时爆炸。**
