# 13 明确不做项 & 迁移路径

## 明确不做（主干）

| 项目 | 原因 | 替代方案 |
|------|------|---------|
| **国内 ROM 私有玻璃**（小米/OPPO/vivo 控制中心特效） | 系统特权，App 调不到；私有 API 不稳定 | 留 `GlassExtension` 扩展口 |
| **像素级三端统一** | Web/Skyline 无系统 API，不可行 | L1 统一 + L2/L3 尽力 |
| **跨版本系统 API 兼容保证** | 系统 API 随时废弃 | 版本守门 + 回退链 |
| **Flutter / React Native 端** | 超出 Proteus 范围 | 未来扩展（见 Roadmap） |

## 边界说明

**Proteus 保证**：
- L1 基础玻璃在 5 端一致可用
- 统一声明式 API（`<pg-glass>`）
- 自动降级不崩溃
- 无障碍支持

**Proteus 不保证**：
- 各端视觉 100% 相同（系统材质差异不可消除）
- 低端机 60fps（只能降级）
- 国内 ROM 系统级特效

## 迁移路径

### 从 uni-app / Taro 迁移

```vue
<!-- 迁移前：CSS 裸写 -->
<view class="glass-box"/>

<!-- 迁移后：pg-glass -->
<pg-glass preset="card"/>
```

`proteus migrate` 自动扫描 `backdrop-filter` / `filter: blur` → 建议替换为 `<pg-glass>`。

### 从原生玻璃迁移

- iOS `UIVisualEffectView` → `<pg-glass intensity="regular">`
- 鸿蒙 `backdropBlur` → `<pg-glass>`
- Android `RenderEffect` → `<pg-glass>`

保留降级链，迁移无风险。

## Roadmap（未来）

| 版本 | 内容 |
|------|------|
| v1.0 | L1 三端 + preset + 降级 + audit（本 plan） |
| v1.1 | iOS UIGlassEffect L3 完善 |
| v1.2 | 鸿蒙 NEXT fractal 深耕 |
| v2.0 | 动态玻璃（手势/滚动联动） |
| v2.x | 可选国内 ROM 扩展（社区维护） |

## 与架构规约对齐

- 铁律 #6（第三方类型复用）：不重复造系统类型
- 铁律 #9（跨层一致性）：`GlassProps` / `GlassLevel` 收口 `contracts.ts`
- G-29 之后执行，不阻塞地基（M1 纯逻辑可随 G-01 提前启动）

---
至此，Proteus Glass 落地文档完整闭环。
