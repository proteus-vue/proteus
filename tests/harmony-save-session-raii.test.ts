// tests/harmony-save-session-raii.test.ts
// ★★★#1191：**`SaveSession` 的行为判据**（独立验证 B1/B3 的回归防线）。
//
// 【为什么必须是"真跑 C++"，不能 grep 源码】
//   独立验证时的变异实证：把 `stream` 拒绝的**函数体清空**、把 stub 返回的文案删光，
//   原来那批"正则 grep 源码"的断言**仍然全绿**——因为命中的是注释。
//   ⇒ 落盘这类"资源生命周期"必须用**可执行判据**：编译真代码、跑真流程、看真后果（fd / 文件）。
//
// 【它守什么（每条都对应一个被验证抓到过的真缺陷）】
//   · B1-a：**早退不泄漏**——不调 `finish()` 就退出时，`~SaveSession` 必须关 fd + 删临时文件。
//     （原实现实测：连续 64 次失败 ⇒ fd +64、磁盘留 8192B 残包）
//   · B1-b：**不截断已有文件**——`open()` 之后、成功之前，用户原有的同名文件必须保持原样。
//     （原实现 `fopen(absPath,"wb")` 在请求发出前就把 11B 文件截成 0）
//   · B3：**flush 失败可见**——`fclose` 的返回码/`ferror` 不能被吞（本判据用只读文件系统不易造，
//     改为断言源码里确实检查了返回值，并注明这半条是静态的）。
//   · 路径防护：`..` / 绝对路径 → 拒绝；子目录 → 能建。
//
// 【运行条件】需要 `clang++`（本仓 iOS/鸿蒙宿主开发机都有）。缺失时**响亮跳过**，不假绿。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '..')
const SAVE_HEADER = path.join(ROOT, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h')

function hasClang(): boolean {
  try {
    execFileSync('clang++', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** 编译并运行一段 C++ 探针（include 仓库里的 `proteus_http_save.h`），返回 stdout */
function runProbe(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-save-'))
  const src = path.join(dir, 'probe.cpp')
  const bin = path.join(dir, 'probe')
  fs.writeFileSync(
    src,
    `#include <cstdio>
#include <string>
#include <cstdint>
#include "proteus_http_save.h"
${body}
`,
  )
  execFileSync('clang++', ['-std=c++17', '-O0', `-I`, path.dirname(SAVE_HEADER), '-o', bin, src], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const out = execFileSync(bin, [], { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  return out
}

const SKIP = !hasClang()

describe.skipIf(SKIP)('★★★#1191 SaveSession 行为（真编译真跑）', () => {
  it('★B1-a：不调 finish 就退出 ⇒ 临时文件被删、fd 不泄漏', () => {
    // 场景：open + 写一块，然后**直接离开作用域**（等价于 handle() 的 4 个早退出口）
    const out = runProbe(`
#include <dirent.h>
#include <sys/resource.h>
#include <unistd.h>
static int openFds() {
  int n = 0;
  DIR* d = opendir("/dev/fd");
  if (!d) return -1;
  while (readdir(d) != nullptr) n++;
  closedir(d);
  return n;
}
int main() {
  using namespace proteus::http;
  setHttpSandboxRoot("/tmp");
  int before = openFds();
  // ★#1192（J-RAII-1）：先自证 fd 计数有效——opendir 失败时 openFds() 返回 -1，
  //   前后都是 -1 ⇒ FD_DELTA=0 ⇒ 判据恒绿（哪怕真泄漏）。
  printf("FD_VALID %d\\n", before > 0 ? 1 : 0);
  if (before <= 0) return 3;
  for (int i = 0; i < 16; i++) {
    SaveSession s;
    std::string err;
    if (!s.open("proteus-raii-probe/x.bin", &err)) { printf("OPEN_FAIL %s\\n", err.c_str()); return 2; }
    uint8_t buf[1024] = {0};
    s.write(buf, sizeof(buf));
    // ★故意不调 finish()：析构必须兜底
  }
  int after = openFds();
  printf("FD_DELTA %d\\n", after - before);
  printf("LEFTOVER %d\\n", access("/tmp/proteus-raii-probe/x.bin.part", 0) == 0 ? 1 : 0);
  printf("TARGET_EXISTS %d\\n", access("/tmp/proteus-raii-probe/x.bin", 0) == 0 ? 1 : 0);
  return 0;
}
`);
    const fdDelta = Number(/FD_DELTA (-?\d+)/.exec(out)?.[1] ?? 'NaN')
    // ★J-RAII-1：先自证计数有效（否则 -1 - (-1) = 0 恒绿）
    expect(Number(/FD_VALID (\d)/.exec(out)?.[1]), '★fd 计数无效（/dev/fd 打不开）⇒ 这条判据会恒绿').toBe(1)
    expect(fdDelta, `★16 次早退后 fd 泄漏了 ${fdDelta} 个（原实现实测 64 次 +64）`).toBeLessThanOrEqual(2)
    expect(Number(/LEFTOVER (\d)/.exec(out)?.[1]), '★早退后留下 .part 残包').toBe(0)
    expect(Number(/TARGET_EXISTS (\d)/.exec(out)?.[1]), '★早退却生成了目标文件（业务会读到不完整文件）').toBe(0)
  })

  it('★B1-b：open 不截断已存在的同名文件（请求失败时用户文件必须完好）', () => {
    const out = runProbe(`
#include <unistd.h>
int main() {
  using namespace proteus::http;
  setHttpSandboxRoot("/tmp");
  system("mkdir -p /tmp/proteus-noTrunc && printf 'ORIGINAL-11' > /tmp/proteus-noTrunc/keep.txt");
  {
    SaveSession s;
    std::string err;
    if (!s.open("proteus-noTrunc/keep.txt", &err)) { printf("OPEN_FAIL\\n"); return 2; }
    uint8_t buf[4] = {'X','X','X','X'};
    s.write(buf, sizeof(buf));
    // ★早退：不给 finish
  }
  char got[64] = {0};
  FILE* f = fopen("/tmp/proteus-noTrunc/keep.txt", "rb");
  size_t n = f ? fread(got, 1, sizeof(got) - 1, f) : 0;
  if (f) fclose(f);
  printf("SIZE %zu\\n", n);
  printf("CONTENT %s\\n", got);
  return 0;
}
`);
    expect(Number(/SIZE (\d+)/.exec(out)?.[1]), '★请求未成功就把用户文件截断/改写了').toBe(11)
    expect(/CONTENT (.*)/.exec(out)?.[1]?.trim(), '★用户文件内容被破坏').toBe('ORIGINAL-11')
  })

  it('★成功路径：rename 生效 + 摘要 size 与实际文件大小一致', () => {
    const out = runProbe(`
#include <unistd.h>
int main() {
  using namespace proteus::http;
  setHttpSandboxRoot("/tmp");
  SaveSession s;
  std::string err;
  if (!s.open("proteus-ok/a/b.txt", &err)) { printf("OPEN_FAIL %s\\n", err.c_str()); return 2; }
  const char* payload = "hello-raii";
  s.write(reinterpret_cast<const uint8_t*>(payload), 10);
  bool ok = false;
  std::string summary = s.finish(&ok, &err);
  printf("OK %d\\n", ok ? 1 : 0);
  printf("SUMMARY %s\\n", summary.c_str());
  struct stat st{};
  printf("REAL_SIZE %lld\\n", (long long)(stat("/tmp/proteus-ok/a/b.txt", &st) == 0 ? st.st_size : -1));
  printf("PART_LEFT %d\\n", access("/tmp/proteus-ok/a/b.txt.part", 0) == 0 ? 1 : 0);
  return 0;
}
`);
    expect(Number(/OK (\d)/.exec(out)?.[1]), '★成功路径 finish() 没报 ok').toBe(1)
    expect(Number(/REAL_SIZE (-?\d+)/.exec(out)?.[1]), '★磁盘上文件大小 != 写入量').toBe(10)
    expect(String(/SUMMARY (.*)/.exec(out)?.[1]), '★摘要里 size 与实际不符').toContain('"size":10')
    expect(Number(/PART_LEFT (\d)/.exec(out)?.[1]), '★成功后 .part 残留').toBe(0)
  })

  it('★路径防护：.. / 绝对路径被拒；子目录能建', () => {
    const out = runProbe(`
int main() {
  using namespace proteus::http;
  setHttpSandboxRoot("/tmp");
  auto bad = [](const char* p) { return resolveSandboxPath(p).empty() ? 1 : 0; };
  printf("DOTDOT %d\\n", bad("a/../../etc/passwd"));
  printf("ABS %d\\n", bad("/etc/passwd"));
  printf("EMPTY %d\\n", bad(""));
  printf("OK_SUB %d\\n", resolveSandboxPath("download/x.txt").empty() ? 0 : 1);
  return 0;
}
`);
    expect(Number(/DOTDOT (\d)/.exec(out)?.[1]), '★a/../../etc/passwd 未被拒绝').toBe(1)
    expect(Number(/ABS (\d)/.exec(out)?.[1]), '★绝对路径未被拒绝').toBe(1)
    expect(Number(/EMPTY (\d)/.exec(out)?.[1]), '★空路径未被拒绝').toBe(1)
    expect(Number(/OK_SUB (\d)/.exec(out)?.[1]), '★合法子目录被误拒').toBe(1)
  })

  it('★B3（静态半条）：finish 必须检查 fflush / ferror / fclose 返回码', () => {
    const s = fs.readFileSync(SAVE_HEADER, 'utf8')
    // ★这半条只能静态判（造"磁盘满"要特权）。所以注明它是静态的，不冒充行为判据。
    expect(s, '★没检查 fflush 返回值（磁盘满时会把失败报成成功）').toMatch(/fflush\(fp\)\s*==\s*0/)
    expect(s, '★没检查 ferror').toMatch(/ferror\(fp\)/)
    /**
     * ★★★#1192（独立验证第二轮 J-B3-1）：只断言"出现过 `fclose(fp)`"**不够** ——
     *   变异实测：保留 `closeRc` 赋值但把它从判定条件里去掉（`(void)closeRc;`）
     *   三条旧断言**仍全绿**。⇒ 必须断言 `closeRc` **真的进了 if 条件**。
     */
    expect(s, '★fclose 返回码被取了却没用（writeFailed 判定里必须出现 closeRc != 0）').toMatch(
      /flushOk\s*\|\|\s*errFlag\s*\|\|\s*closeRc\s*!=\s*0/,
    )
  })
})
