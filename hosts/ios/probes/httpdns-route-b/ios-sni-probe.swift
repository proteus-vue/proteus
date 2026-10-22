// B 路线加强验证 · iOS 侧：经代理访问本地自签 TLS 服务端，读出真实 SNI
// 用法: sni-probe <proxyPort> <url>
//   ★探针专用：无条件信任自签证书（仅用于本地 SNI 观测，绝不进生产）
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, let port = Int(args[1]) else {
  print("{\"error\":\"usage: sni-probe <proxyPort> <url>\"}")
  exit(2)
}
let urlString = args[2]

final class TrustAll: NSObject, URLSessionDelegate {
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let trust = challenge.protectionSpace.serverTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }
}

var out: [String: Any] = [:]
out["proxyPort"] = port
out["target"] = urlString

let cfg = URLSessionConfiguration.ephemeral
cfg.timeoutIntervalForRequest = 20
cfg.connectionProxyDictionary = [
  "HTTPEnable": 1,
  "HTTPProxy": "127.0.0.1",
  "HTTPPort": port,
  "HTTPSEnable": 1,
  "HTTPSProxy": "127.0.0.1",
  "HTTPSPort": port,
]

let sem = DispatchSemaphore(value: 0)
let delegate = TrustAll()
let session = URLSession(configuration: cfg, delegate: delegate, delegateQueue: nil)
var statuses: [Int] = []
var bodies: [String] = []
var lastError = ""
var completed = 0
let repeatCount = args.count >= 4 ? max(1, Int(args[3]) ?? 1) : 1

func fire() {
  session.dataTask(with: URL(string: urlString)!) { data, resp, err in
    if let http = resp as? HTTPURLResponse { statuses.append(http.statusCode) } else { statuses.append(-1) }
    if let e = err { lastError = "\(e)" }
    if let data, let s = String(data: data, encoding: .utf8) { bodies.append(s) }
    completed += 1
    if completed < repeatCount { fire() } else { sem.signal() }
  }.resume()
}
fire()
_ = sem.wait(timeout: .now() + 30)

out["statuses"] = statuses
out["status"] = statuses.first ?? -1
out["error"] = lastError
out["bodyFirst"] = bodies.first ?? ""

if let d = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]),
   let s = String(data: d, encoding: .utf8) {
  print(s)
}
