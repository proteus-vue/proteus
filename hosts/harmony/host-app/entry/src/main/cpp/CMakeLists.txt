# entry/src/main/cpp/CMakeLists.txt
# Proteus 鸿蒙宿主 —— 验证装置 native 模块（4050 基准 / 探针）
#
# ★关注点分层（见 hosts/README-LAYERS.md）：**渲染运行时（proteus_render）已抽为独立 HAR 模块**
#   （`../proteus_render/`，见其 CMakeLists）——本 entry 工程通过 ohpm `file:` 依赖它，
#   其 native 由 hvigor 跨模块聚合（`PACKAGE_FIND_FILE`）编译并打入本 HAP。
#   本文件只编 **dev 装置**（proteus_bench，属 hosts 验证装置，不进产品壳）。
cmake_minimum_required(VERSION 3.5.0)
project(proteus_host)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${NATIVERENDER_ROOT_PATH})
# ★HA0.5 平台适配层（文本度量/字体）已随 HAR **自持**（proteus_render/src/main/cpp/proteus_text_platform.h）
#   ⇒ 经下方 HAR helpers 的引号 include 解析，无需再引框架深度相对路径（决策 #725；见 HAR CMakeLists 注释）。
# ★HAR runtime 提供的共享 helper 头（proteus_host_helpers.h；dev→runtime 单向依赖，允许方向）
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../../../proteus_render/src/main/cpp)

# ★hvigor 跨模块 native 聚合入口：引入所依赖 HAR（proteus_render）的 native 目标/路径
#   ⇒ 本模块即可 `target_link_libraries(... proteus_render)`（其 .so 由 HAR 提供）。
if(DEFINED PACKAGE_FIND_FILE)
  include(${PACKAGE_FIND_FILE})
endif()

# ★Rust 排版核（**runtime 属性**，产物在 HAR 内：proteus_render/src/main/cpp/thirdparty/）——
#   dev 探针（4050 基准/vapor）也用它建树 ⇒ 从 HAR 路径引用（dev→runtime 单向，允许）。
set(RUST_LIB ${CMAKE_CURRENT_SOURCE_DIR}/../../../../proteus_render/src/main/cpp/thirdparty/libproteus_layout_core.a)
if(EXISTS ${RUST_LIB})
  add_library(proteus_rust_layout STATIC IMPORTED)
  set_target_properties(proteus_rust_layout PROPERTIES IMPORTED_LOCATION ${RUST_LIB})
  message(STATUS "proteus: Rust 排版核已就位（HAR runtime 提供）")
  set(HAVE_RUST_CORE TRUE)
else()
  message(WARNING "proteus: 缺 Rust 核 —— 4050 基准不参与构建（先跑 hosts/harmony/build-rust-core.sh）")
  set(HAVE_RUST_CORE FALSE)
endif()

# 4050 基准模块（Rust 核 + RenderNode）
if(HAVE_RUST_CORE)
  add_library(proteus_bench SHARED dev/proteus_bench.cpp)
  target_link_libraries(proteus_bench PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
  # ★★绘制通道真源（2026-10-03）：四通道在**渲染层**（proteus_render，现由 HAR 提供）建出来，
  #   而 probeChannels 的宿主实现在 proteus_bench —— 两个 .so 间用 C 导出通信 ⇒ bench 链接 render。
  #   ★HAR 导入 target 名 = `proteus_render::proteus_render`（hvigor 生成的 Config.cmake 定义，
  #     经 PACKAGE_FIND_FILE 的 find_package 引入——**不是**裸 `-lproteus_render`）。
  target_link_libraries(proteus_bench PUBLIC proteus_render::proteus_render)
  target_link_libraries(proteus_bench PUBLIC proteus_rust_layout)
  # ★文本通道（ArkGraphics2D）：styled_string + typography（鸿蒙文本绘制）
  target_link_libraries(proteus_bench PUBLIC libnative_drawing.so)
  # ★JSVM（V8 封装，矩阵 #13/#14）：设备端 JS 引擎——SDK sysroot 提供 libjsvm.so
  target_link_libraries(proteus_bench PUBLIC libjsvm.so)
endif()
