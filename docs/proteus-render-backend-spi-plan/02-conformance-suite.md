# G-37 Conformance 测试套件

> **目的**：定义 Backend 必须满足的测试集。跑通 = "Proteus Compatible"，跑不通 = 不得宣称兼容。

---

## 一、测试分类总览

| 类别 | 测试数 | 说明 |
|------|--------|------|
| C-01 节点操作 | 8 | create / update / delete / insert / remove / clear |
| C-02 属性样式 | 5 | setAttribute / removeAttribute / setStyle |
| C-03 文本 | 2 | setText / 空文本 |
| C-04 布局 | 4 | applyLayout（如声明）/ setStyle 约束解析 |
| C-05 手势 | 6 | 8 种手势的 bind / unbind / 映射 |
| C-06 生命周期 | 5 | initialize / attach / dispose / 状态转换 |
| C-07 降级 | 4 | degradation 三态 / StubBackend |
| C-08 差分 | 3 | IRDiff 全部指令类型 |
| C-09 线程安全 | 2 | 同步 / 回调死锁检测 |
| C-10 性能 | 3 | 首帧 / 增量 / 内存 |
| **合计** | **42** | **必须全部 PASS** |

---

## 二、测试用例详情

### C-01 节点操作（8）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-01-1 | 创建 layout.box 节点 | createNode 返回有效 NodeHandle |
| C-01-2 | 创建嵌套树（3 层） | 父子关系正确建立 |
| C-01-3 | 更新节点属性 | updateNode 应用 IRDiff |
| C-01-4 | 删除叶子节点 | deleteNode 后节点不可访问 |
| C-01-5 | 插入子节点到指定索引 | insertChild 位置正确 |
| C-01-6 | 移除中间子节点 | removeChild 后索引连续 |
| C-01-7 | 清空所有子节点 | clearChildren 后子节点数 = 0 |
| C-01-8 | 创建未知 semantic | 返回占位节点（不抛错） |

### C-02 属性样式（5）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-02-1 | setAttribute 基本类型 | string / number / boolean 正确应用 |
| C-02-2 | setAttribute 对象类型 | Record / Array 正确序列化 |
| C-02-3 | removeAttribute | 属性被移除（恢复默认值） |
| C-02-4 | setStyle 布局约束 | columns / direction / gap 生效 |
| C-02-5 | setStyle 视觉属性 | opacity / backgroundColor / borderRadius 生效 |

### C-03 文本（2）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-03-1 | setText 正常文本 | 文本内容正确显示 |
| C-03-2 | setText 空字符串 | 不崩溃，渲染为空 |

### C-04 布局（4）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-04-1 | applyLayout（framework 模式） | LayoutConstraintIR 的帧被正确应用 |
| C-04-2 | setStyle 约束解析（backend 模式） | columns / minWidth 触发正确布局 |
| C-04-3 | 布局边界（0 / 负数 / 极大值） | 不崩溃，合理裁剪 |
| C-04-4 | 嵌套布局 | 父约束正确传递给子节点 |

### C-05 手势（6）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-05-1 | bindGesture tap | 原生 tap → 语义 'tap' |
| C-05-2 | bindGesture longpress | 延迟判定正确 |
| C-05-3 | bindGesture pan | 方向 / 距离阈值正确 |
| C-05-4 | bindGesture pinch | 缩放比例正确 |
| C-05-5 | unbindGesture | 解绑后不再触发 |
| C-05-6 | 不支持的手势 | 返回 no-op binding（不抛错） |

### C-06 生命周期（5）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-06-1 | initialize 成功 | 状态 → Attached |
| C-06-2 | initialize 失败 | 自动重试 + 降级 StubBackend |
| C-06-3 | attachToHost | 根节点挂载到宿主 |
| C-06-4 | dispose 释放资源 | 手势解绑 / 节点销毁 / 管线释放 |
| C-06-5 | dispose 后调用方法 | 抛错（不崩溃进程） |

### C-07 降级（4）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-07-1 | degradation = 'unsupported' | 渲染占位节点 |
| C-07-2 | degradation = 'fallback' | 渲染降级实现 |
| C-07-3 | degradation = 'stub' | 渲染最小占位 |
| C-07-4 | StubBackend 全方法 no-op | 不崩溃 |

### C-08 差分（3）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-08-1 | IRDiff 全部 7 种类型 | 每种都被正确处理 |
| C-08-2 | 批量差分（100 条） | 原子性（全部成功或全部回滚） |
| C-08-3 | 差分顺序敏感性 | 相同结果无论顺序 |

### C-09 线程安全（2）

| ID | 测试 | 验证点 |
|----|------|--------|
| C-09-1 | 同步调用 | 单线程顺序执行无竞态 |
| C-09-2 | 回调死锁检测 | Backend 回调 JS 时不持有 UI 锁 |

### C-10 性能（3）

| ID | 测试 | 阈值 |
|----|------|------|
| C-10-1 | 首帧耗时 | ≤ 16ms（旗舰）/ 33ms（低端） |
| C-10-2 | 增量更新（100 节点） | ≤ 8ms |
| C-10-3 | 内存峰值（1000 节点） | ≤ 50MB |

---

## 三、运行方式

### 3.1 CLI

```bash
# 运行全部测试
proteus conformance --backend ./my-backend.js

# 运行指定类别
proteus conformance --backend ./my-backend.js --category C-05

# 详细输出
proteus conformance --backend ./my-backend.js --verbose

# 生成报告
proteus conformance --backend ./my-backend.js --report ./conformance-report.json
```

### 3.2 输出格式

```json
{
  "backend": "my-engine",
  "version": "1.0.0",
  "timestamp": "2026-09-02T10:30:00Z",
  "results": {
    "C-01": { "total": 8, "passed": 8, "failed": 0 },
    "C-05": { "total": 6, "passed": 5, "failed": 1, "failures": [
      { "id": "C-05-4", "message": "pinch 缩放比例偏差 > 5%" }
    ]},
    "C-10": { "total": 3, "passed": 2, "failed": 1, "failures": [
      { "id": "C-10-1", "message": "首帧 23ms > 16ms" }
    ]}
  },
  "summary": {
    "total": 42,
    "passed": 40,
    "failed": 2,
    "skipped": 0,
    "passRate": "95.2%",
    "compatible": false
  }
}
```

### 3.3 准入判定

```
compatible = (failed === 0) && (capabilities 声明的能力全部通过)
```

**注意**：`capabilities` 声明 `false` 的能力 → 对应测试自动 `skipped`，不算失败。

---

## 四、跳过规则（Skip Rules）

| 条件 | 跳过类别 | 说明 |
|------|---------|------|
| `layoutMode === 'backend'` | C-04-1 | 后端自己算布局，不测试 applyLayout |
| `layoutMode === 'framework'` | C-04-2 | 框架算布局，不测试约束解析 |
| `supports['gesture.X'] === false` | C-05-X | 未声明手势跳过 |
| `capabilities.hotReload === false` | C-06-6（如有） | 不支持热重载跳过 |
| `tier >= 3` | C-10 | Tier 3/4 放宽性能要求 |

---

## 五、与现有测试框架集成

### 5.1 Vitest / Jest

```typescript
// conformance.test.ts
import { runConformance } from '@proteus-vue/conformance'
import MyBackend from './my-backend'

describe('Conformance', () => {
  it('passes all tests', async () => {
    const report = await runConformance(new MyBackend())
    expect(report.summary.failed).toBe(0)
    expect(report.summary.compatible).toBe(true)
  })
})
```

### 5.2 CI Gate

```yaml
# .github/workflows/conformance.yml
- name: Run Conformance
  run: proteus conformance --backend ./packages/my-backend
  # 退出码非 0 → CI 失败
```

---

## 六、参考实现（terminal Backend）

`terminal` Backend 用 ASCII 字符渲染 UI，用于 conformance 测试和文档示例：

```typescript
class TerminalBackend implements ProteusRenderBackend {
  // ... 实现全部接口方法
  // createNode → 输出 "[Button: label]"
  // setStyle → 调整间距 / 对齐
  // bindGesture → 监听 stdin 按键
}
```

**用途**：
- conformance 测试（不依赖图形环境）
- CI 验证（headless）
- 文档示例
- 新人学习参考

---

> **Related**：01-render-backend-spi.md（主文档 §10）· 03-implementation-guide.md（Step 5）· rules.md（G-37.5）
