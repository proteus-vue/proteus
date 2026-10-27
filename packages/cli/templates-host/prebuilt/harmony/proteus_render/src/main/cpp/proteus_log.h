// hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_log.h
// ★★★#1225 App 能力批 1 第 2 项：`log` —— 三端日志通路的宿主实现（鸿蒙侧）。
//
// 【为什么需要（#1212 的口径二修）】`useLog` 要的 `bridge.log(level, message, data)` 在 App 端
//   一直没有宿主方法 ⇒ `useLog` 恒抛 `log.unsupported`。此前判成"零原生（A 类）"是错的：
//   A 类判据只能是「**桥接口所需方法已存在**」，而宿主没有 `log.*`。
//   鸿蒙本来就有 hilog（`OH_LOG_Print` 在本包多处使用）⇒ 属"有平台通路、没接线"，三端各加一个方法。
//
// 【语义（与 Android LogCapability / iOS LogCapability 逐条对齐）】
//   `{level: log|warn|error, message, data?}` → hilog 对应级别；级别非法 / 缺 message ⇒ **返错**
//   （不静默记空日志）。回执 `{written, level, bytes}`，`bytes` 供判据核对"真的到了宿主"。
//
// 【为什么单独成文件】`host_app_runtime_impl.h` 已贴 1130 行棘轮（#1212 的教训：加一行 include
//   就被门禁判红）⇒ 实现落本文件，分派处只留一行调用。
#pragma once

#include <hilog/log.h>
#include <string>
#include <cstdio>

namespace proteus {
namespace logcap {

/// 写一条日志。返回完整回执 JSON（`{"ok":true,"data":{...}}` 或 `{"ok":false,...}`）。
/// ★`jstr` 由调用方传入（本包各文件有自己的轻量 JSON 读取器，签名一致）；
///   不复制第二份 JSON 解析器（同 proteus_text_tails.h 的处置）。
template <typename StrFn>
inline std::string write(const std::string& argsJson, StrFn&& jstr, unsigned int domain) {
    std::string level, message, data;
    jstr(argsJson.c_str(), argsJson.size(), "level", &level);
    jstr(argsJson.c_str(), argsJson.size(), "message", &message);
    if (message.empty()) return "{\"ok\":false,\"reason\":\"log: 缺少 message\",\"missing\":false}";
    if (level.empty()) level = "log";
    if (level != "log" && level != "info" && level != "warn" && level != "error")
        return "{\"ok\":false,\"reason\":\"log: 未知 level（仅 log / info / warn / error）\",\"missing\":false}";
    // data 可选：原样序列化追加（不解析结构，保持与 message 可区分）
    if (jstr(argsJson.c_str(), argsJson.size(), "data", &data) && !data.empty() && data != "null") {
        message += " " + data;
    }
    LogLevel lv = (level == "error") ? LOG_ERROR : (level == "warn") ? LOG_WARN : LOG_INFO;
    OH_LOG_Print(LOG_APP, lv, domain, "proteus-log", "%{public}s", message.c_str());
    char out[128];
    snprintf(out, sizeof(out),
             "{\"ok\":true,\"data\":{\"written\":true,\"level\":\"%s\",\"bytes\":%d}}",
             level.c_str(), (int) message.size());
    return out;
}

}  // namespace logcap
}  // namespace proteus
