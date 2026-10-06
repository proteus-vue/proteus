# entry/src/main/cpp/CMakeLists.txt
# Proteus 鸿蒙宿主 —— 原生渲染模块（RenderNode 直绘）+ 4050 基准（Rust 排版核）
cmake_minimum_required(VERSION 3.5.0)
project(proteus_host)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${NATIVERENDER_ROOT_PATH})

# ★4050 基准需要 Rust 核（hosts/harmony/build-rust-core.sh 交叉编译产物）
set(RUST_LIB ${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/libproteus_layout_core.a)
if(EXISTS ${RUST_LIB})
  add_library(proteus_rust_layout STATIC IMPORTED)
  set_target_properties(proteus_rust_layout PROPERTIES IMPORTED_LOCATION ${RUST_LIB})
  message(STATUS "proteus: Rust 排版核已就位")
  set(HAVE_RUST_CORE TRUE)
else()
  message(WARNING "proteus: 缺 Rust 核 —— 4050 基准不参与构建（先跑 hosts/harmony/build-rust-core.sh）")
  set(HAVE_RUST_CORE FALSE)
endif()

# 渲染模块（直绘）
# ★关注点分层（见 hosts/README-LAYERS.md）：render 属 runtime（项目无关）、bench 属 dev（验证装置）；
#   源文件各在 cpp/{runtime,dev}/ 子目录，库名（NAPI 模块名 proteus_render / proteus_bench）不变。
add_library(proteus_render SHARED runtime/proteus_render.cpp)
target_link_libraries(proteus_render PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
# ★文本上屏：ArkGraphics2D typography（content modifier 回调里绘制）
target_link_libraries(proteus_render PUBLIC libnative_drawing.so)

# 4050 基准模块（Rust 核 + RenderNode）
if(HAVE_RUST_CORE)
  add_library(proteus_bench SHARED dev/proteus_bench.cpp)
  target_link_libraries(proteus_bench PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
  # ★★绘制通道真源（2026-10-03 · 三端打通绘制通道）：四通道在**渲染层**（proteus_render）建出来，
  #   而 probeChannels 的宿主实现在 proteus_bench —— 两个 .so 之间用 C 导出（`proteus_channel_state_of`）
  #   通信 ⇒ bench 必须链接 render。★顺序：render 先定义（见文件上方 add_library(proteus_render)）。
  target_link_libraries(proteus_bench PUBLIC proteus_render)
  target_link_libraries(proteus_bench PUBLIC proteus_rust_layout)
  # ★文本通道（ArkGraphics2D）：styled_string + typography（鸿蒙文本绘制）
  target_link_libraries(proteus_bench PUBLIC libnative_drawing.so)
  # ★JSVM（V8 封装，矩阵 #13/#14）：设备端 JS 引擎——SDK sysroot 提供 libjsvm.so
  target_link_libraries(proteus_bench PUBLIC libjsvm.so)
endif()
