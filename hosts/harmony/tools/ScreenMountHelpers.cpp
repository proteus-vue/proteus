// hosts/harmony/tools/ScreenMountHelpers.cpp
// ★★屏切换通路（`screen.mount`）的**纯函数自检运行器**（由 `pnpm check:screen-mount-helpers` 驱动）
//
// 【它是什么】对 `proteus_host_helpers.h` 里三个**字符串级纯函数**做逐条自检：
//     ① `retargetFirstNullParent` —— 把内容首个 `"parentId":null` 改指合成根；
//     ② `evalEnvToken`            —— 单个 `env:<name>[+N|-N|*F|~F]` → vp 数值；
//     ③ `substituteEnvTokens`     —— 整串里所有 `"env:--pf-*"` → 数值。
//
// 【为什么需要（#1144 的机器化对策）】
//   2026-10-20 真内核取证（`proteus_layout_create` 原话）：
//     `请求解析失败：invalid type: string "env:--pf-vh", expected f32`
//   ⇒ 鸿蒙 executor 的屏内容建树失败、`exec_content_nodes=0`（入库基线 114）。
//   根因是**两条建树通路只修了一条**：`AppScreenCommands` 解析了 env token，`screen.mount` 没有。
//   而首版 `retargetFirstNullParent` 还带一个 off-by-2（`at + 12` 越过冒号）——
//   **三种输入实测全不生效**，只看 diff 是看不出来的。
//   ⇒ 判据必须**真跑这几个函数**（不是 grep 调用点），且用**紧凑 JSON**（`JSON.stringify` 的真实产出形态）。
//
// 【★为什么本机可跑（不需要鸿蒙设备）】三个函数**零 OHOS 依赖**（纯 C++ 标准库）；
//   但 `proteus_host_helpers.h` 整体带 OHOS 头 ⇒ 不能直接 include。故此处保留一份**逐字副本**，
//   并由 `scripts/check-screen-mount-helpers.mjs` **逐字节比对**（漂移即红——否则 runner 会测旧副本而长期假绿）。
//   ★改源文件的函数体后，必须把同一段**逐字节**复制进下方 BEGIN/END 标记区间。
//
// 用法：<bin>
// 退出码：0 = 全通过 / 1 = 有 FAIL
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <iostream>
#include <map>
#include <string>
#include <vector>

// ═══════════ 以下三段必须与 proteus_host_helpers.h **逐字节一致**（门禁比对） ═══════════
// ----BEGIN evalEnvToken----
/// 解析 `env:<name>[+N|-N][~F]` → vp；未知名/无表项 ⇒ fallback（缺省 0）。
static inline double evalEnvToken(const std::string& name, const std::map<std::string, double>& env) {
  std::string nm = name; double fb = 0; int off = 0; double scale = 1;
  size_t tilde = nm.find('~');
  if (tilde != std::string::npos) { fb = strtod(nm.c_str() + tilde + 1, nullptr); nm = nm.substr(0, tilde); }
  // ★缩放（决策 #595）：`*<scale>`
  size_t star = nm.find('*');
  if (star != std::string::npos) { scale = strtod(nm.c_str() + star + 1, nullptr); nm = nm.substr(0, star); }
  // ★偏移符号 = 后随**数字**的 +/-,（变量名自带连字符 '-'，不能见到 '-' 就当分隔符——真机实测会截出 NaN）
  for (size_t i = 1; i + 1 < nm.size(); i++) {
    if ((nm[i] == '+' || nm[i] == '-') && nm[i + 1] >= '0' && nm[i + 1] <= '9') {
      double v = strtod(nm.c_str() + i + 1, nullptr);
      off = (nm[i] == '-' ? -1 : 1) * (int)v;
      nm = nm.substr(0, i); break;
    }
  }
  auto it = env.find(nm);
  return ((it != env.end() ? it->second : fb)) * scale + off;
}
// ----END evalEnvToken----

// ----BEGIN substituteEnvTokens----
/// 就地替换 nodes 串里的 `"env:<token>"`（含引号）→ 数值（vp）。
static inline void substituteEnvTokens(std::string& nodes, const std::map<std::string, double>& env) {
  // ★★★修（2026-10-08 · 用户抓出「鸿蒙/iOS 背景页导航后只有首页」）：**不得因 env 表为空而早退**——
  //   旧实现在 env 为空（宿主采集未就绪）时直接 return ⇒ `env:--pf-vh`（无 fallback）原样进内核 ⇒
  //   内核按字符串解析失败（"invalid type: string, expected f32"）⇒ **整屏 create 失败（0 节点、白屏）**。
  //   正解：始终替换，未知/缺表 ⇒ evalEnvToken 返回 fallback（缺省 0）——与 iOS resolveEnvToken 同语义。
  (void)env;
  std::string out; out.reserve(nodes.size());
  size_t i = 0;
  while (i < nodes.size()) {
    // ★★#1144：只认契约前缀 `"--pf-`（check-env-vars 的闭集判据即 `env:--pf-*`）——
    //   原实现匹配任意 `"env:` ⇒ 文本值若以 "env:" 开头会被整段替换成数字（自检实测）。
    if (nodes.compare(i, 10, "\"env:--pf-") == 0) {
      size_t close = nodes.find('"', i + 5);
      if (close == std::string::npos) { out += nodes[i]; i++; continue; }
      std::string name = nodes.substr(i + 5, close - (i + 5));
      double v = evalEnvToken(name, env);
      char buf[40]; snprintf(buf, sizeof(buf), "%.4f", v);
      out += buf;
      i = close + 1;
      continue;
    }
    out += nodes[i]; i++;
  }
  nodes = out;
}
// ----END substituteEnvTokens----

// ----BEGIN retargetFirstNullParent----
/**
 * 把 nodes 串里**第一个** `"parentId": null`（紧凑 `"parentId":null` 同义）改指 rootId。
 * ★原实现只匹配带空格的形态，而 JSON.stringify 产出**紧凑串**（无空格）⇒ 从未命中：
 *   内容根一直悬空在合成根之外（真内核验证：remap 未命中时仍能建树，但屏根子树为空）。
 */
static inline void retargetFirstNullParent(std::string& nodes, int rootId) {
  size_t from = 0;
  while (true) {
    size_t at = nodes.find("\"parentId\"", from);
    if (at == std::string::npos) return;
    size_t v = at + 10;  // 跳过 "parentId"（含两侧引号共 10 字符）
    while (v < nodes.size() && (nodes[v] == ' ' || nodes[v] == '\t')) ++v;
    if (v < nodes.size() && nodes[v] == ':') {
      ++v;
      while (v < nodes.size() && (nodes[v] == ' ' || nodes[v] == '\t')) ++v;
      if (nodes.compare(v, 4, "null") == 0) {
        char repl[40];
        snprintf(repl, sizeof(repl), "\"parentId\":%d", rootId);
        nodes.replace(at, v + 4 - at, repl);
        return;
      }
    }
    from = at + 10;
  }
}
// ----END retargetFirstNullParent----
// ═══════════ 以上三段必须与 proteus_host_helpers.h 逐字节一致 ═══════════

namespace {

int g_fail = 0;

void check(const char* name, const std::string& got, const std::string& want) {
  const bool ok = got == want;
  if (!ok) ++g_fail;
  std::cout << (ok ? "  ✓ " : "  ✗ ") << name << "\n";
  if (!ok) {
    std::cout << "      期望: " << want << "\n";
    std::cout << "      实得: " << got << "\n";
  }
}

void checkNum(const char* name, double got, double want) {
  const bool ok = (got == want);
  if (!ok) ++g_fail;
  char g[64], w[64];
  snprintf(g, sizeof(g), "%g", got);
  snprintf(w, sizeof(w), "%g", want);
  check(name, g, w);
}

}  // namespace

int main() {
  std::cout << "[screen-mount-helpers] 屏切换通路纯函数自检\n";

  // ── ① retargetFirstNullParent ──
  // ★夹具形态 = `JSON.stringify` 的真实产出（**紧凑、无空格**）——旧实现只认带空格的形态。
  {
    std::string s = R"([{"id":0,"parentId":null,"w":1},{"id":1,"parentId":0}])";
    retargetFirstNullParent(s, 900000);
    check("紧凑 JSON：首个 null 父改指合成根", s,
          R"([{"id":0,"parentId":900000,"w":1},{"id":1,"parentId":0}])");
  }
  {
    std::string s = R"([{"id":0,"parentId": null,"w":1}])";
    retargetFirstNullParent(s, 900000);
    check("带空格形态也须命中（向后兼容手写串）", s,
          R"([{"id":0,"parentId":900000,"w":1}])");
  }
  {
    std::string s = R"([{"id":5,"parentId":3},{"id":0,"parentId":null},{"id":3,"parentId":null}])";
    retargetFirstNullParent(s, 900000);
    check("根不在首位：改的是**第一个 null**（不是第一个非 null）", s,
          R"([{"id":5,"parentId":3},{"id":0,"parentId":900000},{"id":3,"parentId":null}])");
  }
  {
    std::string s = R"([{"id":1,"parentId":0}])";
    retargetFirstNullParent(s, 900000);
    check("无 null 根：原样不动（不误改有父节点）", s, R"([{"id":1,"parentId":0}])");
  }
  {
    std::string s = R"([{"id":0,"parentId":"null-ish"}])";
    retargetFirstNullParent(s, 900000);
    check("值以 null 开头但不是 null：不得误改", s, R"([{"id":0,"parentId":"null-ish"}])");
  }

  // ── ② evalEnvToken ──
  {
    std::map<std::string, double> env{{"--pf-vh", 844}, {"--pf-inset-bottom", 34}};
    checkNum("裸变量", evalEnvToken("--pf-vh", env), 844);
    checkNum("偏移 +136", evalEnvToken("--pf-inset-bottom+136", env), 170);
    checkNum("偏移 -10", evalEnvToken("--pf-inset-bottom-10", env), 24);
    checkNum("缩放 *0.5", evalEnvToken("--pf-vh*0.5", env), 422);
    checkNum("未知变量 ⇒ fallback 0", evalEnvToken("--pf-nope", env), 0);
    checkNum("未知变量 + 显式 fallback(~44)", evalEnvToken("--pf-nope~44", env), 44);
  }

  // ── ③ substituteEnvTokens ──
  {
    // ★#1144 的**原始失败形态**：env token 残留会让内核 serde 拒收整屏。
    std::map<std::string, double> env{{"--pf-vh", 844}, {"--pf-inset-bottom", 34}};
    std::string s = R"([{"id":0,"minHeight":"env:--pf-vh"},{"id":1,"bottom":"env:--pf-inset-bottom+136~0"}])";
    substituteEnvTokens(s, env);
    check("真实夹具形态（minHeight/bottom 各一）", s,
          R"([{"id":0,"minHeight":844.0000},{"id":1,"bottom":170.0000}])");
  }
  {
    // ★env 表为空时**必须仍替换**（#593 修过的坑：早退 ⇒ token 原样进内核 ⇒ 整屏 create 失败）
    std::map<std::string, double> empty;
    std::string s = R"([{"id":0,"minHeight":"env:--pf-vh"}])";
    substituteEnvTokens(s, empty);
    check("env 表为空 ⇒ 替换为 fallback 0（不得早退）", s, R"([{"id":0,"minHeight":0.0000}])");
  }
  {
    std::string s = R"([{"id":0,"text":"env: 只是文本，不是 token"}])";
    substituteEnvTokens(s, {});
    check("普通文本里的 env: 前缀不得被误当 token", s, R"([{"id":0,"text":"env: 只是文本，不是 token"}])");
  }

  if (g_fail == 0) {
    std::cout << "  ✅ 全部通过\n";
    return 0;
  }
  std::cout << "  ✗ " << g_fail << " 条失败\n";
  return 1;
}
