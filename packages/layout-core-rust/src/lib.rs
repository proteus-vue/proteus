// packages/layout-core-rust/src/lib.rs
// ★★L1 排版布局核心（App 端高性能渲染）—— Rust 实现，三端共享（Android JNI / iOS ObjC++ / 鸿蒙 NAPI）。
//
// 定位（方案 §1 架构分层的 L1）：Vue SFC → L0 编译器 → 语义 IR
//   → **本层**（节点树 / Flexbox·Grid 布局 / 文本度量 / 拍平 / 复用池）
//   → 绘制指令流 → L2 平台绘制层（Android Canvas / iOS CALayer / 鸿蒙 ArkUI）
//
// ★为什么是 Rust + Taffy（DCP-1 定案，2026-09-29）：
//   · Grid：Yoga 的 `YGDisplay` 枚举 = {Flex, None, Contents}，编译期就没有 Grid
//   · 与 `proteus-cc-rust` 同栈 ⇒ 编译器产物到布局核心**零 FFI**
//   · 上游活跃（Yoga 处维护模式，演进绑 RN 需求）
//   · ★版本锁 0.14：0.13 在「深链 + auto 尺寸容器」下 measure 呈 3×2^d−2 指数爆炸（spike 实测）
//   决策文档：docs/proteus-performance-plan/11-dcp1-layout-engine.md
//
// ★模块划分对齐方案 §5.1（本 crate 当前落地 node/ layout/ text/ dirty/ 四块）：
//   · `style` / `node`  → `node/`（扁平节点树）
//   · `engine`          → `layout/`（**抽象边界**：引擎原生 API 不得泄漏）
//   · `taffy_engine`    → `layout/` 的实现（唯一允许出现 taffy:: 的文件）
//   · `ffi`             → **C ABI 边界**（三端共享：iOS ObjC++ / Android JNI / 鸿蒙 NAPI）
//   · `blob`            → **二进制扁平化产物**（M0 计划项；实测证实的硬需求，见模块头注释）
//   · `recycle`         → **列表复用池 + 生命周期状态机**（§12.6 三档 + 方向敏感预加载区）
//   · `hit`             → **命中测试**（逆绘制序 + 裁剪感知；事件系统的几何地基）
//   · `conformance`     → 以**浏览器 golden** 为准的对拍（tests/ 侧消费）
//   · `ops`             → **更新指令流解码**（Vapor IR V1：与 TS 侧 slot-runtime 逐字节对齐）
//   · `ops_apply`       → **指令的布局应用**（Vapor IR V3：指令 → 树变更 → 多范围增量重排）
//   · `rects_bin`       → **变化集二进制返回通道**（V4：回程免 JSON 解析——V3 类B 的最大单项）
//   · `snap`            → **坐标吸附**（卡 I2：舍入时机统一——内核唯一实现，平台层零舍入）
//   · `anim`            → **指令驱动动画**（RT0：曲线查表 + tick，曲线求值不经 JS）
//
// ★尚未落地（诚实边界，后续里程碑）：`flatten/` `materialize/` `paint-hint/` `recycle/` `render/`
pub mod blob;
pub mod engine;
pub mod ffi;
pub mod hit;
pub mod ops;
pub mod ops_apply;
pub mod rects_bin;
pub mod snap;
// ★★C2（2026-10-01）：SVG 路径解析 + 弧长（**单一实现**——宿主不做第二份解析器）
pub mod svg_path;
// ★RT0（2026-09-30）：指令驱动动画的求值引擎（曲线查表 + tick；见文件头）
pub mod anim;
// ★HA2（2026-09-30）：`pub mod jni;` 已移出 —— JNI 绑定是**平台适配**，
//   搬到了 `platform/android/proteus-jni/`。内核从此**零平台分支**（本文件不再有 `cfg(target_os)`），
//   判据见 `scripts/check-platform-layering.mjs` 的 D 组（内核不得出现 `target_os`）。
pub mod node;
pub mod recycle;
pub mod style;
pub mod taffy_engine;

pub use engine::{
    AvailableSpace, LayoutEngine, LayoutOutput, NullTextMeasurer, RootConstraint, TableTextMeasurer, TextMeasurer,
};
pub use node::{LNode, LayoutTree, NodeIndex, TextMeasureRequest, NO_PARENT};
pub use style::{Display, Edges, FlexDirection, FlexWrap, LStyle, MarginAuto, Overflow, Position, Rect, Size};
pub use taffy_engine::TaffyEngine;

// ★M3 `hit/`：命中测试（逆绘制序 + 裁剪感知——事件系统的几何地基）
pub use hit::{
    bubble_chain, geometry, geometry_snapped, hit_path, hit_path_with, hit_result, hit_result_with, hit_test,
    paint_order, rect_contains, HitResult, NodeGeometry,
};

// ★卡 I2 `snap/`：坐标吸附（内核唯一实现——平台层不得再舍入）
pub use snap::{snap_coord, snap_rect};

// ★M3 `recycle/`：列表复用池 + 生命周期状态机（§5.1 / §12.6）
pub use recycle::{Lifecycle, ListStateMachine, ListWindow, RecycleConfig, RecyclePool, ScrollDirection, VisibleRange};

// ★HA2：原来的三处 `#[cfg(target_os = "android")] pub(crate) use …`（供 jni.rs 引用）已删除。
//   它们的存在理由只有一个——JNI 层住在同 crate 里 + `pub(crate)` 不可跨 crate。
//   JNI 层搬走后：① 内核再无平台分支；② 被平台层需要的三个诊断入口（`json_str` /
//   `run_bench` / `run_conformance`）在 `ffi` 模块里改为 `pub`（诚实公开，而不是"靠 cfg 转出"）。
