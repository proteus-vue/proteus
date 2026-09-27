# iOS CALayer 路线（M4 起点）

方案 §6.2 规格：**宿主 UIView + CALayer 树（跳过 UIView），几何由排版核心驱动，绕开 AutoLayout**。

## 运行

```bash
bash hosts/ios/run-calayer-scene.sh          # 编译 + 部署 + 启动
bash hosts/ios/fetch-calayer-scene.sh        # 取回报告与截图（见脚本）
```

## 验证结果

**12/12 行通过，失败 0** —— 且用的是**与 Android 完全相同的核验脚本**（`hosts/android/screenshot-verify.py`）。

```bash
PYTHONPATH=.tools/py python3 hosts/android/screenshot-verify.py \
  hosts/ios/results/calayer-scene.json hosts/ios/results/calayer-scene.png
```

### ★为什么这件事值得单独记

| 端 | 渲染路径 |
|---|---|
| Android | 单宿主 ViewGroup + **Canvas 指令**（自绘） |
| **iOS（本轮）** | 宿主 UIView + **CALayer 树**（方案 §6.2：跳过 UIView） |

**两条完全不同的渲染路径，用同一个 Rust 核心 + 同一套场景规格 + 同一个核验脚本，都通过。**
这正是「一套语义多引擎」的可验证证据 —— 而不是文档里的承诺。

## 实现要点（对齐方案 §6.2）

| 规格 | 落实 |
|---|---|
| 宿主一个 UIView，内部管 CALayer 树 | `LayerHostView`：`layer.addSublayer(layerTree)`，节点直接 `layerTree.addSublayer(CALayer())` |
| **跳过 UIView** | 每行一个 `CALayer`（非 UIView），零 Responder Chain / 布局开销 |
| 布局用排版核心、绕开 AutoLayout | 几何全部来自 `proteus_layout_create` / `proteus_layout_rects`，**无一条约束** |
| 文本 `CATextLayer` | 已用 `CATextLayer`（含 `contentsScale`，不设会模糊） |
| 硬约束 1：layer tree 要扁平 | 本场景 12 个平铺 layer（配合 D4 拍平） |
| 硬约束 2：避免离屏渲染 | 显式不设 `cornerRadius+masksToBounds+shadow` 组合 |

## 三个实测坑

| # | 坑 | 正解 |
|---|---|---|
| 1 | **iOS 27 SDK 强制 UIScene 生命周期** | 不用 Scene → 应用 0.5s 后退出、Documents 为空、**无崩溃报告**（只能从 `log show` 看到 "UIScene life cycle is required"）→ `@main` + `configurationForConnecting` + SceneDelegate |
| 2 | **`devicectl` 无截图子命令**（`capture` 结构不明） | 改为 **app 内自截图**：`UIGraphicsImageRenderer` + `layer.render(in:)`（★必须 `layer.render`，`snapshotView` 不含 CALayer 子层） |
| 3 | 截图与 point 坐标不一致 | 用 `UIGraphicsImageRendererFormat.scale = 1.0` → 像素坐标与 point 坐标 1:1 |

## 破坏性验证

CALayer 位置偏移 7pt → **12 行全部检出**（边界区不符 + 自动给出 `dy=-12` 诊断）。
