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
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
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
#include <dirent.h>
#include <cstring>
#include "proteus_http_save.h"
// ★#1194（R2 修复）：数目录里残留的临时文件。
//   ★不能再用 access("<name>.part")：临时名现在唯一（.proteus-tmp-<pid>-<seq>）
//     ⇒ 固定名探测永远不存在 ⇒ 残包断言恒为 0（第三轮验证者变异实测：去掉
//     abortUnfinished 的 remove，判据仍 5/5 绿而磁盘真留了 16 个残包）。
// ★#1195：**任何临时痕迹都算**（.proteus-tmp-* 或 *.part*）——只认一个前缀时，
//   换个命名形态的残包就数不到（实测：旧命名的 x.bin.part.* 让判据瞎眼）。
static bool isTempArtifact(const char* n) {
  if (std::strncmp(n, ".proteus-tmp-", 13) == 0) return true;
  return std::strstr(n, ".part") != nullptr;
}
static int countTempFiles(const char* dir) {
  DIR* d = opendir(dir);
  if (!d) return 0;
  int n = 0;
  struct dirent* e;
  while ((e = readdir(d)) != nullptr) if (isTempArtifact(e->d_name)) n++;
  closedir(d);
  return n;
}
// ★#1194：**探针自清**——否则上一次运行的残包会让本次假红（实测：变异后留下的
//   16 个 .proteus-tmp-* 让恢复后的正常实现被判"留下残包"）。
static void cleanTempFiles(const char* dir) {
  DIR* d = opendir(dir);
  if (!d) return;
  struct dirent* e;
  while ((e = readdir(d)) != nullptr) {
    if (isTempArtifact(e->d_name)) {
      std::string p = std::string(dir) + "/" + e->d_name;
      std::remove(p.c_str());
    }
  }
  closedir(d);
}
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
  cleanTempFiles("/tmp/proteus-raii-probe");   // ★#1194：自清（防上次残留导致假红）
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
  // ★#1194（R2）：临时名不再固定 ⇒ 必须**扫目录**数 .proteus-tmp-* 残包（原来的固定名 access 恒 -1）
  printf("LEFTOVER %d\\n", countTempFiles("/tmp/proteus-raii-probe"));
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
  cleanTempFiles("/tmp/proteus-noTrunc");   // ★#1194：自清
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
  cleanTempFiles("/tmp/proteus-ok/a"); cleanTempFiles("/tmp/proteus-ok");   // ★#1194：自清
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
  printf("PART_LEFT %d\\n", countTempFiles("/tmp/proteus-ok/a") + countTempFiles("/tmp/proteus-ok"));
  return 0;
}
`);
    expect(Number(/OK (\d)/.exec(out)?.[1]), '★成功路径 finish() 没报 ok').toBe(1)
    expect(Number(/REAL_SIZE (-?\d+)/.exec(out)?.[1]), '★磁盘上文件大小 != 写入量').toBe(10)
    expect(String(/SUMMARY (.*)/.exec(out)?.[1]), '★摘要里 size 与实际不符').toContain('"size":10')
    expect(Number(/PART_LEFT (\d)/.exec(out)?.[1]), '★成功后 .part 残留').toBe(0)
  })

  it('★★★#1194（R1）长文件名不被临时名挤掉（244 字符 basename 必须能落盘）', () => {
    /**
     * ★独立验证第三轮 R1 的真回归：`NAME_MAX=255`，而原临时名是
     *   `absPath + ".part.<pid>.<seq>.<nsec>"`（后缀 23–27 字符）⇒ 把可用 basename
     *   上限从 **~249 压到 ~231**（实测 244/249 字符的名字旧 `open=1`、新 `open=0`）
     *   ⇒ **232–249 是新增失败面**，而 Android/iOS 在同一窗口内成功。
     * ⇒ 临时文件改到同目录短名 `.proteus-tmp-<pid>-<seq>`（不占 basename 预算）。
     *   本判据锁死：244 字符名字必须 open+finish 都成功。
     */
    const out = runProbe(`
int main() {
  using namespace proteus::http;
  setHttpSandboxRoot("/tmp/r1-longname");
  cleanTempFiles("/tmp/r1-longname");
  std::string name(240, 'a'); name += ".txt";   // basename 244 字符（NAME_MAX=255）
  SaveSession s; std::string err;
  const bool opened = s.open(name, &err);
  bool fin = false; std::string e2;
  if (opened) { const char* p = "x"; s.write(reinterpret_cast<const uint8_t*>(p), 1); s.finish(&fin, &e2); }
  printf("BASENAME_LEN %zu\\n", name.size());
  printf("OPEN %d\\n", opened ? 1 : 0);
  printf("FINISH %d\\n", fin ? 1 : 0);
  return 0;
}
`)
    expect(out, '★长文件名（244）被临时名挤掉了 —— 临时名不能拼在 basename 后面').toContain('BASENAME_LEN 244')
    expect(Number(/OPEN (\d)/.exec(out)?.[1]), '★244 字符 basename 打不开（R1 回归）').toBe(1)
    expect(Number(/FINISH (\d)/.exec(out)?.[1]), '★244 字符 basename 收尾失败（R1 回归）').toBe(1)
  })

  it('★★★#1195 临时名：短（不占 basename 预算）且带随机度（不与业务文件名撞）', () => {
    /**
     * ★R1 的修法把临时名移到"同目录短名"，但**只有 pid+seq 两个变量** ⇒ 业务若真存
     *   `.proteus-tmp-1-1` 这样的文件，会被 `open("wb")` 截断（后果是数据丢失）。
     * ⇒ 要求：① 不拼在业务 basename 之后（否则又变回 R1）；② 名字里必须有纳秒/随机成分。
     */
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_save.h')
    expect(s, '★临时名又拼回业务名后面了（R1 回归）').not.toMatch(/partPath\s*=\s*absPath\s*\+/)
    expect(s, '★临时名只有 pid+seq（可能与业务文件名撞）').toMatch(/\.proteus-tmp-[^"\\]*[\s\S]{0,160}tv_nsec/)
    // 与目标同目录（rename 不跨文件系统）
    expect(s, '★临时名不在目标同目录（rename 可能 EXDEV）').toMatch(/partPath\s*=\s*dir\s*\+/)
  })

  it('★★★#1194（R1）真机：244 字符 basename 落盘成功且设备侧 size 一致', () => {
    // ★本地 clang 判据只证明"能 open/finish"；真机上还要过 RCP + 文件系统。
    //   本证据是 #1194 修完后补跑的真机读数（原缺陷下这一组会报"无法创建落盘文件"）。
    const p = 'hosts/harmony/results/http-probe-save-longname.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺长文件名真机证据 ${p}`).toBe(true)
    const r = JSON.parse(read(p))
    const rel = JSON.parse(r.probe_diag).savePath as string
    expect(rel.split('/').pop()!.length, '★证据里的 basename 不是 244 字符（验错了对象）').toBe(244)
    expect(r.ok, '★244 字符 basename 在真机上落盘失败（R1 回归）').toBe(true)
    expect(r.limit.saveWritten, '★真机没写进文件').toBeGreaterThan(0)
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
