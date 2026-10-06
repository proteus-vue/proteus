# proteus_render/src/main/cpp/CMakeLists.txt
# Proteus 鸿蒙渲染运行时——HAR 的 native 部分（项目无关：RenderNode 直绘 + NAPI 模块）
#
# 【关注点分层】见 hosts/README-LAYERS.md：本文件属 runtime（换一个 App 不用改）。
#   ★跨模块 native：HAR 携带 C++ 源 + CMake，由**消费方工程**在编译期构建并打入其 HAP
#     （hvigor 标准机制；`PACKAGE_FIND_FILE` 聚合各模块 native 依赖——见下方 include）。
cmake_minimum_required(VERSION 3.5.0)
project(proteus_render)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})

# ★hvigor 跨模块 native 聚合入口（HAR 惯例；缺它则消费方拿不到本模块 native 的 include/link 依赖）
if(DEFINED PACKAGE_FIND_FILE)
  include(${PACKAGE_FIND_FILE})
endif()

include_directories(${NATIVERENDER_ROOT_PATH})
# ★HA0.5：平台适配层（文本度量/字体——换壳不改；platform/harmony/proteus_text_platform.h）
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../platform/harmony/proteus-platform/src/main/cpp)

# ★Rust 排版核（runtime 属性——宿主桥用它建树/动画；由 hosts/harmony/build-rust-core.sh 交叉编译到此目录）
set(RUST_LIB ${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/libproteus_layout_core.a)
if(EXISTS ${RUST_LIB})
  add_library(proteus_rust_layout STATIC IMPORTED)
  set_target_properties(proteus_rust_layout PROPERTIES IMPORTED_LOCATION ${RUST_LIB})
  # ★INTERFACE：本 HAR 的消费方（entry/bench）也需内核符号 ⇒ 经 target 传递（避免各自再引一份路径）
  set_target_properties(proteus_rust_layout PROPERTIES INTERFACE_INCLUDE_DIRECTORIES ${NATIVERENDER_ROOT_PATH})
  message(STATUS "proteus: Rust 排版核已就位（HAR runtime）")
  set(HAVE_RUST_CORE TRUE)
else()
  message(WARNING "proteus: 缺 Rust 核 —— 宿主桥/基准不可用（先跑 hosts/harmony/build-rust-core.sh）")
  set(HAVE_RUST_CORE FALSE)
endif()

# 渲染模块（直绘）——NAPI 模块名 `proteus_render`（ArkTS 侧 import 'libproteus_render.so'）
add_library(proteus_render SHARED proteus_render.cpp)
target_link_libraries(proteus_render PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
# ★文本上屏：ArkGraphics2D typography（content modifier 回调里绘制）
target_link_libraries(proteus_render PUBLIC libnative_drawing.so)

# ★★宿主桥模块（appScreen 桥 + 壳生命周期桥）——NAPI 模块名 `proteus_host`（import 'libproteus_host.so'）
#   与 render 同属 HAR runtime（项目无关）；用内核建树/动画（Rust 核），经 render 的绘制通道上屏。
add_library(proteus_host SHARED proteus_host.cpp)
target_link_libraries(proteus_host PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
target_link_libraries(proteus_host PUBLIC libnative_drawing.so)
target_link_libraries(proteus_host PUBLIC libjsvm.so)
if(HAVE_RUST_CORE)
  target_link_libraries(proteus_host PUBLIC proteus_rust_layout)
endif()
