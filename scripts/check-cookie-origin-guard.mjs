#!/usr/bin/env node
// scripts/check-cookie-origin-guard.mjs —— ★★★#1257 安全基线门禁：**凭据头不得跨 origin 跟随重定向**
//
// 【它防什么（不是理论风险，是实测出来的漏洞）】
//   App 宿主（Android `HttpCapability.buildCallConfig` / iOS `makeRequest`）会把平台 Cookie 存储里的
//   会话 cookie **手工塞进 `Cookie` 请求头**。而默认路径（`redirect: 'follow'` 且无 `onRedirect`）
//   由**宿主自己跟随重定向** —— TS 侧的跨域剥离（`capability-fetch-redirect.ts::nextHopConfig`）
//   在这条路径上**根本不执行**。
//
//   实测（本门禁就是那次实验的固化）：
//     OkHttp 3.14.9 带 `Cookie: PROTEUS_SESSION=SECRET-123` → A 返回 302 到 B（端口不同）
//     ⇒ **B 收到了这个 cookie**。OkHttp 的 `followUpRequest()` 只 `removeHeader("Authorization")`，
//     **对 Cookie 完全不管**（正常用法下 cookie 该由 `CookieJar` 按 domain/path 匹配，而"手写头"绕过了它）。
//     这正是 open-redirect 凭据泄露：任何业务接口返回 302 到攻击者域，会话 cookie 白给。
//
// 【为什么用真 OkHttp 而不是 mock】
//   要证的是**第三方库的真实跟随行为 + 我们的 interceptor 的真实位置**。mock 掉的恰好是被验的那一层
//   （本仓同族教训：桩替被测物把 bug 藏了）。
//
// 【判据（5 条，跑真 HTTP 服务 + 真 jar）】
//   A 跨源 302 ⇒ 目标域**收不到** Cookie        ← 核心（漏洞修复点）
//   B 同源 302 ⇒ 目标域**收得到** Cookie        ← 防"一刀切剥光"把正常业务打掉
//   C 跨源 ⇒ Authorization 也剥
//   D 同源 ⇒ Authorization 保留
//   E 无 origin tag（旧路径）⇒ fail-closed 剥
//
// 【破坏性验证】`--mutate=no-guard` ⇒ 不装 interceptor ⇒ A/E 必须红（证明判据盯的是守卫本身，
//   而不是"HTTP 请求能通"）。
//
// 用法：node scripts/check-cookie-origin-guard.mjs [--mutate=no-guard] [--verbose]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GUARD = path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/CookieOriginGuard.java')
const TP = path.join(ROOT, 'hosts/android/thirdparty')
const OKHTTP = path.join(TP, 'okhttp-3.14.9.jar')
const OKIO = path.join(TP, 'okio-1.17.2.jar')
const JDK = process.env.JAVA_HOME || path.join(ROOT, '.tools/jdk17')
const MUTATE = (process.argv.find((a) => a.startsWith('--mutate=')) || '').split('=')[1] || ''
const VERBOSE = process.argv.includes('--verbose')

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(GUARD)) fail(`缺守卫源码：${path.relative(ROOT, GUARD)}`)
for (const jar of [OKHTTP, OKIO]) {
  if (!fs.existsSync(jar)) fail(`缺第三方 jar：${path.relative(ROOT, jar)}（AAR 指纹门禁会一起红）`)
}

/**
 * 工具链解析：优先本仓 `.tools/jdk17`（本机一致），否则回退 **PATH 上的 javac/java**。
 * ★为什么要回退：CI（ubuntu-latest）自带 JDK 但**没有**本仓 `.tools` ⇒ 只认本地路径的话
 *   这道门禁就只能标 LOCAL_ONLY，而它验的是**安全基线**——不该在 CI 上失明。
 * ★本门禁用到的 API（`com.sun.net.httpserver` + OkHttp 3.14）在 JDK 11/17 上都成立。
 */
function resolveTool(name) {
  const local = path.join(JDK, 'bin', name)
  if (fs.existsSync(local)) return local
  const onPath = execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()
  if (onPath) return onPath
  fail(`缺 ${name}：既没有 ${local}，PATH 上也没有（设 JAVA_HOME 或装 JDK）`)
}
const javac = resolveTool('javac')
const java = resolveTool('java')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-guard-'))
const cases = path.join(tmp, 'CookieGuardCases.java')

// ★用例源码与守卫同包（`dev.proteus.layoutcore`）⇒ 能直接 new 真实现，不需要额外导出面
fs.writeFileSync(cases, `package dev.proteus.layoutcore;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class CookieGuardCases {
  static final List<String> results = new ArrayList<>();
  static volatile String seenCookie = "<none>";
  static volatile String seenAuth = "<none>";

  public static void main(String[] args) throws Exception {
    HttpServer target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    target.createContext("/echo", (HttpExchange ex) -> {
      seenCookie = String.valueOf(ex.getRequestHeaders().getFirst("Cookie"));
      seenAuth = String.valueOf(ex.getRequestHeaders().getFirst("Authorization"));
      byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
      ex.sendResponseHeaders(200, body.length);
      try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    });
    target.start();
    int targetPort = target.getAddress().getPort();

    HttpServer origin = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    int originPort = origin.getAddress().getPort();
    origin.createContext("/cross", (HttpExchange ex) -> {
      ex.getResponseHeaders().add("Location", "http://127.0.0.1:" + targetPort + "/echo");
      ex.sendResponseHeaders(302, -1); ex.close();
    });
    origin.createContext("/same", (HttpExchange ex) -> {
      ex.getResponseHeaders().add("Location", "http://127.0.0.1:" + originPort + "/echo");
      ex.sendResponseHeaders(302, -1); ex.close();
    });
    origin.createContext("/echo", (HttpExchange ex) -> {
      seenCookie = String.valueOf(ex.getRequestHeaders().getFirst("Cookie"));
      seenAuth = String.valueOf(ex.getRequestHeaders().getFirst("Authorization"));
      byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
      ex.sendResponseHeaders(200, body.length);
      try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    });
    origin.start();

    String originUrl = "http://127.0.0.1:" + originPort;
    OkHttpClient.Builder cb = new OkHttpClient.Builder().followRedirects(true);
    // ★破坏性验证钩子：PROTEUS_GUARD_DISABLED=1 ⇒ 不装守卫，跨源用例必须红
    if (!"1".equals(System.getenv("PROTEUS_GUARD_DISABLED"))) {
      cb.addNetworkInterceptor(new CookieOriginGuard());
    }
    OkHttpClient client = cb.build();

    seenCookie = "<none>";
    doGet(client, originUrl + "/cross", "PROTEUS_SESSION=SECRET-A", null);
    check("A 跨源 302 不该带 Cookie", !String.valueOf(seenCookie).contains("SECRET-A"), "target Cookie=" + seenCookie);

    seenCookie = "<none>";
    doGet(client, originUrl + "/same", "PROTEUS_SESSION=SECRET-B", null);
    check("B 同源 302 必须保留 Cookie", String.valueOf(seenCookie).contains("SECRET-B"), "Cookie=" + seenCookie);

    seenAuth = "<none>";
    doGet(client, originUrl + "/cross", "sid=1", "Bearer TOKEN-C");
    check("C 跨源必须剥 Authorization", !String.valueOf(seenAuth).contains("TOKEN-C"), "Authorization=" + seenAuth);

    seenAuth = "<none>";
    doGet(client, originUrl + "/same", "sid=1", "Bearer TOKEN-D");
    check("D 同源必须保留 Authorization", String.valueOf(seenAuth).contains("TOKEN-D"), "Authorization=" + seenAuth);

    seenCookie = "<none>";
    Request bare = new Request.Builder().url(originUrl + "/cross")
        .header("Cookie", "PROTEUS_SESSION=SECRET-E").build();
    try (Response r = client.newCall(bare).execute()) { /* consume */ }
    check("E 无 origin tag ⇒ fail-closed 剥凭据", !String.valueOf(seenCookie).contains("SECRET-E"), "Cookie=" + seenCookie);

    for (String line : results) System.out.println(line);
    boolean allPass = results.stream().allMatch((l) -> l.startsWith("PASS"));
    System.out.println(allPass ? "CASES=PASS" : "CASES=FAIL");
    origin.stop(0); target.stop(0);
    System.exit(allPass ? 0 : 1);
  }

  static void doGet(OkHttpClient client, String url, String cookie, String auth) throws Exception {
    Request.Builder b = new Request.Builder().url(url)
        .tag(CookieOriginGuard.OriginalOrigin.class,
             new CookieOriginGuard.OriginalOrigin(CookieOriginGuard.originOf(okhttp3.HttpUrl.get(url))));
    if (cookie != null) b.header("Cookie", cookie);
    if (auth != null) b.header("Authorization", auth);
    try (Response r = client.newCall(b.build()).execute()) { /* consume */ }
  }

  static void check(String name, boolean ok, String detail) {
    results.add((ok ? "PASS" : "FAIL") + " | " + name + " | " + detail);
  }
}
`)

const cp = `${OKHTTP}${path.delimiter}${OKIO}`
try {
  execFileSync(javac, ['-cp', cp, '-d', tmp, GUARD, cases], { stdio: VERBOSE ? 'inherit' : 'pipe' })
} catch (e) {
  fail(`javac 失败（守卫或用例编译不过）：\n${String(e.stderr || e.message)}`)
}

console.log(`凭据跨域门禁（真 OkHttp ${path.basename(OKHTTP)} + 真 CookieOriginGuard${MUTATE ? ` · 变异=${MUTATE}` : ''}）`)
let out = ''
let rc = 0
try {
  out = execFileSync(java, ['-cp', `${tmp}${path.delimiter}${cp}`, 'dev.proteus.layoutcore.CookieGuardCases'], {
    encoding: 'utf8',
    env: { ...process.env, ...(MUTATE === 'no-guard' ? { PROTEUS_GUARD_DISABLED: '1' } : {}) },
  })
} catch (e) {
  out = String(e.stdout || '')
  rc = e.status || 1
}

for (const line of out.split('\n')) {
  if (!line.trim()) continue
  const [verdict, name, detail] = line.split('|').map((s) => s.trim())
  if (verdict === 'PASS') console.log(`  ✅ ${name}`)
  else if (verdict === 'FAIL') console.log(`  ❌ ${name} — ${detail}`)
  else if (line.startsWith('CASES=')) continue
}
fs.rmSync(tmp, { recursive: true, force: true })

if (MUTATE === 'no-guard') {
  // ★变异期望：**必须红**（rc!=0），否则说明判据没盯守卫
  if (rc === 0) {
    console.error('\n✗ 变异「不装守卫」竟然全绿 —— 判据没盯住守卫本身（假绿）')
    process.exit(1)
  }
  console.log('\n✅ 变异「不装守卫」如预期变红（判据盯的是守卫，不是"请求能通"）')
  process.exit(0)
}

if (rc !== 0) {
  console.error('\n✗ 存在跨源凭据泄露或同源误剥 —— 见上')
  process.exit(1)
}
console.log('\n✅ 跨源剥凭据 / 同源保留，5/5 通过')
