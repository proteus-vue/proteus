#!/usr/bin/env python3
"""把二进制依赖的非系统 dylib 打进 .app（决策 #1184）。

【为什么必须做】`otool -L` 显示二进制硬链接到 `/opt/homebrew/opt/ffmpeg/lib/libav*.dylib`。
不打包 ⇒ **只有装了 Homebrew ffmpeg 且路径恰好相同的机器能跑**，"可分发"就是假的。
（实测闭包 69 个 dylib / 75.2MB —— 对一个开发者工具可接受。）

【做法（macOS 的标准手法）】
  ① 从可执行文件出发做 BFS，收集所有 /opt/homebrew、/usr/local 下的 dylib（递归）；
  ② 复制到 Contents/Frameworks/；
  ③ 用 `install_name_tool` 把每处绝对路径改成 `@rpath/<basename>`，并给每个 dylib 设 `-id`；
  ④ 给可执行文件加 `LC_RPATH = @executable_path/../Frameworks`
     （@rpath 的搜索路径来自主可执行文件，dyld 会对所有 @rpath 引用生效）；
  ⑤ 改过的 dylib 签名会失效 ⇒ 逐个 ad-hoc 重签。

【不做的事】不 strip、不重排、不动 ffmpeg 自身特性集——只解决"找不到库"。
"""
import os
import shutil
import subprocess
import sys

SYSTEM_PREFIXES = ('/usr/lib/', '/System/', '/Library/Apple/')
# ★Homebrew 的库不全是绝对路径引用：有些（如 libsharpyuv）是以 `@rpath/libX.dylib` 写进
#   libwebp 的依赖里的。只认绝对路径会漏掉它们 ⇒ 打出来的包启动就 `Library not loaded`。
SEARCH_DIRS = ['/opt/homebrew/lib', '/usr/local/lib']


def build_index():
    """basename → 真实路径（Homebrew 的 lib 目录 + 各 formula 的 opt/*/lib）。"""
    idx = {}
    for d in SEARCH_DIRS:
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            p = os.path.join(d, name)
            if name.endswith('.dylib') and os.path.isfile(p) and name not in idx:
                idx[name] = p
    opt = '/opt/homebrew/opt'
    if os.path.isdir(opt):
        for formula in os.listdir(opt):
            lib = os.path.join(opt, formula, 'lib')
            if not os.path.isdir(lib):
                continue
            for name in os.listdir(lib):
                p = os.path.join(lib, name)
                if name.endswith('.dylib') and os.path.isfile(p) and name not in idx:
                    idx[name] = p
    return idx


def resolve(dep, referrer, index):
    """把一条依赖解析成磁盘路径；解析不了返回 None（系统库或缺失）。"""
    if dep.startswith(SYSTEM_PREFIXES):
        return None
    if dep.startswith('/opt/homebrew/') or dep.startswith('/usr/local/'):
        return dep if os.path.exists(dep) else None
    if dep.startswith('@rpath/'):
        return index.get(os.path.basename(dep))
    if dep.startswith('@loader_path/'):
        p = os.path.join(os.path.dirname(referrer), dep[len('@loader_path/'):])
        return p if os.path.exists(p) else None
    return None


def otool_deps(path):
    out = subprocess.run(['otool', '-L', path], capture_output=True, text=True)
    if out.returncode != 0:
        return []
    deps = []
    for line in out.stdout.splitlines()[1:]:
        dep = line.strip().split(' (')[0].strip()
        if dep:
            deps.append(dep)
    return deps


def is_external(dep):
    """需要重写的引用：绝对 Homebrew 路径，或 @rpath/@loader_path（它们指不到包内）。"""
    return (
        dep.startswith('/opt/homebrew/')
        or dep.startswith('/usr/local/')
        or dep.startswith('@rpath/')
        or dep.startswith('@loader_path/')
    )


def main():
    if len(sys.argv) < 2:
        print('用法：bundle-dylibs.py <App.app>')
        return 2
    app = sys.argv[1].rstrip('/')
    macos = os.path.join(app, 'Contents', 'MacOS')
    frameworks = os.path.join(app, 'Contents', 'Frameworks')
    exe_name = os.listdir(macos)[0]
    exe = os.path.join(macos, exe_name)

    # ① BFS 收集闭包（含 @rpath 引用的库——它们要靠索引反查真实路径）
    index = build_index()
    seen, queue, order, missing = set(), [exe], [], []
    while queue:
        cur = queue.pop()
        if cur in seen or not os.path.exists(cur):
            continue
        seen.add(cur)
        for dep in otool_deps(cur):
            if not is_external(dep):
                continue
            real = resolve(dep, cur, index)
            if real is None:
                missing.append((cur, dep))
                continue
            if real not in seen:
                queue.append(real)
                order.append(real)
    if missing:
        print('⚠ 有依赖解析不到（可能确实缺失）：')
        for owner, dep in missing[:5]:
            print(f'   {os.path.basename(owner)} → {dep}')

    if not order:
        print('✓ 无外部依赖，跳过')
        return 0

    os.makedirs(frameworks, exist_ok=True)
    by_base = {}
    for dep in order:
        base = os.path.basename(dep)
        by_base[base] = dep
        dst = os.path.join(frameworks, base)
        if not os.path.exists(dst):
            shutil.copy2(dep, dst)
            os.chmod(dst, 0o755)

    # ③ 改引用 + 设 id
    changed = 0
    for base in by_base:
        target = os.path.join(frameworks, base)
        for dep in otool_deps(target):
            if is_external(dep):
                new = f'@rpath/{os.path.basename(dep)}'
                if dep != new:   # 已经是 @rpath/foo 的不必再改
                    subprocess.run(['install_name_tool', '-change', dep, new, target],
                                   check=False, capture_output=True)
                    changed += 1
        subprocess.run(['install_name_tool', '-id', f'@rpath/{base}', target], check=False, capture_output=True)

    for dep in otool_deps(exe):
        if is_external(dep):
            new = f'@rpath/{os.path.basename(dep)}'
            if dep != new:
                subprocess.run(['install_name_tool', '-change', dep, new, exe], check=False, capture_output=True)
                changed += 1

    # ④ rpath（幂等：先删再加，避免重复 entry）
    subprocess.run(['install_name_tool', '-delete_rpath', '@executable_path/../Frameworks', exe],
                   check=False, capture_output=True)
    subprocess.run(['install_name_tool', '-add_rpath', '@executable_path/../Frameworks', exe],
                   check=False, capture_output=True)

    # ⑤ 改过的 dylib 必须重签（否则 macOS 会直接拒绝加载）
    for base in by_base:
        subprocess.run(['codesign', '--force', '--sign', '-', os.path.join(frameworks, base)],
                       check=False, capture_output=True)

    # 收尾判据有两条，缺一不可：
    #   ① 可执行文件里不能再有**绝对** Homebrew 路径（否则换台机器就找不到）；
    #   ② 每条 `@rpath/x` 都必须在 Frameworks/ 里真的有 x（否则启动即 Library not loaded）。
    abs_left = [d for d in otool_deps(exe) if d.startswith('/opt/homebrew/') or d.startswith('/usr/local/')]
    rpath_deps = [d for d in otool_deps(exe) if d.startswith('@rpath/')]
    not_in_bundle = [d for d in rpath_deps if not os.path.exists(os.path.join(frameworks, os.path.basename(d)))]
    size = sum(os.path.getsize(os.path.join(frameworks, b)) for b in by_base)
    print(f'✓ 打包 {len(by_base)} 个 dylib（{size / 1e6:.1f} MB），改写 {changed} 处引用')
    print(f'  @rpath 依赖 {len(rpath_deps)} 条，全部在包内：{"是" if not not_in_bundle else "否"}')
    bad = abs_left + not_in_bundle
    if bad:
        print('✗ 仍有问题：')
        for d in bad:
            print('   ', d)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
