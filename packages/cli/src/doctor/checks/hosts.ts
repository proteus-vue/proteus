// packages/cli/src/doctor/checks/hosts.ts —— §4.5 hosts 组（**投影聚合**：不新增探测）
//
// 【该组是 doctor 的核心增值】不对 §4.1–4.3 重复探测，而是**按 target 把已得 finding 投影聚合**，
//   输出"要打包 ios，还差哪几项"。实现上由 index.ts 在跑完 env/toolchain/deps 后调用 `projectHosts()`。
import type { DoctorGroup, DoctorFinding, DoctorLevel } from '../types'

/** 需要"按端"判定的项（其余项与端无关，不参与投影；★SSOT——R6：新增端须在此登记）。 */
const PER_HOST_IDS: Record<string, string[]> = {
  ios: ['toolchain/xcode', 'toolchain/xcode-devicectl', 'deps/workspace-links'],
  android: ['toolchain/android-jdk', 'toolchain/android-sdk', 'deps/workspace-links'],
  harmony: ['toolchain/harmony-deveco', 'deps/workspace-links'],
  web: ['env/node-version', 'deps/workspace-links'],
  skyline: ['toolchain/wechat-devtools', 'project/appid'],
}

/**
 * 把已跑的 findings 投影为 hosts 组的每端聚合 finding。
 * @param targets 工程声明的端
 * @param byId 已跑 finding 的 id → finding 映射
 */
export function projectHosts(targets: string[], byId: Map<string, DoctorFinding>): DoctorFinding[] {
  const out: DoctorFinding[] = []
  for (const end of targets) {
    const ids = PER_HOST_IDS[end]
    if (!ids) continue
    const relevant = ids.map((id) => byId.get(id)).filter((f): f is DoctorFinding => !!f && f.level !== 'skip')
    const bad = relevant.filter((f) => f.level === 'error' || f.level === 'warn')
    const level: DoctorLevel = bad.some((f) => f.level === 'error') ? 'error' : bad.length ? 'warn' : 'ok'
    const title = `hosts/${end}`
    if (level === 'ok') {
      out.push({ checkId: title, level: 'ok', title: `${end} 就绪`, actual: `${relevant.length} 项前置通过`, evidence: [] })
    } else {
      const errs = bad.filter((f) => f.level === 'error').map((f) => f.checkId)
      out.push({
        checkId: title,
        level,
        title: `${end} 未就绪`,
        expected: `${end} 端打包前置条件全通过`,
        actual: `还差：${bad.map((f) => f.checkId).join(' / ')}`,
        diagCode: errs.length ? byId.get(errs[0])?.diagCode : bad[0]?.diagCode,
        evidence: bad.flatMap((f) => f.evidence),
        fix: bad[0]?.fix,
      })
    }
  }
  return out
}

export const HOSTS_GROUP: DoctorGroup = 'hosts'
