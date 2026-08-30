# 16 - progress 组件 Skyline 降级（Skyline 官方不支持 progress）

> 状态：规划（2026-08 真机实测触发）
> 关联：Skyline 基础组件支持表——`progress | 暂不考虑`

## 一、问题（真机实测）

- 小程序语义 `<progress percent="70" show-info>` 在 **Skyline 下不渲染**（官方组件支持表：progress 暂不考虑）
- WebView 模式原生 progress 正常；Web 端 proteus-progress 模拟正常
- **双端不一致 + Skyline 功能缺失**

## 二、方案：编译器降级为自定义 view 进度条

`<progress>` 标签（MP 编译）→ 自定义 view 结构（双端一致 + Skyline 可用）：

```
源码：<progress :percent="70" show-info stroke-width="6" active-color="#07c160" />
产物：<view class="proteus-progress">
        <view class="proteus-progress-track">
          <view class="proteus-progress-inner" style="width:{{percent}}%"></view>
        </view>
        <text wx:if="{{__showInfo}}" class="proteus-progress-info">{{percent}}%</text>
      </view>
```

### 属性映射

| progress 属性 | 降级产物 |
|---|---|
| percent | inner 宽度 `{{percent}}%`（0-100 钳制） |
| active-color / color | inner background-color |
| stroke-width | track/inner 高度（px→rpx） |
| show-info（无值=真） | wx:if 显示百分比 text（编译期布尔归一：无值→true 常量） |
| 其他（border-radius 等） | 忽略 + 警告 |

### 样式注入

BASE_SEMANTIC_WXSS 加 `.proteus-progress` 体系（track 灰底/inner 绿填充/info 文字），scoped 后缀联动。

## 三、影响面

| 位置 | 改动 |
|---|---|
| `packages/compiler/src/template.ts` | progress 标签分支：解析属性 → 生成 view 结构（percent 插值、布尔 show-info 归一） |
| `packages/compiler/src/style.ts` | BASE 加 .proteus-progress 样式 |
| 注册表 | `component/progress-degrade` 规则（AI 说明书） |
| Web 端 | 保持 proteus-progress 模拟（不改） |
| 测试 | progress 降级产物断言 + golden |

## 四、风险

- **原生 progress 放弃**（WebView 也用降级结构）——双端一致优先（Skyline 必须）
- 布尔属性 show-info 无值语义：编译期归一（`wx:if="{{true}}"`）
- Web 端 progress 已对齐（70% + info 渲染，show-info kebab 键修复）

## 五、验收

- [ ] Skyline 下 `<progress>` 正常渲染（自定义进度条）
- [ ] percent/color/stroke-width/show-info 属性生效
- [ ] WebView/Web 端一致
- [ ] 717+ 测试全绿
