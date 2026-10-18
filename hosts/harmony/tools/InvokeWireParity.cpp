// hosts/harmony/tools/InvokeWireParity.cpp
// ★★二进制线格式的**跨语言对拍运行器**（鸿蒙宿主 C++ 侧 · 由 `pnpm check:invoke-wire-parity` 驱动）
//
// 【它是什么】读 `scripts/invoke-wire-golden.ts` 产出的黄金向量（TSV），对 C++ 侧唯一实现
//   `hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h` 做三件事，并**逐条自检**：
//     ① kind=invoke  ⇒ `encodeInvoke(decodeInvoke(input))` 必须与 TS 的往返结果**逐字节相同**；
//     ② kind=resolve ⇒ 同法（回程帧）；
//     ③ kind=reject-* ⇒ 对应解码器必须**抛错**（坏 magic / 坏版本 / 尾部残留 / 截断 ⇒ 不许静默接受）。
//   另：kind=invoke 时还验 `peekMethod(input)`（另一条独立入口——不透支全帧解码）。
//
// 【★为什么本机可跑（不需要鸿蒙设备）】`invoke_wire.h` **零 OHOS 依赖**（只 include C++ 标准库）
//   ⇒ 本机 `clang++ -std=c++17` 直编直跑。与 Java 腿（纯 JDK / 本机 JVM）同一纪律：
//   #22「第 N 份手写副本 = 下一个静默缺陷」的机器化对策是**对拍**，不是"别写副本"。
//   ★诚实边界：本文件验的是**编解码器的字节语义**；C++ 源码能否被 OHOS clang 编译，由
//     `pnpm check:harmony-host-compile`（本文件同时也纳入该脚本）与 hvigor 构建兜住。
//
// 【★为什么不在 app 里】本文件位于 `hosts/harmony/tools/` ⇒ 不参与 HAP 构建。
//
// 用法：<bin> <golden.tsv>
// 退出码：0 = 全通过 / 1 = 有 FAIL / 2 = 用法错误
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "invoke_wire.h"

using proteus::wire::InvokeFrame;
using proteus::wire::ResolveFrame;

namespace {

int passed = 0;
int failed = 0;

std::vector<uint8_t> unhex(const std::string& s) {
  if (s == "-") return {};
  std::vector<uint8_t> out;
  out.reserve(s.size() / 2);
  for (size_t i = 0; i + 1 < s.size(); i += 2) {
    out.push_back(static_cast<uint8_t>(std::stoul(s.substr(i, 2), nullptr, 16)));
  }
  return out;
}

std::string hex(const std::vector<uint8_t>& b) {
  static const char* k = "0123456789abcdef";
  std::string out;
  out.reserve(b.size() * 2);
  for (uint8_t v : b) {
    out.push_back(k[v >> 4]);
    out.push_back(k[v & 0x0f]);
  }
  return out;
}

void ok(const std::string& name, const std::string& what) {
  passed++;
  std::cout << "  ✓ " << name << "：" << what << "\n";
}

void fail(const std::string& name, const std::string& why) {
  failed++;
  std::cout << "  ✗ " << name << "：" << why << "\n";
}

std::string preview(const std::string& s) {
  if (s.size() <= 160) return s;
  return s.substr(0, 160) + "…（共 " + std::to_string(s.size()) + " 字符）";
}

void run(const std::string& name, const std::string& kind, const std::string& inputHex,
         const std::string& expectHex, const std::string& extra) {
  std::vector<uint8_t> input = unhex(inputHex);
  if (kind == "invoke") {
    std::string got;
    try {
      got = hex(proteus::wire::encodeInvoke(proteus::wire::decodeInvoke(input)));
    } catch (const std::exception& e) {
      fail(name, std::string("往返抛错（") + e.what() + "）");
      return;
    }
    if (got != expectHex) {
      fail(name, "往返字节不符\n      期望 " + preview(expectHex) + "\n      实得 " + preview(got));
      return;
    }
    std::string m = proteus::wire::peekMethod(input);
    if (m != extra) {
      fail(name, "peekMethod 不符：期望 " + extra + "，实得 " + m);
      return;
    }
    ok(name, "invoke 往返 " + std::to_string(input.size()) + "B · peekMethod=" + m);
    return;
  }
  if (kind == "resolve") {
    std::string got;
    try {
      got = hex(proteus::wire::encodeResolve(proteus::wire::decodeResolve(input)));
    } catch (const std::exception& e) {
      fail(name, std::string("往返抛错（") + e.what() + "）");
      return;
    }
    if (got != expectHex) {
      fail(name, "往返字节不符\n      期望 " + preview(expectHex) + "\n      实得 " + preview(got));
      return;
    }
    ok(name, "resolve 往返 " + std::to_string(input.size()) + "B");
    return;
  }
  if (kind == "reject-invoke") {
    bool threw = false;
    try {
      proteus::wire::decodeInvoke(input);
    } catch (...) {
      threw = true;
    }
    if (!threw) {
      fail(name, "坏帧被**静默接受**（decodeInvoke 未抛错）——判据失守");
      return;
    }
    ok(name, "坏帧被拒（" + std::to_string(input.size()) + "B）");
    return;
  }
  if (kind == "reject-resolve") {
    bool threw = false;
    try {
      proteus::wire::decodeResolve(input);
    } catch (...) {
      threw = true;
    }
    if (!threw) {
      fail(name, "坏帧被**静默接受**（decodeResolve 未抛错）——判据失守");
      return;
    }
    ok(name, "坏帧被拒（" + std::to_string(input.size()) + "B）");
    return;
  }
  fail(name, "未知 kind：" + kind);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "用法：InvokeWireParity <golden.tsv>\n";
    return 2;
  }
  std::ifstream in(argv[1]);
  if (!in) {
    std::cerr << "读不到黄金向量文件：" << argv[1] << "\n";
    return 2;
  }
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    // ★must keep trailing empty fields（`invoke-empty-strings` 的 extra = 空 method 名 ⇒ 行尾是 \t）：
    //   `std::getline(ss, cur, '\t')` 对**末尾空字段**不产生元素 ⇒ 会少一列（实测抓出）。
    std::vector<std::string> cols;
    {
      size_t start = 0;
      for (size_t i = 0; i <= line.size(); i++) {
        if (i == line.size() || line[i] == '\t') {
          cols.push_back(line.substr(start, i - start));
          start = i + 1;
        }
      }
    }
    if (cols.size() < 5) {
      fail("<列数不足>", "行只有 " + std::to_string(cols.size()) + " 列（期望 5）：" + line);
      continue;
    }
    run(cols[0], cols[1], cols[2], cols[3], cols[4]);
  }
  std::cout << "\n[check-invoke-wire-parity] C++（鸿蒙）侧自检：" << passed << " 通过 / " << failed
            << " 失败\n";
  if (failed > 0) {
    std::cerr << "✗ 二进制线格式**跨语言不等价**——鸿蒙 `invoke_wire.h` 与 TS 侧 "
                 "`packages/api/src/invoke-wire.ts` 已漂移。\n";
    std::cerr << "  修法：以 TS 为 SSOT 改 C++（不要反向改 golden——golden 由 TS 生成）。\n";
    return 1;
  }
  return 0;
}
