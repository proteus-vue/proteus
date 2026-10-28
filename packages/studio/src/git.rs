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
    let empty = GitStatus { is_repo: false, branch: String::new(), ahead: 0, behind: 0, files: vec![] };
    let Some(text) = git(&["status", "--porcelain=v2", "--branch"]) else {
        return empty;
    };
    let mut st = GitStatus { is_repo: true, branch: String::new(), ahead: 0, behind: 0, files: vec![] };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            st.branch = rest.trim().to_string();
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
    st
}

/// 取某个文件在 HEAD 里的内容（用于"与 HEAD 比较"）；未跟踪/不存在 ⇒ None。
pub fn git_head(path: String) -> Option<String> {
    git(&["show", &format!("HEAD:{path}")])
}
