// B 路线可行性探针 · iOS 侧（跑在模拟器里，用同一份 CFNetwork）
//
// 要回答的两个问题：
//   ① 配了 `connectionProxyDictionary`（只有 HTTP 代理键；HTTPS 代理键在 iOS 上是 NA）
//      之后，**https** 请求会不会被交给代理？（CFNetwork 是否发 CONNECT 隧道）
//   ② 隧道内 SNI 与 HTTP/2 是否保住？（用 cloudflare /cdn-cgi/trace 自报 `sni=` / `http=`）
//
// 用法: probe <proxyPort|0> <httpsUrl>
//   proxyPort=0 ⇒ 对照组：不配代理，走系统直连
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, let port = Int(args[1]) else {
  print("{\"error\":\"usage: probe <proxyPort|0> <httpsUrl>\"}")
  exit(2)
}
let urlString = args[2]
let repeatCount = args.count >= 4 ? max(1, Int(args[3]) ?? 1) : 1

var out: [String: Any] = [:]
out["proxyPort"] = port
out["target"] = urlString
out["proxyConfigured"] = port > 0
out["repeatCount"] = repeatCount

let cfg = URLSessionConfiguration.ephemeral
cfg.timeoutIntervalForRequest = 20
if port > 0 {
  // ★只设 HTTP 代理键（HTTPS 代理键在 iOS 上是 CF_AVAILABLE(..., NA)）
  cfg.connectionProxyDictionary = [
    "HTTPEnable": 1,
    "HTTPProxy": "127.0.0.1",
    "HTTPPort": port,
    "HTTPSEnable": 1,
    "HTTPSProxy": "127.0.0.1",
    "HTTPSPort": port,
  ]
}

let sem = DispatchSemaphore(value: 0)
let session = URLSession(configuration: cfg)
var statuses: [Int] = []
var traces: [[String: String]] = []
var lastError = ""
var completed = 0

func fire() {
  let task = session.dataTask(with: URL(string: urlString)!) { data, resp, err in
    if let http = resp as? HTTPURLResponse { statuses.append(http.statusCode) } else { statuses.append(-1) }
    if let e = err { lastError = "\(e)" }
    // ★把 body 里的 `http=` / `sni=` 抽出来（cloudflare trace 直接自报协议与 SNI）
    if let data, let body = String(data: data, encoding: .utf8) {
      var fields: [String: String] = [:]
      for line in body.split(separator: "\n") {
        let kv = line.split(separator: "=", maxSplits: 1)
        if kv.count == 2 {
          let k = String(kv[0])
          if k == "http" || k == "sni" || k == "tls" || k == "visit_scheme" {
            fields[k] = String(kv[1])
          }
        }
      }
      traces.append(fields)
    }
    completed += 1
    if completed < repeatCount { fire() } else { sem.signal() }
  }
  task.resume()
}
fire()
_ = sem.wait(timeout: .now() + 30)

out["statuses"] = statuses
out["status"] = statuses.first ?? -1
out["error"] = lastError
out["trace"] = traces.first ?? [:]
out["traceLast"] = traces.last ?? [:]

if let d = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]),
   let s = String(data: d, encoding: .utf8) {
  print(s)
}
