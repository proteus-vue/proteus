# Proteus Semantic Primitives — G-24

> 打通**全部客户端开发**的语义原语全景方案：把操作系统能力收敛为统一 `p-*`，编译期映射到各端原生实现。

## 一句话

**传统跨端框架竞争"能不能渲染"；Proteus 竞争"能不能把系统能力无损搬进框架"。**

## 文档

| 文件 | 内容 |
|------|------|
| `01-semantic-primitives.md` | ★ 主文档：代际差 / 现有体系 / 六大家族 / 落地策略 |
| `02-primitive-families.md` | 语义地图：六大原语家族 + 分层判定 |
| `03-desktop-primitives.md` | 桌面交互原语（p-hover/p-shortcut/p-focus-trap 等） |
| `04-system-integration.md` | 系统集成映射（p-notify/p-permission/p-window 等） |
| `05-mapping-spec.md` | 映射规范 + Compiler Plugin 机制 |
| `06-integration-batches.md` | 跨 plan 协同 + B1-B4 分批 + 单测 |
| `architecture-update.md` | 规约：G-24 + 原则#10.8 + PRIM001-005 |

## 核心主张

- **原则 #10.8**：只有"有明确系统原生对应"的能力才进框架核心 `p-*`；否则归组件层/插件层 → 防膨胀
- **六大家族**：Input / Navigation / Data / System / Lifecycle / Device
- **首发 B1**：桌面交互原语（p-hover/p-context-menu/p-shortcut/p-focus-trap）——零依赖可单测

## 打包

```bash
bash pack.sh
```

生成 `proteus-semantic-primitives.zip` + `CHECKSUM.md`（SHA256）。

## 覆盖目标

```
手机 ✓ 平板 ✓ 折叠屏 ✓ 桌面(PC/Mac) ✓ 网页 ✓ 小程序(Skyline) ✓
车机/TV ◐ 手表 ◐（输入家族扩展即可）
```
