# 车机适配（Vehicle）

> 依赖：G-09（Safe Area）/ G-22.5（p-adaptive）/ G-25（三维断点）
> 目标：**把车机系统级能力（CarPlay / Android Auto）收敛为 `p-vehicle-*` 语义**

---

## 1. 车机的独特性

车机不是"大号手机"。它的约束是**结构性**的：

| 约束 | 数值 / 规范 |
|------|-------------|
| 驾驶安全 | 行驶中禁止复杂交互（车规强制） |
| 远距观看 | 最小点击目标 **88pt**（Apple CarPlay） |
| 横屏矮屏 | 常见 1280×480 ~ 1920×720 |
| 多输入 | 触摸 + 鼠标 + 语音（"嘿 Siri" / "小艺导航"） |
| 分组导航 | 一次只展示一组内容，减少认知负荷 |

**宽度断点（xl）无法表达这些 → 必须靠 F=driving + 专属原语。**

---

## 2. 核心原语

### 2.1 `<p-modal>` + `driving-safe`

```vue
<p-modal
  v-model:visible="show"
  :driving-safe="true"
  p-adaptive="confirmation(∞,∞,driving) | sheet(0,600,touch)"
>
  <p-button @click="confirm">确认导航</p-button>
</p-modal>
```

| `driving-safe` | 车速 > 0 时行为 |
|-----------------|-----------------|
| `true` | 正常可用（确认/取消类简单操作） |
| `false` | **自动禁用 + 遮罩提示"请在停车后操作"** |

**铁律 G-25.1**：所有车机交互必须声明 `driving-safe`，未声明默认 `false`。

### 2.2 `<p-vehicle-group>` 分组懒聚焦

```vue
<p-vehicle-group :lazy="true">
  <p-vehicle-panel title="导航">
    <p-button>回家</p-button>
    <p-button>公司</p-button>
  </p-vehicle-panel>
  <p-vehicle-panel title="音乐">
    <p-button>下一首</p-button>
  </p-vehicle-panel>
  <p-vehicle-panel title="空调">
    <p-slider v-model="temp" />
  </p-vehicle-panel>
</p-vehicle-group>
```

- `:lazy="true"` → 一次只渲染一个 panel，降低视觉复杂度
- 映射车机模板系统的"模板切换"语义

### 2.3 `<p-vehicle-template>` 模板语义

对应 Apple CarPlay 的 `CPTemplate` 层级：

| Proteus 语义 | CarPlay | Android Auto |
|--------------|---------|--------------|
| `p-vehicle-tab` | `CPTabBarTemplate` | `TabTemplate` |
| `p-vehicle-list` | `CPListTemplate` | `ListTemplate` |
| `p-vehicle-grid` | `CPGridTemplate` | `GridTemplate` |
| `p-vehicle-nowplaying` | `CPNowPlayingTemplate` | `PaneTemplate` |

---

## 3. 驾驶模式检测

```ts
// 框架注入 driving 状态
const profile = useContainerProfile()
// profile.driving: boolean = 车速 > 0

// 业务侧按需响应
<p-watch :driving="profile.driving">
  <template #safe>简化版</template>
  <template #unsafe>完整版</template>
</p-watch>
```

**数据来源（各端原生）**：
- iOS CarPlay：`CPApplicationDelegate` + 车辆信号
- Android Auto：`CarAppService` + `OnRequestPermissionsListener`
- 鸿蒙车机：`@ohos.geolocation` / 车辆服务

---

## 4. Safe Area 协同（G-09）

车机屏幕常有**异形区域**（挖孔、状态栏、底部导航栏）：

```vue
<div p-safe="vehicle">
  <!-- 自动避让：顶部状态栏 / 底部系统栏 / 左右安全区 -->
</div>
```

| 端 | 安全区来源 |
|----|-----------|
| iOS CarPlay | `safeAreaInsets`（系统自动） |
| Android Auto | `WindowInsets` / `DisplayCutout` |
| 鸿蒙车机 | `window.getWindowAvoidArea` |

---

## 5. 语音导航（F=voice）

```vue
<p-nav-voice command="导航到{{destination}}" />
```

映射：
- iOS：`SiriKit` + `CPVoiceControlTemplate`
- 鸿蒙：`abilityStub` + 语音助手
- Android：`AssistantIntent`

---

## 6. 降级策略

| 场景 | 降级 |
|------|------|
| 非车机端使用 `p-vehicle-*` | 退化为普通 `p-stack` / `p-nav-tab` |
| 无法获取车速 | 默认 `driving=false`（保守，允许交互） |
| 无语音能力 | `<p-nav-voice>` 隐藏 |

---

## 7. 严格规则

| 规则 | 级别 | 说明 |
|------|------|------|
| **VEH001** | error | 车机交互须声明 `driving-safe`（铁律 G-25.1） |
| VEH002 | error | 车速 > 0 时禁止 `driving-safe=false` 交互 |
| VEH003 | warning | 车机点击目标不得小于 88pt |
| VEH004 | error | 禁止手动读车速 → 用 `useContainerProfile().driving` |

---

## 8. B2 落地要点

1. 定义 `VehicleProfile` + `driving` 状态采集（各端原生 API）
2. 实现 `<p-watch :driving>` 条件渲染
3. Compiler 注入 `driving-safe` 校验（VEH001/VEH002）
4. 车机模板映射（CarPlay CP*Template / Android Auto *Template）
5. 真机验收：CarPlay Simulator + Android Auto Desktop Head Unit

---

## 9. 小结

车机是柔性框架方法论的**压力测试**：
- 布局（W×H）→ `p-grid` / `p-fluid` 照常工作
- 形态（F=driving）→ `p-adaptive` 三维扩展
- 安全约束 → 铁律 G-25.1 + Compiler 强制
- 系统能力 → CarPlay / Android Auto 模板语义收敛

**这正是"把操作系统能力搬进框架"的又一次兑现。**
