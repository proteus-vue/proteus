#!/usr/bin/env bash
# hosts/android/judge-glass-bleed.sh —— ★判据（任务 A）：**玻璃条是否透过胶囊**
#
# 固定场景（黑底 scroll=4600）按住「游戏」胶囊至 press 收敛，取：
#   ① 最终屏幕截图（胶囊所见最终像素）
#   ② 宿主 dump 的离屏复合层（= 内容 + 条真光学；内层胶囊的**采样源**）
# 然后由 python 按同一屏幕坐标**逐点对照**，判定：
#   · 复合层里有没有"条"（相对裸内容应有可测差异）；
#   · 胶囊内部像素是否 ≈ 复合层同位置像素（= 真的把条透出来了）；
# 输出一张**数字表**，不吃"目测"。
#
# 用法：bash hosts/android/judge-glass-bleed.sh [scrollY]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
OFF="${1:-4600}"
OUT="/tmp/glass-judge"
mkdir -p "$OUT"

[ -f "$APK" ] || { echo "✗ 缺 APK（先 build-and-run.sh --no-install）"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备"; exit 2; }

echo "==> 安装 + 启动（scroll=$OFF, glassdbg=1）"
"$ADB" install -r -t "$APK" >/dev/null 2>&1
"$ADB" shell am force-stop "$PKG"
"$ADB" logcat -c
"$ADB" shell am start -n "$PKG/.SuperappActivity" --es screen glass-nav --es scroll "0,$OFF" --es glassdbg 1 >/dev/null 2>&1
bash "$HERE/../../.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --cmd "\"$ADB\" logcat -d -s proteus:I | grep -q 'SUPERAPP_SCROLL_TEST'" --timeout 25 --interval 1 >/dev/null 2>&1 || true

# 按住，等到胶囊像素连续 3 拍稳定（press 收敛）
"$ADB" shell input motionevent DOWN 460 2255 >/dev/null 2>&1
prev=""; stable=0
for i in $(seq 1 20); do
  "$ADB" exec-out screencap -p > "$OUT/hold.png" 2>/dev/null
  cur="$(python3 -c "from PIL import Image;im=Image.open('$OUT/hold.png').convert('RGB');print(im.getpixel((465,2260)))" 2>/dev/null)"
  if [ "$cur" = "$prev" ]; then stable=$((stable+1)); else stable=0; fi
  prev="$cur"
  [ "$stable" -ge 3 ] && break
done
# 仍按住时取最终截图 + raw + geom（保证同一 press 状态）
"$ADB" exec-out screencap -p > "$OUT/final.png" 2>/dev/null
"$ADB" exec-out run-as "$PKG" cat files/glasslayer.raw > "$OUT/layer.raw" 2>/dev/null
"$ADB" logcat -d -s proteus-glass:I | grep GLASSDUMP | tail -1 > "$OUT/geom.txt"
"$ADB" shell input motionevent UP 460 2255 >/dev/null 2>&1
cat "$OUT/geom.txt"
echo "  raw 字节数：$(wc -c < "$OUT/layer.raw")"

python3 - "$OUT" <<'PY'
import sys, re, os, struct
d = sys.argv[1]
from PIL import Image
fin = Image.open(os.path.join(d,'final.png')).convert('RGB')
pf = fin.load()
raw = open(os.path.join(d,'layer.raw'),'rb').read()
w, h = struct.unpack_from('<ii', raw, 0)
px = struct.unpack_from('<%di' % (w*h), raw, 8)
def L(c): return 0.299*c[0]+0.587*c[1]+0.114*c[2]
def lb(x, y):
    v = px[y*w+x]
    return ((v>>16)&255, (v>>8)&255, v&255)
geom = open(os.path.join(d,'geom.txt')).read()
m = re.search(r'gx=(-?\d+) gy=(-?\d+) gw=(\d+) gh=(\d+)', geom)
gx, gy, gw, gh = map(int, m.groups())
caps = re.findall(r'n(\d+)=([\d.\-]+),([\d.\-]+),([\d.\-]+),([\d.\-]+) ov=([\d.]+) anc=(true|false)', geom)
bar = cap = None
for n,x,y,ww,hh,ov,anc in caps:
    if anc=='true': cap=(float(x),float(y),float(ww),float(hh))
    else: bar=(float(x),float(y),float(ww),float(hh))
mpr = re.search(r'press=([\d.]+)', geom)
print("几何：bar=", bar, " capsule=", cap, f" layer=({gx},{gy},{w},{h})", " press=", mpr.group(1) if mpr else "?")
if not (bar and cap): print("✗ 未解析 bar/capsule"); sys.exit(1)
bx,by,bw,bh = bar; cx,cy,cw,ch = cap
print(f"\n条 顶边 y={by:.0f}  底边 y={by+bh:.0f}（屏幕坐标）；胶囊 y={cy:.0f}..{cy+ch:.0f}")
print("\n列 x=465：屏幕最终像素 vs 复合层同位置像素（=胶囊采样源），Δ=final-layer 亮度差")
print(f"{'screenY':>8} {'final':>16} {'layer':>16} {'Δ':>7}")
for sy in range(int(by)-24, int(by+bh)+24, 6):
    ly = sy - gy
    if ly < 0 or ly >= h or sy < 0 or sy >= fin.height: continue
    f = pf[465, sy]; l = lb(465, ly)
    mark = ""
    if abs(sy-by)<10: mark="  <== 条顶边"
    if abs(sy-(by+bh))<10: mark="  <== 条底边"
    print(f"{sy:>8} {str(f):>16} {str(l):>16} {round(L(f)-L(l),1):>7}{mark}")
caps_cols = [pf[465,sy] for sy in range(int(cy)+8,int(cy+ch)-8,6) if 0<=sy<fin.height]
lay_cols  = [lb(465,sy-gy) for sy in range(int(cy)+8,int(cy+ch)-8,6) if 0<=sy-gy<h]
print("\n=== 判定（胶囊内部 vs 采样源）===")
if caps_cols and lay_cols:
    dc = sum(abs(L(a)-L(b)) for a,b in zip(caps_cols,lay_cols))/len(caps_cols)
    print(f"平均亮度差 Δ = {dc:.1f}   (小=胶囊≈采样源=真的透出；大=胶囊自己又改了)")
    print(f"胶囊内部亮度范围 {min(L(c) for c in caps_cols):.0f}..{max(L(c) for c in caps_cols):.0f}"
          f"  |  采样源同位置 {min(L(c) for c in lay_cols):.0f}..{max(L(c) for c in lay_cols):.0f}")
# 条自身：跨条顶边是否有可测跳变（在**无胶囊**的 x=150 列）
print("\n=== 采样源里「条」是否存在（x=150，无胶囊）===")
for sy in range(int(by)-16, int(by+bh)+16, 6):
    ly = sy - gy
    if 0 <= ly < h and 0 <= sy < fin.height:
        print(f"  y={sy}: 屏幕={pf[150,sy]} 采样源={lb(150,ly)}")
PY
echo
echo "存证：$OUT/{final.png,layer.png,geom.txt}"
