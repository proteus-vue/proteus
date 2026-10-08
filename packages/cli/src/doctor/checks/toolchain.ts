// packages/cli/src/doctor/checks/toolchain.ts —— §4.2 toolchain 组（按端条件启用）
//
// 【零逻辑复制】Xcode 用 host-package 的 resolveDeveloperDir()；签名用 signing.ts；其余按 §4.2 探测。
// ★决策 #688：**所有 fix/directive 必须解耦框架源码**——用户没有 `hosts/`、`scripts/`、`.tools/`
//   （那是框架 checkout）⇒ 一律指 `proteus host signing …` / 通用安装命令 / GUI 指引。
import path from 'node:path'
import type { DoctorCheck } from '../types'
import { ok, skip, fail, hasToolsDir } from './util'
import { resolveDeveloperDir } from '../../host-package'
import { resolveMpIdeCli } from '../../mp-e2e'
import { androidSigningStatus, IOS_PROFILE_DIRS } from '../../signing'

/** 是否声明了某端（targets 含它） */
const has = (ctx: { targets: string[] }, end: string): boolean => ctx.targets.includes(end)
/** 是否有任一端需要该工具（targets 非空且含指定端集之一） */
const hasAny = (ctx: { targets: string[] }, ends: string[]): boolean => ends.some((e) => ctx.targets.includes(e))

export const TOOLCHAIN_CHECKS: DoctorCheck[] = [
  {
    id: 'toolchain/xcode',
    group: 'toolchain',
    title: 'Xcode（iOS SDK）',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'ios'),
    run(ctx) {
      const dir = resolveDeveloperDir()
      if (dir) return ok('toolchain/xcode', 'Xcode（iOS SDK）', dir)
      return fail({ checkId: 'toolchain/xcode', level: 'error', code: 'PT-BE-001', title: '找不到可用 Xcode（iOS SDK）', expected: '完整 Xcode（非 CommandLineTools）提供 iOS SDK', actual: '未找到', fix: { command: 'PROTEUS_DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer proteus doctor', description: '安装完整 Xcode 或指定非默认安装位' }, evidence: [{ command: 'xcode-select -p', note: '可能指向 CommandLineTools' }] })
    },
  },
  {
    id: 'toolchain/xcode-devicectl',
    group: 'toolchain',
    title: 'xcrun devicectl',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'ios'),
    run(ctx) {
      const dir = resolveDeveloperDir()
      if (!dir) return skip('toolchain/xcode-devicectl', 'xcrun devicectl', '无可用 Xcode')
      const devicectl = path.join(dir, 'usr', 'bin', 'devicectl')
      return ctx.exists(devicectl)
        ? ok('toolchain/xcode-devicectl', 'xcrun devicectl', devicectl)
        : fail({ checkId: 'toolchain/xcode-devicectl', level: 'error', code: 'PT-BE-001', title: '缺 devicectl（Xcode < 15）', expected: 'Xcode ≥ 15（自带 devicectl）', actual: '不存在', fix: { description: '升级 Xcode' }, evidence: [{ command: `ls ${devicectl}`, note: 'ENOENT' }] })
    },
  },
  {
    id: 'toolchain/android-jdk',
    group: 'toolchain',
    title: 'JDK 17',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'android'),
    run(ctx) {
      const jdk = ctx.runCmd('java', ['-version'], { timeoutMs: 4000 })
      const verStr = `${jdk.stderr ?? ''}${jdk.stdout ?? ''}`
      const m = verStr.match(/version "(\d+)/)
      const major = m ? Number(m[1]) : NaN
      // .tools/jdk17 存在也算通过——★上溯若干层（仓内工程可用框架仓的 .tools）
      const localJdk = hasToolsDir(ctx, 'jdk17') || hasToolsDir(ctx, 'jdk-17.0.20.1+1/Contents/Home')
      if (major === 17 || localJdk) return ok('toolchain/android-jdk', 'JDK 17', major === 17 ? `java ${major}` : '.tools/jdk17 就位')
      return fail({ checkId: 'toolchain/android-jdk', level: 'error', code: 'PT-BE-002', title: 'JDK 17 未找到', expected: 'JAVA_HOME 指向 JDK 17（或 .tools/jdk17）', actual: Number.isFinite(major) ? `java ${major}` : (jdk.note ?? '不可用'), fix: { command: 'brew install openjdk@17  # 或设 JAVA_HOME 指向 JDK 17', description: 'Android 打包需 JDK 17（javac/d8/apksigner）' }, evidence: [jdk] })
    },
  },
  {
    id: 'toolchain/android-sdk',
    group: 'toolchain',
    title: 'Android SDK',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'android'),
    run(ctx) {
      const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk')
      const hasPlatforms = ctx.exists(path.join(sdk, 'platforms'))
      const bt = ctx.exists(path.join(sdk, 'build-tools'))
      return hasPlatforms && bt
        ? ok('toolchain/android-sdk', 'Android SDK', `${sdk}（platforms + build-tools）`)
        : fail({ checkId: 'toolchain/android-sdk', level: 'error', code: 'PT-BE-002', title: 'Android SDK 不完整', expected: 'SDK 含 platforms/ 与 build-tools/（aapt2/d8/apksigner）', actual: `platforms=${hasPlatforms} build-tools=${bt}`, fix: { command: `# 用 Android Studio SDK Manager 装 platform-tools + build-tools；确认 ANDROID_HOME 指向 SDK（当前 ${sdk}）` }, evidence: [{ command: `ls ${sdk}/platforms`, note: hasPlatforms ? 'ok' : 'ENOENT' }] })
    },
  },
  {
    id: 'toolchain/android-signing',
    group: 'toolchain',
    title: 'Android 签名（debug keystore）',
    level: 'warn',
    appliesTo: (ctx) => has(ctx, 'android'),
    run(ctx) {
      // ★Android 打包用**自动生成的 debug keystore**（androiddebugkey）——签名几乎不会"失败"，
      //   真正会缺的是 keytool（JDK）与 apksigner（build-tools）；缺 keystore 也可由 CLI 生成。
      const jdkProbe = ctx.runCmd('java', ['-version'], { timeoutMs: 4000 })
      const buildTools = ctx.runCmd('sh', ['-c', 'ls "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools 2>/dev/null | tail -1'], { timeoutMs: 3000 })
      const st = androidSigningStatus({
        jdkDir: null, // 用 PATH 的 keytool（JDK 就绪性由 toolchain/android-jdk 单独判）
        buildToolsDir: buildTools.stdout ? `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/build-tools/${buildTools.stdout.trim()}` : null,
        keystore: `${ctx.root}/.proteus/debug.keystore`,
      })
      if (st.keytoolOk && st.apksignerOk) {
        return ok('toolchain/android-signing', 'Android 签名（debug keystore）', st.keystoreExists ? 'debug.keystore 就位' : '工具链就绪（打包时自动生成 debug.keystore）')
      }
      return fail({ checkId: 'toolchain/android-signing', level: 'warn', code: 'PT-EE-012', title: 'Android 签名工具链不完整', expected: 'keytool（JDK 17）+ apksigner（build-tools）', actual: st.messages.join('；') || '缺件', fix: { command: st.nextSteps[0] ?? '装 JDK 17 与 Android build-tools', description: st.nextSteps[1] ?? '' }, evidence: [{ command: 'java -version', exitCode: jdkProbe.exitCode ?? undefined, note: `keytool=${st.keytoolOk} apksigner=${st.apksignerOk}` }] })
    },
  },
  {
    id: 'toolchain/android-adb',
    group: 'toolchain',
    title: 'adb',
    level: 'warn',
    appliesTo: (ctx) => has(ctx, 'android'),
    run(ctx) {
      const ev = ctx.runCmd('adb', ['version'], { timeoutMs: 4000 })
      return ev.exitCode === 0
        ? ok('toolchain/android-adb', 'adb', (ev.stdout ?? '').split('\n')[0])
        : fail({ checkId: 'toolchain/android-adb', level: 'warn', code: 'PT-EE-012', title: '缺少 adb', expected: 'platform-tools 在 PATH', actual: ev.note ?? '不可用', fix: { command: 'export PATH="$ANDROID_HOME/platform-tools:$PATH"' }, evidence: [ev] })
    },
  },
  {
    id: 'toolchain/android-ndk',
    group: 'toolchain',
    title: 'Android NDK',
    level: 'warn',
    appliesTo: (ctx) => has(ctx, 'android'),
    run(ctx) {
      const hasNdk = hasToolsDir(ctx, 'ndk')
      return hasNdk
        ? ok('toolchain/android-ndk', 'Android NDK', '.tools/ndk 就位')
        : fail({ checkId: 'toolchain/android-ndk', level: 'warn', code: 'PT-EE-006', title: 'Android NDK 缺失', expected: '.tools/ndk', actual: '不存在', fix: { command: '# 用 Android Studio SDK Manager 装 NDK（或 sdkmanager "ndk;27.0.12077973"）；本机 .tools/ndk 亦可', description: 'Android 原生库（JNI）构建需要 NDK' }, evidence: [{ command: 'ls .tools/ndk', note: 'ENOENT' }] })
    },
  },
  {
    id: 'toolchain/ios-signing',
    group: 'toolchain',
    title: 'iOS 签名（项目 bundleId）',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'ios'),
    run(ctx) {
      // ★读**项目实际**的 iOS bundleId（与打包同源）——config 正则抓取（project/appid 同款手法）
      const raw = ctx.readFile('proteus.config.ts') ?? ''
      const m = raw.match(/ios\s*:\s*\{[^}]*bundleId\s*:\s*['"]([^'"]+)['"]/) ?? raw.match(/bundleId\s*:\s*['"]([^'"]+)['"]/)
      if (!m) return skip('toolchain/ios-signing', 'iOS 签名（项目 bundleId）', '未在 proteus.config 读到 ios.bundleId')
      const bundleId = m[1]
      const profile = ctx.findIosProfile(bundleId)
      return profile
        ? ok('toolchain/ios-signing', 'iOS 签名（项目 bundleId）', `${bundleId} ← ${path.basename(profile)}`)
        : fail({ checkId: 'toolchain/ios-signing', level: 'error', code: 'PT-BE-003', title: `iOS 签名不可用（无覆盖 ${bundleId} 的描述文件）`, expected: `本机 provisioning profile 覆盖 ${bundleId}`, actual: '无匹配 profile', fix: { command: 'proteus host signing ios --list  # 查本机描述文件/证书；缺失时在 Xcode 开启自动签名', description: 'iOS 需覆盖该 bundleId 的描述文件' }, evidence: [{ command: `ls "${path.join(process.env.HOME ?? '', 'Library/Developer/Xcode/UserData/Provisioning Profiles')}"`, note: `无覆盖 ${bundleId} 的 profile` }] })
    },
  },
  {
    id: 'toolchain/harmony-deveco',
    group: 'toolchain',
    title: 'DevEco Studio',
    level: 'error',
    appliesTo: (ctx) => has(ctx, 'harmony'),
    run(ctx) {
      const cands = [
        process.env.PROTEUS_DEVECO,
        '/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents',
        path.join(process.env.HOME ?? '', 'Applications/DevEco-Studio.app/Contents'),
        '/Applications/DevEco-Studio.app/Contents',
      ].filter((c): c is string => !!c)
      const hit = cands.find((c) => ctx.exists(path.join(c, 'tools/hvigor/bin/hvigorw')))
      return hit
        ? ok('toolchain/harmony-deveco', 'DevEco Studio', hit)
        : fail({ checkId: 'toolchain/harmony-deveco', level: 'error', code: 'PT-EE-011', title: '缺少 DevEco Studio / hvigor', expected: 'DevEco 6.1.1+（tools/hvigor/bin/hvigorw 存在）', actual: '未找到', fix: { command: 'PROTEUS_DEVECO=/path/to/DevEco-Studio.app/Contents proteus doctor', description: '安装 DevEco Studio' }, evidence: [{ command: 'ls <devEco>/tools/hvigor/bin/hvigorw', note: '候选位均未命中' }] })
    },
  },
  {
    id: 'toolchain/harmony-hdc',
    group: 'toolchain',
    title: 'hdc',
    level: 'warn',
    appliesTo: (ctx) => has(ctx, 'harmony'),
    run(ctx) {
      const ev = ctx.runCmd('hdc', ['-v'], { timeoutMs: 4000 })
      // 版本门槛 ≥ 3.2.0d（旧版与 HarmonyOS 7 协议不兼容）
      const m = (ev.stdout ?? ev.stderr ?? '').match(/(\d+\.\d+\.\d+)/)
      const ver = m ? m[1] : null
      if (ev.exitCode === 0 && ver) {
        const [a, b] = ver.split('.').map(Number)
        const okVer = a > 3 || (a === 3 && b >= 2)
        return okVer
          ? ok('toolchain/harmony-hdc', 'hdc', ver)
          : fail({ checkId: 'toolchain/harmony-hdc', level: 'warn', code: 'PT-EE-013', title: 'hdc 版本过低', expected: '≥ 3.2.0d', actual: ver, fix: { command: 'export PATH="$DEVECO_SDK_HOME/../hdc:$PATH"  # 用 DevEco Studio 自带的 hdc', description: '旧版 hdc 与 HarmonyOS 7 设备协议不兼容' }, evidence: [ev] })
      }
      return fail({ checkId: 'toolchain/harmony-hdc', level: 'warn', code: 'PT-EE-013', title: 'hdc 不可用', expected: 'DevEco 自带 hdc ≥ 3.2.0d', actual: ev.note ?? '不可用', evidence: [ev] })
    },
  },
  {
    id: 'toolchain/wechat-devtools',
    group: 'toolchain',
    title: '微信开发者工具 CLI',
    level: 'warn',
    appliesTo: (ctx) => has(ctx, 'skyline'),
    run(ctx) {
      // 复用 mp-e2e 的探测（默认路径表已在其中；零逻辑复制）
      const ide = resolveMpIdeCli()
      const cand = ide ?? process.env.PROTEUS_IDE_CLI ?? '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
      return ide
        ? ok('toolchain/wechat-devtools', '微信开发者工具 CLI', ide)
        : fail({ checkId: 'toolchain/wechat-devtools', level: 'warn', code: 'PT-EE-010', title: '微信开发者工具 CLI 未探测到', expected: 'PROTEUS_IDE_CLI 或其默认路径命中', actual: '未找到', fix: { command: 'export PROTEUS_IDE_CLI=/path/to/wechatide' }, evidence: [{ command: `ls ${cand}`, note: ctx.exists(cand) ? '存在但探测未命中' : 'ENOENT' }] })
    },
  },
  {
    id: 'toolchain/js-engine',
    group: 'toolchain',
    title: 'JS 引擎（QuickJS）',
    level: 'warn',
    appliesTo: (ctx) => hasAny(ctx, ['android', 'harmony']),
    run(ctx) {
      return hasToolsDir(ctx, 'quickjs')
        ? ok('toolchain/js-engine', 'JS 引擎（QuickJS）', '.tools/quickjs 就位')
        : fail({ checkId: 'toolchain/js-engine', level: 'warn', code: 'PT-EE-007', title: 'JS 引擎（QuickJS）产物缺失', expected: '.tools/quickjs', actual: '不存在', fix: { command: '# QuickJS 由 CLI 随包提供（打包时自动就绪）；如需本机独立构建见 proteus doctor --verbose', description: 'JS 引擎产物（App 运行期用）' }, evidence: [{ command: 'ls .tools/quickjs', note: 'ENOENT' }] })
    },
  },
]
