// git.rs —— Studio 的 **Git 只读**查询（决策 #1246 · 从 `main.rs` 抽出 #1344）
//
// 【为什么单列】`main.rs` 涨到 1103 行越过 `check:file-size` 的 1000 行硬上限。
//   Git 只读这一整块（`GitFile` / `GitStatus` / `git()` / `git_status()` / `git_head()`）
//   的职责与"窗口/画布/设备"完全无关，且它有一条**独立的安全边界**（见下），
//   写在一起容易在改窗口代码时被顺手放宽。
//
// 【★安全边界（勿改）】只跑三条**纯查询**命令：
//   `status --porcelain=v2 --branch`、`rev-parse --abbrev-ref`、`show HEAD:path`。
//   ★**不提供任何写操作**（stage/commit/checkout/push）—— 那是另一个层级的责任，
//   而且本仓纪律是"push 必须人工批准"，工具在这里就**不该有那个能力**。
//   ⇒ 新增 git 功能时先问：这是查询还是变更？变更一律不加。
//
// 【降级】git 不在 PATH / 不是仓库 / 命令非零退出，一律降级为 `is_repo:false`，不抛错
//   （读代码不受影响）。
use serde::Serialize;

#[derive(Serialize)]
pub struct GitFile {
    pub path: String,
    /// 'M' 修改 / 'A' 新增 / 'D' 删除 / 'R' 重命名 / '?' 未跟踪 / 'U' 冲突
    pub status: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    /// HEAD 短哈希（取 7 位）。空串 = 还没有任何提交（unborn 分支）
    pub head: String,
    /// HEAD 提交标题。空串 = 取不到（非仓库 / 无提交）
    pub subject: String,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitFile>,
}

/// 跑一条 git 命令（工作目录 = 仓库根）。失败/非零退出 ⇒ `None`（调用方降级，不抛错）。
fn git(args: &[&str]) -> Option<String> {
    let root = crate::fs_guard::repo_root().ok()?;
    let out = std::process::Command::new("git").args(args).current_dir(root).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// 仓库状态（`git status --porcelain=v2` 的解析结果）。
pub fn git_status() -> GitStatus {
    let empty = GitStatus {
        is_repo: false,
        branch: String::new(),
        head: String::new(),
        subject: String::new(),
        ahead: 0,
        behind: 0,
        files: vec![],
    };
    let Some(text) = git(&["status", "--porcelain=v2", "--branch"]) else {
        return empty;
    };
    let mut st = GitStatus {
        is_repo: true,
        branch: String::new(),
        head: String::new(),
        subject: String::new(),
        ahead: 0,
        behind: 0,
        files: vec![],
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            st.branch = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("# branch.oid ") {
            /* ★决策 #1477：HEAD 哈希本来就在 `status --branch` 的输出里，此前只是没解析。
               `(initial)` 表示还没有任何提交，如实留空（不拿 40 个 0 充数）。 */
            let oid = rest.trim();
            if oid != "(initial)" {
                st.head = oid.chars().take(7).collect();
            }
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(v) = part.strip_prefix('+') {
                    st.ahead = v.parse().unwrap_or(0);
                } else if let Some(v) = part.strip_prefix('-') {
                    st.behind = v.parse().unwrap_or(0);
                }
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            st.files.push(GitFile { path: path.to_string(), status: "?".into() });
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("u ") {
            // "1 XY sub mH mI mW hH hI path" —— 前两列是 XY，最后一段是路径
            // ★用 `rsplitn(2,' ')` 取**最后一段**当路径：porcelain v2 的字段数并不固定
            //   （重命名行会多两段），按段落索引会错位。含空格的路径被 git 加了引号，这里如实保留。
            let path = line.rsplitn(2, ' ').next().unwrap_or("").to_string();
            let xy = line.split(' ').nth(1).unwrap_or("..");
            let x = xy.chars().next().unwrap_or('.');
            let y = xy.chars().nth(1).unwrap_or('.');
            let code = if x == '.' { y } else { x };
            let status = match code {
                'A' => "A",
                'D' => "D",
                'R' | 'C' => "R",
                'U' => "U",
                'M' | 'T' => "M",
                _ => "M",
            };
            if !path.is_empty() {
                st.files.push(GitFile { path, status: status.into() });
            }
        }
    }

    /* 提交标题不在 `status` 的输出里，要单独一次 `git log`。
       ★**成本只在刷新时**（树加载 / 手动刷新）付一次，悬停读的是前端内存里的 `git` ref
         ⇒ "悬停零 I/O"成立。无提交（unborn）时不跑，省一次进程。 */
    if !st.head.is_empty() {
        st.subject = git(&["log", "-1", "--format=%s"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
    }
    st
}

/// 取某个文件在 HEAD 里的内容（用于"与 HEAD 比较"）；未跟踪/不存在 ⇒ None。
pub fn git_head(path: String) -> Option<String> {
    git(&["show", &format!("HEAD:{path}")])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 决策 #1477：`status --porcelain=v2 --branch` 的输出里**本来就有** `# branch.oid`，
    /// 此前只是没解析。这条判据锁住"悬停卡上的 HEAD 哈希与提交标题是真的"。
    ///
    /// ★不写"没有 git 就跳过"——那会让它在任何环境都绿（#1469 踩过"skip 也算 passed"）。
    ///   本仓测试本来就跑在 git 仓库里，取不到 `is_repo` 说明环境坏了，应当红。
    #[test]
    fn status_includes_head_and_subject() {
        let st = git_status();
        assert!(st.is_repo, "测试环境应当是一个 git 仓库（这台机器上一直是）");
        assert!(!st.branch.is_empty(), "分支名不该为空：{:?}", st.branch);
        assert_eq!(st.head.len(), 7, "HEAD 应取 7 位短哈希：{:?}", st.head);
        assert!(st.head.chars().all(|c| c.is_ascii_hexdigit()), "{:?}", st.head);
        assert!(!st.subject.is_empty(), "有 HEAD 的仓库必须能取到提交标题");
    }
}
