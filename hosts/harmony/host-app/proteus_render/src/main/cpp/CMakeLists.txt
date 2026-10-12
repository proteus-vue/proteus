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
# ★HA0.5：平台适配层（文本度量/字体——换壳不改）——**已随 HAR 自持**（本目录 `proteus_text_platform.h`）。
#   ★★★决策 #725：此前用**框架深度相对路径** include `platform/harmony/...`，在**框架参考宿主**里恰好命中、
#     而 **CLI 生成的宿主**（HAR 位于 `dist/app/harmony/host/proteus_render`，比框架浅一层）⇒ 该路径失效
#     ⇒ `fatal error: 'proteus_text_platform.h' file not found`（用户「cli 就能跑起来」的拦路石）。自持后
#     引号 include 在**同目录**解析，与宿主布局无关（CI 无法暴露——它不建宿主）。源见 platform/harmony/。
#   ☆ 参考宿主的 entry CMakeLists 仍可视需要 include platform/（冗余无害），HAR 自身不再依赖它。

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
# ★★★决策 #841（路线修正）：鸿蒙玻璃**不再做 CPU 移植**——真机取证鸿蒙原生支持 Vulkan
#   （libvulkan 1.3 + 计算/图形队列）⇒ 玻璃走**离屏 Vulkan 跑 naga 产出的 SPIR-V**（同一份 WGSL 单源）。
#   ★为何弃 CPU 移植：它是"无 GPU 着色器 API"错误前提下的退路，且会在宿主**再写一份算法**
#     （违反铁律"算法只在 WGSL 真源"——`check:shader-capability` 会当场红）。
add_library(proteus_render SHARED proteus_render.cpp glass_vk.cpp)
target_link_libraries(proteus_render PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
# ★文本上屏：ArkGraphics2D typography（content modifier 回调里绘制）
target_link_libraries(proteus_render PUBLIC libnative_drawing.so)
# ★决策 #840/#841：玻璃"背景捕获"用节点快照（OH_ArkUI_GetNodeSnapshot → PixelMap）+ 读写像素
#   ★实测（真机链接期取证）：`OH_PixelmapNative_*` 新 API 符号在 **libpixelmap.so**（image_framework），
#     而 `libpixelmap_ndk.z.so` 只导出旧 `OH_PixelMap_*`（大写 M）——链错库 ⇒ undefined symbol（已踩）。
target_link_libraries(proteus_render PUBLIC libpixelmap.so)
# ★决策 #841：离屏 Vulkan 玻璃 pass（跑 SPIR-V 生成物）——Vulkan 是**底层图形 API**（与 Metal/AGSL 同类），
#   非"平台原生材质 API"（UIGlassEffect/BlurStyle 那种高层，铁律禁依赖的是后者）⇒ 直接链 libvulkan。
#   可用性另由运行时 vkCreateInstance 判定（失败 ⇒ 玻璃降级半透明面，不崩；见 glass_vk.cpp 的 available）。
find_library(VULKAN_LIB vulkan)
if(VULKAN_LIB)
  target_link_libraries(proteus_render PUBLIC ${VULKAN_LIB})
  message(STATUS "proteus: 玻璃 Vulkan 腿已接线（${VULKAN_LIB}）")
else()
  message(WARNING "proteus: 缺 libvulkan —— 鸿蒙玻璃将降级为半透明面（先装含 Vulkan 的 SDK）")
endif()

# ★★宿主桥模块（appScreen 桥 + 壳生命周期桥）——NAPI 模块名 `proteus_host`（import 'libproteus_host.so'）
#   与 render 同属 HAR runtime（项目无关）；用内核建树/动画（Rust 核），经 render 的绘制通道上屏。
add_library(proteus_host SHARED proteus_host.cpp)
target_link_libraries(proteus_host PUBLIC libace_napi.z.so libace_ndk.z.so libhilog_ndk.z.so)
target_link_libraries(proteus_host PUBLIC libnative_drawing.so)
target_link_libraries(proteus_host PUBLIC libjsvm.so)
if(HAVE_RUST_CORE)
  target_link_libraries(proteus_host PUBLIC proteus_rust_layout)
endif()
