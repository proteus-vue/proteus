# 三维断点测试 —— G-25 自动化验证

> 配套：`G-44-testing-framework.md` §5

---

## 1. 为什么需要专门测试

G-25 的 **W × H × F** 是框架差异化核心，但此前**只有文档断言，没有一行自动化验证**：

- `resolveProfile(W,H,F)` 的返回值未断言
- TV 焦点、手表表冠、车机语音**无测试用例**
- 组合空间 100 profiles，手写不可维护 → **必须参数化生成**

---

## 2. 等价类裁剪

全组合 5×4×5 = 100，采用**等价类 + 边界值**裁剪到可管理规模：

| 维度 | 取值策略 |
|------|---------|
| W | 各断点边界 ±1（319/320/321, 599/600/601 ...） |
| H | 各断点边界 ±1 |
| F | **全取**（5 种，每种语义不同，不可裁剪） |

实际用例 ≈ 边界 profiles × 5 F + 代表性组合，**覆盖语义分支而非穷举**。

---

## 3. 参数化生成

```ts
function generateBreakpointSuite(): TestIR[] {
  const profiles = cartesian(W_BREAK, H_BREAK, F_FORMS)
  return profiles.flatMap(([w, h, f]) => [
    profileCase(w, h, f),      // resolveProfile 正确性
    adaptiveFormCase(w, h, f), // <p-adaptive> 形态
    inputModeCase(w, h, f),    // 输入模式开关
  ])
}
```

**一份生成逻辑 → 100+ Test IR → 每个 Backend 各跑一遍**。

---

## 4. 断言矩阵

| Profile 特征 | 断言 |
|-------------|------|
| F = remote (TV) | 焦点引擎可用；touch 事件被禁用；dpad 导航有效 |
| F = dial (watch) | 单列布局；并发症区域存在；表冠可滚动 |
| F = voice (车机) | driving-safe 降级；TTS 可触发；大热区 |
| F = cursor (PC) | hover 态有效；键盘可导航 |
| F = touch | 基础触控；无 hover 依赖 |
| W 跨断点 | sheet→dialog→popover 形态切换（G-22.5） |
| H 方形 (手表) | p-grid 退化为单列 |

---

## 5. 跨设备所有权转移（鸿蒙 × G-43）

```ts
{
  act: [
    { op: 'transfer', resource: 'buffer1', to: 'deviceB' }
  ],
  assert: [
    { kind: 'eq', path: '$.ownership.deviceA.buffer1', value: null },
    { kind: 'exists', path: '$.ownership.deviceB.buffer1' }
  ],
  profile: { w: 1920, h: 1080, f: 'cursor' }  // 软总线 mock
}
```

**软总线用同进程多"设备" mock，验证转移语义（Move）的原子性**：失败则源端保留所有权。

---

## 6. 期望通过标准

| 项 | 标准 |
|----|------|
| resolveProfile | 100% 正确 |
| 形态切换 | 边界值全部正确 |
| TV / 手表 / 车机专项 | **专用模拟器下 100%** |
| 跨 Backend 一致性 | NodeBackend 与 DeviceBackend 结果一致 |

---

*用例由 `testing-reference.js` 的 `generateBreakpointSuite()` 产出并执行。*
