# entry/src/main/cpp/CMakeLists.txt
# Proteus 鸿蒙宿主 —— 原生渲染模块（RenderNode 直绘）
#
# 【为什么是 native】方案 §2.2 路径 B：**RenderNode（API 20+）直绘**——绕过 ArkUI 的
#   measure/layout，把 Proteus 指令流直接建成渲染节点树。这就是"不自绘"路线下
#   性能收益的核心落点（本机设备 API 26，满足）。
#
# 【构建】由 hvigor 自动调用（entry/build-profile.json5 的 externalNativeOptions）；
#   工具链与 sysroot 由 DevEco SDK 注入（OHOS_SDK_NATIVE），此处无需手写路径。
cmake_minimum_required(VERSION 3.5.0)
project(proteus_render)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})

include_directories(${NATIVERENDER_ROOT_PATH})

add_library(proteus_render SHARED proteus_render.cpp)

# libace_napi.z.so  : NAPI 桥（ArkTS ↔ C++）
# libace_ndk.z.so   : ArkUI NDK（NodeContent / NativeNodeAPI / RenderNode）
# libhilog_ndk.z.so : 日志（宿主主动上报——本仓零盲等纪律的落点）
target_link_libraries(proteus_render PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
