// hosts/harmony/host-app/entry/src/main/ets/runtime/ProbeScenes.ets
// ★★★#1344：**全部"探针场景"的分发**（从 `Superapp.ets` 抽出）。
//
// 【为什么抽出】`Superapp.ets` 已 1004 行（上限 1000）——本轮加的会话场景把它顶过线。
//   这些场景有共同形态：`scene` 命中 ⇒ 取 filesDir ⇒ 跑一个纯逻辑函数 ⇒ `return`（不渲染应用）。
//   抽成一处后，`Superapp.ets` 只需一行 `if (tryRunProbeScene(...)) return;`，
//   新增探针也**不用再动那个大文件**（这是它反复被顶爆的根因）。
//
// 【诚实边界】本文件**只做分发**，各场景的实现仍在各自的 `runtime/*.ets` 里
//   （`VmSessionProbe` / `VmSessionScene` / `VmSessionHttpScene` / `TransportProbe`）。
//   ★不搬实现：那些文件各有自己的头注释与判据口径，搬过来只会让"改一个场景要开两个文件"。

import { runTransportProbeScene } from './TransportProbe';
import { runVmSessionProbeScene } from './VmSessionProbe';
import { runVmSessionScene } from './VmSessionScene';
import { runVmSessionHttpScene } from './VmSessionHttpScene';

/** 探针场景的上下文（由调用方提供 —— 避免本文件反向依赖 Superapp） */
export interface ProbeSceneCtx {
  scene: string;
  filesDir: string;
  /** `--ps vmRounds N`（轮数 / 拍数） */
  rounds: number;
  /** `--ps vmMode ...`（诊断形态） */
  mode: string;
  /** `--ps url ...`（HTTP 目标） */
  url: string;
  /** 老的 HTTP 探针入口（仍在 Superapp 里，因为它要注入沙箱根） */
  runHttpProbe: () => void;
  injectSandboxRoot: () => void;
  /** ★回调：把沙箱根注进去（老的 http 探针需要） */
  onFilesDirResolved?: (dir: string) => void;
}

/**
 * 尝试按 `scene` 跑一个探针场景。
 * @returns `true` = 已处理（调用方应 `return`，不要继续渲染应用）
 */
export function tryRunProbeScene(ctx: ProbeSceneCtx): boolean {
  const s = ctx.scene;

  // ★T-app-fetch / #1156：传输层取证 / HTTP 准据
  if (s === 'superapp-http' || s === 'superapp-transport') {
    ctx.injectSandboxRoot();
    if (s === 'superapp-transport') runTransportProbeScene(ctx.filesDir);
    else ctx.runHttpProbe();
    return true;
  }

  // ★★★#1342-A：#540 决策门（持久 VM 探针 · 合成负载）
  if (s === 'superapp-vmprobe') {
    runVmSessionProbeScene(ctx.filesDir, ctx.rounds, ctx.mode);
    return true;
  }

  // ★★★#1344 B-1：会话式 VM 判据（noframes / jsstub / noboot / explicit 作诊断矩阵）
  if (s === 'superapp-session') {
    runVmSessionScene(
      ctx.filesDir,
      ctx.rounds,
      ctx.mode !== 'noframes',
      ctx.mode === 'jsstub' || ctx.mode === 'noboot',
      ctx.mode === 'noboot',
      ctx.mode !== 'explicit',
    );
    return true;
  }

  // ★★★#1344 B-2：会话内真实 HTTP（走 useFetch 门面的最小 GET）
  if (s === 'superapp-session-http') {
    void runVmSessionHttpScene(
      ctx.filesDir,
      ctx.url.length > 0 ? ctx.url : 'https://httpbin.org/get',
      ctx.rounds > 0 ? ctx.rounds : 400,
    );
    return true;
  }

  return false
}
