# {{appName}} —— entry native 桩（仅链接 runtime HAR，无自有逻辑）
cmake_minimum_required(VERSION 3.5.0)
project(proteus_entry)

# ★hvigor 跨模块 native 聚合入口：引入所依赖 HAR（proteus_render）的 native 目标
if(DEFINED PACKAGE_FIND_FILE)
  include(${PACKAGE_FIND_FILE})
endif()

add_library(proteus_entry SHARED proteus_entry_stub.cpp)
target_link_libraries(proteus_entry PUBLIC proteus_render::proteus_render)
