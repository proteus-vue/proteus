import JavaScriptCore
import Foundation
@objc protocol E: JSExport {
    func createView(_ t: String, _ p: String) -> Int
    func updateView(_ h: Int, _ k: String, _ v: String)
    func insertView(_ c: Int, _ p: Int, _ a: Int)
    func removeView(_ h: Int)
    func setViewText(_ h: Int, _ t: String)
    func ready(_ s: String)
}
final class B: NSObject, E {
    var n = 1
    func createView(_ t: String, _ p: String) -> Int { let i = n; n += 1; return i }
    func updateView(_ h: Int, _ k: String, _ v: String) {}
    func insertView(_ c: Int, _ p: Int, _ a: Int) {}
    func removeView(_ h: Int) {}
    func setViewText(_ h: Int, _ t: String) {}
    func ready(_ s: String) {}
}
func med(_ xs: [Double]) -> Double { let s = xs.sorted(); return s[s.count/2] }
func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
let src = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
print(String(format: "BUNDLE %.1f KB", Double(src.utf8.count)/1024))

// ① 基线：只建 context（不执行任何东西）——这是固定开销，不属于我们的优化面
var ctxMs: [Double] = []
for _ in 0..<20 { let t0 = now(); _ = JSContext()!; ctxMs.append(Double(now()-t0)/1_000_000) }
print(String(format: "CTX_CREATE  medianMs=%.3f", med(ctxMs)))

// ② 执行空脚本（隔离 evaluateScript 调用本身的开销）
let ctx = JSContext()!
ctx.setObject(B(), forKeyedSubscript: "proteusNative" as NSString)
var noopMs: [Double] = []
for _ in 0..<20 { let t0 = now(); ctx.evaluateScript(";"); noopMs.append(Double(now()-t0)/1_000_000) }
print(String(format: "NOOP_EVAL   medianMs=%.3f", med(noopMs)))

// ③ 同一 context 内重复执行 bundle：第 1 次 = 解析+编译+执行；第 2 次起 = 复用已编译代码执行
var first: Double = 0
var repeats: [Double] = []
for i in 0..<9 {
    let t0 = now()
    ctx.evaluateScript(src)
    let dt = Double(now()-t0)/1_000_000
    if i == 0 { first = dt } else { repeats.append(dt) }
}
print(String(format: "FIRST_EVAL  =%.2f ms   (解析+编译+执行)", first))
print(String(format: "REPEAT_EVAL =%.2f ms   (已编译，仅执行+运行时初始化)", med(repeats)))
print(String(format: "PARSE_COMPILE =%.2f", first - med(repeats)))
