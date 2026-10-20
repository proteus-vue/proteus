# 仓库体积治理 runbook

> ★决策 #1136 · 2026-10-20 · 触发：用户指出「仓库有 190MB 生成物 + 209MB 二进制被 git 跟踪，clone 体积偏大」

## 1. 已做完的部分（安全、无需决策）

| 动作 | 效果 |
|---|---|
| 修 `.gitignore` 根因（`target/` → `**/target-qjs/`） | 规则终于命中真实目录名 |
| `git rm -r --cached spike/target-qjs .cdp-shots`（727 文件） | **后续提交**不再包含这些产物 |
| 新增 `check:repo-hygiene` 门禁（接 CI + verify） | 防止再次漏网（含 6 条具名豁免） |

**★诚实边界**：`.git` **仍然是 1.2 GB**。`git rm --cached` 只影响新提交，
**历史里的 blob 一个都没少**——要真正瘦下来必须**重写历史**（见 §3）。

## 2. 体积账（取证结果）

`.git` 实际 **1.2 GB**（`size` 242 MiB + `size-pack` 526 MiB + 松散对象）。

历史 blob 按路径（去重后）：

| 类别 | 体积 | 说明 |
|---|---|---|
| `prebuilt` 的 `*.a` / `*.aar` | **574 MB** | ★**产品交付物**（CLI 随包发布的预编译运行时）。`.aar` 改过 **138 次**、`.a` 改过 **11 次** ⇒ 每次重建 +1.7MB / +32MB |
| `spike/target-qjs/` | **157 MB** | 垃圾（已 `rm --cached`，历史仍在） |
| `hosts/*/results/**` 真机证据 | **55 MB** | ★**有意入库**（项目纪律：判据证据可追溯） |
| `.cdp-shots/` | **25 MB** | 垃圾（已 `rm --cached`，历史仍在） |

**用户提到的「209MB 二进制」**：当前被跟踪的构建/预编译二进制只剩 **33.9 MB**
（`prebuilt/harmony` 的 `.a` 32.2MB + `prebuilt/android` 的 `.aar` 1.7MB）。
209MB 那个数应该是**清理前 + 含历史版本**的口径。

## 3. 历史重写（**需要你决策**）

### 3.1 选项 A：只清垃圾（推荐先做）

回收 **~182 MB**（157 + 25），`.git` 约 1.2 GB → 1.0 GB。

```bash
brew install git-filter-repo          # 本机未装（已确认）
git filter-repo \
  --path spike/target-qjs \
  --path .cdp-shots \
  --invert-paths --force
git remote add origin git@github.com:proteus-vue/proteus.git   # filter-repo 会移除 remote
git push --force --all && git push --force --tags
```

**代价（必须接受才做）**：
- **所有 commit sha 改变** ⇒ 所有克隆必须重新拉取；PR/issue 里的 sha 引用失效；
- 其他人的本地分支会**分叉**（他们需要 `git fetch && git reset --hard origin/main`）；
- 备份：重写前 `git clone --mirror` 一份到本地/别处。

### 3.2 选项 B：A + 二进制转 LFS

在上面基础上回收 **~574 MB**，`.git` 约 1.2 GB → **~0.5 GB**。

```bash
brew install git-lfs && git lfs install
git lfs track "*.a" "*.aar"
git lfs migrate import --include="*.a,*.aar" --everything
git push --force --all
```

**代价（比 A 更重）**：
- **每个克隆必须装 `git-lfs`**，否则只拿到指针文件（构建直接失败）；
- GitHub LFS 免费额度 **1 GB 存储 / 1 GB 月流量**——本仓历史 574MB，
  加上后续每月重建（`.aar` 几乎每个能力改动都重编）**会持续消耗流量**，需评估是否升付费；
- CI 也要装 LFS（`actions/checkout` 需 `lfs: true`）。

### 3.3 选项 C：不动历史

保持现状。**后续提交不再增长**（门禁兜住），但 `.git` 恒定 1.2 GB，每个新克隆都要下 1.2 GB。

**在正式改之前，还有一个更便宜的方向值得先评估**：
`.aar` 改了 **138 次**——如果它是**可复现构建**（同一源码 ⇒ 同一字节），
那 574MB 里绝大部分是"同一内容的重复副本"，压缩后其实不大；
但如果是**非确定性构建**（时间戳/路径进二进制），每次都产生全新 blob ⇒ LFS 也救不了历史，
**唯一的根治是"不要提交构建产物"**（改成发布时构建 / CI 产出 artifact）。

⇒ **建议先做这一条取证**再决定 A/B/C（见 §4）。

## 4. 已取证（决定 A/B/C 的依据）

**① `.aar` 的差异是真实代码改动，不是构建不确定性**（2026-10-20 实测）：
取相邻两版（`3df9464b` vs `a61be4f5`）解包逐文件比对——`AndroidManifest.xml` / `R.txt` / `jni/` **完全一致**，
只有 `classes.jar` 里 7 个 class 不同，且正是那两个决策改的文件：
`DeviceCapability`（#1080 设备域）/ `KeyboardProbe`·`KeyboardWatcher`（#1069 键盘通道）。

⇒ **含义（对方案选择很关键）**：
  · 历史里的 138 个 `.aar` 版本**不是"同一内容的重复副本"**，`git gc`/去重救不了；
  · LFS 迁移会原样存 138 × ~1.7MB ≈ **222MB**（`.a` 11 × 32MB ≈ 351MB）⇒ 与估算一致；
  · **真正的根治是"不提交构建产物"**：让 CI/发布流程产出，仓库只存源码 + 一个版本号；
    但这会改变"外部用户只装 npm 包即可用"的现状（#666 的初衷），属**产品决策**，不是仓库卫生问题。

**② 仍待评估**：`git verify-pack -v .git/objects/pack/*.idx | sort -k3 -rn | head -20`
看 pack 内实际占用（.aar 是已压缩的 zip ⇒ 二次压缩率低，接近原体积）。

## 5. 决策记录与执行结果

### 2026-10-20 · §1 已完成（安全部分 + 门禁）
修 `.gitignore` 根因 · `rm --cached` 727 文件 · `check:repo-hygiene` 门禁 · `scripts/*.mjs` 语法检查。

### 2026-10-20 · **选项 A 已执行**（用户决定）

```bash
# ① 备份（必做，已验证可回滚）
git clone --mirror . ../proteus-pre-filter.git   # 418MB · 2491 提交 · 101 tag · HEAD 一致

# ② 重写
brew install git-filter-repo
git filter-repo --path spike/target-qjs --path .cdp-shots --invert-paths --force

# ③ 清本地残留（不做这步 .git 会回到 1.2G——reflog 仍持有旧对象）
git reflog expire --expire=now --all && git gc --prune=now --aggressive

# ④ 强推（filter-repo 会移除 origin，需先恢复）
git remote add origin git@github.com:proteus-vue/proteus.git
git push --force origin main
git push --force origin --tags        # 101 个 tag 的 sha 也全变了，必须一起推
```

**实测结果（2026-10-20）**：

| 指标 | 重写前 | 重写后 | 备注 |
|---|---|---|---|
| **远端全新 clone** | ~839 MB | **371 MB** | 实测（clone 后 du -sh .git），回收 **468 MB** |
| 本地 `.git` | 1.2 GB | **826 MB** | 含 reflog 清理后 |
| `size-pack` | 526 MiB | **337.6 MiB** | |
| `main` 提交数 | 1812 | **1812** | 不变 |
| tag 数 | 101 | **101** | 不变 |
| 垃圾目录在 HEAD/历史 | 727 文件 | **0** | |
| `pnpm test` | 6447 | **6447 全绿** | 重写后复跑 |

**比估算多回收了 ~280MB**（估 182MB，实收 468MB）：因为 `.rlib`/二进制在 pack 里是
独立存储、几乎不可压缩，而估算按文件大小算没算进它们对 pack 的完整占用。

**踩到的坑（已写进上面的脚本注释）**：
1. `git filter-repo` 会**移除 origin remote**（防止误推到旧历史）⇒ 必须重新 `remote add`；
2. 重写后本地 `.git` 一度回到 1.2GB——**reflog 仍持有旧历史**（`git reflog --all` 里 2 条引用）
   ⇒ 必须 `reflog expire --expire=now --all` + `gc --prune=now`；
3. **tag 的 sha 也全变了** ⇒ 只推 `main` 不够，必须 `--tags`（否则 101 个 tag 指向旧对象）；
4. 全新克隆里 `git rev-list --all --count` 是 **2489** 而本地 2491——差异是**游离 tag 独有的提交**，
   `main` 上 1812 两边完全一致 ⇒ 克隆完整，不是丢提交。

### 其他人/其他机器需要做什么（必须告知团队）

因为历史被重写，**所有已有克隆都失效**（旧的 `main` 与远端已无共同祖先）：

```bash
# 方式一（推荐）：重新克隆
cd .. && rm -rf proteus && git clone git@github.com:proteus-vue/proteus.git

# 方式二（保留本地未提交改动）：
git fetch origin && git reset --hard origin/main
git remote prune origin
git tag -l | xargs -n 1 git tag -d && git fetch --tags --force   # 旧 tag 必须删后重取
```

**影响面（如实）**：所有 PR/issue 里引用的旧 commit sha 失效；fork 需重新同步；
CI 的历史缓存全部作废（下一次 CI 会重新拉全量）。

### 备份保留

`/Volumes/data1/work/office/debug/proteus-pre-filter.git`（418MB，mirror）——
**确认一切正常后再删**。回滚方式：

```bash
cd .. && mv proteus proteus-broken && git clone proteus-pre-filter.git proteus
cd proteus && git push --force origin main && git push --force origin --tags
```

### 仍未做的

- **选项 B（LFS）**：可再回收 ~190 MB，但需评估 GitHub LFS 配额
  （免费 1GB 存储 / 1GB 月流量，而 `.aar` 几乎每个能力改动都重编）。
- **根治 574MB 产品产物**：需先回答"外部用户只装 CLI 如何拿到预编译运行时"（#666 的初衷）。
  已取证：历史的 138 个 `.aar` **不是同内容重复副本**（相邻两版解包后 `classes.jar` 里 7 个 class
  确实不同，正是 #1080/#1069 改的文件）⇒ 去重/LFS 都只能原样存，**唯一根治是不提交构建产物**。
