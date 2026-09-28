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
//
// ★尚未落地（诚实边界，后续里程碑）：`flatten/` `materialize/` `paint-hint/` `recycle/` `render/`
pub mod blob;
pub mod engine;
pub mod ffi;
pub mod hit;
pub mod ops;
#[cfg(target_os = "android")]
pub mod jni;
pub mod node;
pub mod recycle;
pub mod style;
pub mod taffy_engine;

pub use engine::{
    AvailableSpace, LayoutEngine, LayoutOutput, NullTextMeasurer, RootConstraint, TableTextMeasurer, TextMeasurer,
};
pub use node::{LNode, LayoutTree, NodeIndex, TextMeasureRequest, NO_PARENT};
pub use style::{Display, Edges, FlexDirection, LStyle, Overflow, Position, Rect, Size};
pub use taffy_engine::TaffyEngine;

// ★M3 `hit/`：命中测试（逆绘制序 + 裁剪感知——事件系统的几何地基）
pub use hit::{bubble_chain, geometry, hit_path, hit_result, hit_test, paint_order, rect_contains, HitResult, NodeGeometry};

// ★M3 `recycle/`：列表复用池 + 生命周期状态机（§5.1 / §12.6）
pub use recycle::{Lifecycle, ListStateMachine, ListWindow, RecycleConfig, RecyclePool, ScrollDirection, VisibleRange};

// ★crate 根转出（供 jni.rs 以 `crate::xxx` 引用，避免两处逻辑分叉）
//   ★仅在 Android 目标下转出：非 Android 时无人引用 → 会产生 unused_imports 警告
#[cfg(target_os = "android")]
pub(crate) use ffi::into_java_string;
#[cfg(target_os = "android")]
pub(crate) use ffi::{json_str, run_bench, run_conformance};
