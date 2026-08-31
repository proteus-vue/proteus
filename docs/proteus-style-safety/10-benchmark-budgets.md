# 性能预算与真机验收矩阵

> 保证"安全"不以显著性能为代价。

---

## 1. 性能预算

| 指标 | 预算 | 目标实测 |
|------|------|---------|
| 单次 `validateStyle` | < 0.1ms | O(n) 属性数，n ≤ 10 |
| 首屏额外开销 | < 3% | 静态推导覆盖 > 80% |
| 滚动帧 | < 0.5ms | Worklet 隔离 |
| 静态推导覆盖率 | > 80% | 业务场景均值 |
| 运行时 Validator 调用占比 | < 20% | 理想 < 15% |

---

## 2. 真机五端验收矩阵

| 端 | 设备 | 验证项 | 通过标准 |
|----|------|-------|---------|
| iOS | iPhone 15 Pro (iOS 17) | 负数 width / NaN opacity | 降级正确，无 crash |
| iOS | iPhone 14 Pro (灵动岛) | p-safe-island + glass | 避让正确 |
| Android | Pixel 8 (API 34) | NaN TypedValue / Constraint | 降级正确，无 ANR |
| 鸿蒙 | Mate 60 (NEXT) | Length 越界 / Constraint | 降级正确 |
| Web | Chrome 120 | CSSOM 宽容 | 正常渲染 |
| Skyline | 微信 8.0.49+ | 有限数 / 布局参数 | 正常渲染 |

---

## 3. 基准测试场景

### 场景 A：静态样式（理想路径）

```vue
<style>
.card { width: 100px; opacity: 0.8; }
</style>
<div class="card" />
```

**预期：0 运行时开销**（编译期 100% 覆盖）。

### 场景 B：动态 `:style`（白名单属性）

```vue
<div :style="{ width: isLarge ? 200 : 100, opacity: v }" />
```

**预期：编译期推导，运行时 ≈0**（三元常量折叠）。

### 场景 C：API 动态值（运行时校验）

```vue
<div :style="{ width: apiData.width + 'px' }" />
```

**预期：Validator O(n)，< 0.1ms。**

### 场景 D：非法值注入（安全验证）

```vue
<div :style="{ width: undefined, opacity: 'abc', 'backdrop-filter': 'blur(10px)' }" />
```

**预期：全部拦截，降级正确，零 crash。**

---

## 4. CI 门禁

```yaml
# .github/workflows/style-safety.yml
- name: Style Safety Check
  run: |
    proteus compile --strict-style --style-report=report.json
    node scripts/check-style-report.mjs report.json
```

`check-style-report.mjs`：

```javascript
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const { stats } = report
if (stats.forbiddenProps > 0) {
  console.error('阻断：存在禁止属性')
  process.exit(1)
}
if (stats.staticCoverage < 0.8) {
  console.warn('警告：静态推导覆盖率 < 80%')
}
```

---

## 5. 对标竞品性能

| 框架 | 运行时校验开销 | 说明 |
|------|--------------|------|
| RN | 无（裸奔） | 0，但 crash 风险 |
| Flutter | 编译期 | 0，但自绘 |
| **Proteus** | < 3% | 原生 + 安全 |

→ **3% 开销换取"原生 + 生态 + 安全"三兼得，性价比极高。**

---

## 6. 内存验证

- Validator 对象短生命周期 → 页面销毁即释放
- 无原生引用持有 → 无 JSI 循环引用
- 对接 Memory Plan LeakRegistry，CI 检测泄漏

详见 `proteus-memory-plan` 08-leak-registry.md。
