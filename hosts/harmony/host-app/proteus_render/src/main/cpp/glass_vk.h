// hosts/harmony/host-app/proteus_render/src/main/cpp/glass_vk.h
// ★★★框架自研液态玻璃 —— **Vulkan 离屏渲染腿**（鸿蒙 · 决策 #841）。
//
// 【为什么是 Vulkan（路线修正）】此前（#838）误判"鸿蒙无自定义 GPU 着色器 API"⇒ 一度打算做 CPU 移植。
//   **真机取证推翻该前提**：鸿蒙 SDK 随装 `libvulkan.so` + 全量 `vulkan_ohos.h`，真机（Maleoon 920C）
//   实测 **Vulkan 1.3 + 计算/图形队列** ⇒ 鸿蒙腿 = **离屏 Vulkan 跑 naga 产出的 SPIR-V**（同一份 WGSL 单源）。
//   这比 CPU 移植更贴铁律"算法只在真源"（CPU 移植 = 第三份算法实现，会被 check:shader-capability 咬）。
//
// 【形态】本模块只做**落地**：编译生成物（SPIR-V）→ 建管线 → 设 uniform → 离屏渲染 → 读回 RGBA8。
//   算法 0 行（全在 SPIR-V，源自 glass.wgsl）。与 iOS `glass-metal.swift` 同定位（MTLDevice 离屏）。
//
// 【合规性】不用 XComponent（项目方案明令主路径禁 XComponent 自绘）——离屏渲染的结果作为**图像**由
//   既有 OH_Drawing 画布回贴（与自绘同路径）；Vulkan 只当"材质计算器"，占屏仍走 RenderNode/OH_Drawing。
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace proteus_glass_vk {

/** Vulkan 可用性（首次调用探测并缓存；不可用时 render 返回空 ⇒ 宿主降级为半透明面，不崩）。 */
bool available();

/** 可用性诊断串（JSON；探针上报用）。 */
std::string info();

/**
 * 离屏渲染一块玻璃（Vulkan 计算）。
 * @param backdrop 背景 RGBA8（行主序，左上原点），尺寸 texW×texH（= 盒尺寸 + 2*pad）。
 * @param texW,texH 背景尺寸。
 * @param outW,outH 输出（盒）尺寸。
 * @param u GlassUniforms 的 12 个字段按字节布局展开的原始 uniform 缓冲（80 字节；见 materials/mod.rs）。
 * @return outH×outW 行主序 RGBA8；失败返回空 vector。
 */
std::vector<uint8_t> renderRgba8(const std::vector<uint8_t>& backdrop, int texW, int texH,
                                 int outW, int outH, const std::vector<uint8_t>& uniform80);

/**
 * ★★★决策 #851：**批量渲染**（多玻璃合并一次提交 + 异步双缓冲回读）。
 *   每个 slot 由调用方给稳定 id（如 0/1…）；内部给每 slot 维护两套资源 + 双命令缓冲 + 双围栏。
 *   每次调用：① 若 parity 缓冲仍有未完成的上次提交 ⇒ 等待它（通常上一次提交早已在跑/完成）；
 *   ② 把本批所有 item 录进该缓冲、**一次提交**；③ **立即回读上一 parity 缓冲的 outStaging**
 *   （已完成）⇒ 无本帧同步等待（消除每节点同步等待）。
 * @return 与 items 等长；失败项为空 vector（首帧/尺寸变化时无上帧数据 ⇒ 返回空，调用方用上帧缓存兜底）。
 */
struct BatchItem {
    int id; std::vector<uint8_t> backdrop; int texW, texH, outW, outH; std::vector<uint8_t> uniform80;
    /** ★决策 #856：**可选的持久回读缓冲**。非空时，回读直接 resize+memcpy 进它（跨帧复用容量 ⇒
     *   零 alloc/零 free；否则每帧 new/free 一块 1.5MB 会触发 mmap/munmap 抖动，实测 ~26ms）。 */
    std::vector<uint8_t>* dst = nullptr;
    /** ★★★决策 #900：材质 id（宿主按此选管线；缺省 "glass"）。uniform80 的**有效长度**由材质定
     *   （glass=80B / 模糊族=64B）——超出部分的字节被本项 shader 忽略。 */
    const char* material = "glass";
};
std::vector<std::vector<uint8_t>> renderBatch(const std::vector<BatchItem>& items);

/** 释放某尺寸场景的批量资源（重建内容时调用；`id` 为用过的 slot id）。 */
void releaseBatch(const std::vector<int>& ids);

}  // namespace proteus_glass_vk
