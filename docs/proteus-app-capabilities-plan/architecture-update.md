# Architecture 规约更新说明

## 新增执行位

- **G-27 Theme**（P1）
- **G-27 FontScale**（P1）
- **G-28 Cache**（P1）

## 新增全局铁律

### G-27（主题）
> 全局主题通过语义 token（`$theme`）声明，编译期生成静态样式表 + 运行时精确追踪。禁止硬编码色值（CSS016）、禁止业务层直接读 storage 判断主题。

### G-27（字体缩放）
> 字号通过语义单位（`rem`/`sp`/`var(--font-scale)`）声明，默认跟随系统，应用级覆盖需 clamp。禁止全局关闭缩放（accessibility anti-pattern）、禁止 px 做字号（除 1px 边框）。

### G-28（缓存）
> 缓存遵循 L0/L1/L2/L3 分层 + 字节预算 + 自动淘汰。禁止绕过分层直接操作存储（CACHE001）、禁止无版本前缀的 key。对接 Memory Plan 的 `Disposable` + `Budget` + `LeakRegistry`。

## 全景图更新

```
Layer 0  语义层 (Semantics)  ← 原则 #10 核心
         ├─ 布局语义 (p-flex / p-stack / p-grid)
         ├─ 视觉语义 (p-glass / p-shadow)
         ├─ 主题语义 (theme tokens)         ← 新增
         ├─ 字体语义 (font-scale)           ← 新增
         └─ 缓存语义 (cache layers)         ← 新增
Layer 1  IR 骨架 (Compiler)
Layer 2  Renderer (各端原生实现)
Layer 3  原生能力 (JSI/FFI)
```

## CSS 兼容矩阵新增档位

| 属性 | 档位 | 说明 |
|------|------|------|
| 硬编码色值 `#xxx` | ❌（CSS016） | 改用 `var(--color-*)` |
| `font-size: Npx` | ❌（FONT002） | 改用 `rem` / `var(--font-scale)` |
| `var(--color-*)` | ✅ 直映射 | 主题 token |
| `rem` / `calc()` | ✅ 直映射 | 字体缩放联动 |
| `prefers-color-scheme` | 🔶 仅 Web | 其他端用原生监听 |

## 对齐既有文档

- **原则 #10**：本方案是原则 #10 的最新应用（theme/scale/layer → 五端原生）
- **Memory Plan**：Cache 的 L0/L2 实现 `Disposable` + `Budget`
- **CSS Compat**：CSS016/017 + FONT/GACHE 规则
- **App Renderer**（附录 A）：iOS/Android/鸿蒙 binding 沿用 NS-Vue 借鉴点
- **Memorial/Skeleton**：纪念日灰度复用 Theme `dark` 档；缓存预暖对接 IFR/AOT
- **Glass**：主题色变更触发玻璃重绘
- **Safe Area**：字体缩放不影响灵动岛避让

## 影响范围

- 无破坏性改动（全部新增）
- 与 G-25（Memorial）/ G-26（Skeleton）同级，可并行
- 与 Performance（AOT/IFR）、Memory（Budget）强协同

## 验证

- 无新增跨层引用违规（scope 保持 `@proteus-vue/*`）
- 铁律 G-27/G-28 已加入 CI consistency 校验
