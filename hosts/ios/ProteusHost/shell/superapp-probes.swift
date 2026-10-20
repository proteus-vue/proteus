// hosts/ios/ProteusHost/shell/superapp-probes.swift
// ★★★#1121：**真机探针 runner**（从 `superapp-scene.swift` 抽出）。
//
// 【为什么抽】四个探针分支（fetch-limit / stream / upload / cancel）**结构完全相同**：
//   起探针 → `asyncAfter` 链读结果 → 落报告 → 自退。此前复制了 4 份、把宿主壳顶过 1000 行。
//   ⇒ 抽成一份 runner：**新增探针只需在 `ProbeConfig` 里加一行**，不用再抄 40 行。
//   ★这是"同一模式的 N 份复制"，不是"为过门禁而拆文件"。
//
// 【★为什么必须 `asyncAfter` 链、不能主线程循环】
//   `http.request` 的回推是 `DispatchQueue.main.async`——主线程 `while + usleep` 等结果时
//   回推永远排不上 ⇒ **死锁**（Android `TransferProbe` 因同坑改过一次）。
//   本 runner 每轮让 main runloop 转起来（确定性事件，不是盲等），且有 deadline。
//
// 【★诚实边界】每轮间隔 0.2s、deadline 各探针不同——这是**装置节奏**，不是框架时延。

import Foundation

/// 一个探针的配置（新增探针 = 往 `SuperappProbes.all` 加一项）。
struct ProbeConfig {
  /// 命令行前缀（如 `--stream-probe=`）
  let argPrefix: String
  /// 调 JS 探针的表达式模板（`%@` 会被替换成逗号分隔的参数串）
  let kickFormat: String
  /// 结果写到 JS 全局键（如 `__proteusHostStreamProbeResult`）
  let resultKey: String
  /// 报告里的字段前缀（如 `stream`），会生成 `<prefix>_base` / `<prefix>_probe` / `<prefix>_ok`
  let reportPrefix: String
  /// 超时（秒）
  let deadlineSeconds: Double
  /// 额外读数（如宿主侧记账）；参数为原始基址
  let extraReadings: (String) -> [String: Any]
}

enum SuperappProbes {
  /// 当前注册的探针（★加新探针只改这里）
  static let all: [ProbeConfig] = [
    ProbeConfig(
      argPrefix: "--fetch-limit-probe=",
      kickFormat: "__proteusHostAppFetchLimitProbe(%@)",
      resultKey: "__proteusHostFetchLimitProbeResult",
      reportPrefix: "fetch_limit",
      deadlineSeconds: 60,
      extraReadings: { _ in [:] },
    ),
    ProbeConfig(
      argPrefix: "--stream-probe=",
      kickFormat: "__proteusHostAppStreamProbe(%@)",
      resultKey: "__proteusHostStreamProbeResult",
      reportPrefix: "stream",
      deadlineSeconds: 120,
      extraReadings: { _ in
        var d: [String: Any] = [:]
        let s = BodyLimitDelegate.lastStatsSnapshot()
        if !s.isEmpty { d["host_stream_stats"] = s }
        return d
      },
    ),
    ProbeConfig(
      argPrefix: "--upload-probe=",
      kickFormat: "__proteusHostAppUploadProbe(%@)",
      resultKey: "__proteusHostUploadProbeResult",
      reportPrefix: "upload",
      deadlineSeconds: 240,
      extraReadings: { _ in [:] },
    ),
    ProbeConfig(
      argPrefix: "--cancel-probe=",
      kickFormat: "__proteusHostAppCancelProbe(%@)",
      resultKey: "__proteusHostCancelProbeResult",
      reportPrefix: "cancel",
      deadlineSeconds: 120,
      extraReadings: { _ in
        let cs = HttpCapability.cancelStats()
        return ["host_cancel_stats": ["calls": cs.calls, "hits": cs.hits, "misses": cs.misses]]
      },
    ),
    // ★★★#1126：**走 useFetch 门面**的判据（此前只在 Android 跑过，#1122 的诚实边界①）
    //   ★这条与 `--stream-probe` / `--cancel-probe` 的区别：那两个打底层 `invokeHostStream`，
    //     这条只走 `createCapabilityHooks(...).useFetch` —— 业务真正看到的那个面。
    ProbeConfig(
      argPrefix: "--usefetch-probe=",
      kickFormat: "__proteusHostAppUseFetchProbe(%@)",
      resultKey: "__proteusHostUseFetchProbeResult",
      reportPrefix: "usefetch",
      deadlineSeconds: 180,
      extraReadings: { _ in
        let cs = HttpCapability.cancelStats()
        return ["host_cancel_stats": ["calls": cs.calls, "hits": cs.hits, "misses": cs.misses]]
      },
    ),
  ]

  /// 找到命令行里出现的那个探针参数（返回配置 + 逗号分隔的参数串）。
  /// `nil` = 本次启动没有探针参数（走常规 superapp 流程）。
  static func firstArg() -> (ProbeConfig, [String])? {
    for cfg in all {
      if let a = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(cfg.argPrefix) }) {
        let body = String(a.dropFirst(cfg.argPrefix.count))
        let parts = body.split(separator: ",").map(String.init)
        return (cfg, parts)
      }
    }
    return nil
  }

  /// 跑探针：起 → 轮询读结果 → 落报告 → （`PROTEUS_EXIT_AFTER_REPORT=1` 时）自退。
  ///
  /// - Parameters:
  ///   - cfg: 探针配置
  ///   - parts: 逗号分隔的参数（首个固定是基址）
  ///   - argsForKick: 传给 JS 探针的**额外**参数（已按类型拼好，如 `256,16384,20`）
  static func run(_ cfg: ProbeConfig, base: String, argsForKick: String) {
    let kickArgs = argsForKick.isEmpty ? "\(SuperappScene.jsonQuote(base))" : "\(SuperappScene.jsonQuote(base)),\(argsForKick)"
    let expr = String(format: cfg.kickFormat, kickArgs)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      _ = SuperappScene.evalJs?(expr)
      let deadline = Date().addingTimeInterval(cfg.deadlineSeconds)
      var rounds = 0
      var lastRaw = ""

      func poll() {
        rounds += 1
        let raw = SuperappScene.evalJs?("String(globalThis.\(cfg.resultKey) || '')") ?? ""
        if raw.isEmpty || raw == "null" || raw == "undefined" {
          if Date() < deadline {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
            return
          }
        } else {
          lastRaw = raw
        }
        var o = SuperappScene.reportBody()
        o["\(cfg.reportPrefix)_base"] = base
        o["\(cfg.reportPrefix)_probe_rounds"] = rounds
        o["\(cfg.reportPrefix)_probe"] = lastRaw.isEmpty ? "null" : lastRaw
        for (k, v) in cfg.extraReadings(base) { o[k] = v }
        if let d = lastRaw.data(using: .utf8),
           let po = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
          o["\(cfg.reportPrefix)_ok"] = (po["ok"] as? Bool) ?? false
        } else {
          o["\(cfg.reportPrefix)_ok"] = false
          if lastRaw.isEmpty { o["\(cfg.reportPrefix)_error"] = "探针超时（\(Int(cfg.deadlineSeconds))s 内无结果）" }
        }
        SuperappScene.takeSnapshot()
        SuperappScene.switchLog.append([
          cfg.reportPrefix: base, "rounds": rounds,
          "ok": o["\(cfg.reportPrefix)_ok"] ?? false, "via": cfg.argPrefix,
        ])
        SuperappScene.writeReport(o)
        NSLog("[proteus] SUPERAPP_PROBE_REPORT_READY kind=%@ ok=%@ rounds=%d",
              cfg.reportPrefix, String(describing: o["\(cfg.reportPrefix)_ok"] ?? false), rounds)
        if ProcessInfo.processInfo.environment["PROTEUS_EXIT_AFTER_REPORT"] == "1" { exit(0) }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { poll() }
    }
  }
}
