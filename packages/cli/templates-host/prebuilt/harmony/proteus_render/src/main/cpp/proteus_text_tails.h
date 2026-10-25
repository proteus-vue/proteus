// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_text_tails.h
// ★★★批 B F3 收尾（2026-10-25）：`text-indent` / `word-spacing` / `overflow-wrap` 的**三端读数**。
//
// 【为什么单独成文件】`proteus_host.cpp`（1090 行）与 `proteus_render.cpp`（3721 行）都超 1000 行棘轮
//   （决策 #872「存量只减不增」）。本轮三项能力要在两处各读一遍同样三个键（首遍度量 / 二遍折行），
//   ⇒ 按决策 #870 的分层范式把「三个键的读取 + 单位换算」抽到这里，两处各剩一行调用。
//
// 【语义】三项都是 CSS **继承**属性（编译器已按继承折进每个节点的 computed style）⇒ 宿主只读本节点：
//   · wordSpacing / textIndent：设计 px（调用方按密度换算成物理 px；0 = 未声明）
//   · overflowWrap：normal/break-word/anywhere（空 = 未声明 ⇒ normal）
//
// 【一处实现】首遍度量、二遍折行、绘制三处都调本方法 ⇒ 键名与换算口径不可能分叉。
#pragma once

#include <string>

namespace proteus {

/// 三项文本尾部属性（设计 px 口径；空串/0 = 未声明）
struct TextTails {
    double wordSpacing = 0;
    double textIndent = 0;
    std::string overflowWrap;
};

/// 从节点 JSON（`it`）读三项。`jstr` / `jnum` 由调用方传入（两个 cpp 各有自己的轻量 JSON 读取器，
/// 且签名一致：`(const char*, size_t, const char*, out*)`）——保持"不复制第二份 JSON 解析器"。
template <typename StrFn, typename NumFn>
inline TextTails readTextTails(const std::string& it, StrFn&& jstr, NumFn&& jnum) {
    TextTails t;
    jnum(it.c_str(), it.size(), "wordSpacing", &t.wordSpacing);
    jnum(it.c_str(), it.size(), "textIndent", &t.textIndent);
    jstr(it.c_str(), it.size(), "overflowWrap", &t.overflowWrap);
    return t;
}

}  // namespace proteus
