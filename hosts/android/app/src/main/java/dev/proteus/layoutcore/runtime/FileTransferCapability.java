package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/FileTransferCapability.java
// ★★★决策 #1095（2026-10-19）：C29/C30 上传/下载的 **Android 文件系统腿**
//   （`fs.writeBytes` / `fs.readBytes` / `fs.remove`）。
//
// 【为什么需要】App 端没有 wx 的 uploadFile/downloadFile；上传/下载靠 `http.request` 的字节腿
//   收发**裸字节**，而"字节 ↔ 文件"必须由宿主做（JS 侧没有文件系统）。
//
// 【沙箱（G-49 的同一条纪律：deny-by-default）】
//   · 所有路径都相对 **app 私有目录**（`context.getFilesDir()`），**不接受绝对路径**；
//   · 任何 `..` 段一律拒绝（防目录穿越）——不做"规范化后放行"的宽松判断；
//   · 目录不存在 ⇒ 自动创建（只创建沙箱内的）。
//
// 【诚实边界】
//   · 整块读写（byte[] 一次性进内存）——与本单 JS 侧的实现一致；大文件分块协议属后续批次。
//   · 写入是**覆盖**语义（与 wx `writeFile` 一致）；不做原子替换（.tmp + rename）——
//     中断可能留半截文件。★已在能力页端边界写明。
//   · `fs.remove` 幂等：不存在也算成功（与 wx `unlink` 的 "file not found" 报错不同——
//     这里选幂等，因为上传/下载的清理路径不该因"文件已不在"而失败）。

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

public final class FileTransferCapability {

    private static final String TAG = "proteus-fs";

    private FileTransferCapability() { }

    /**
     * 把沙箱相对路径解析成 File。
     *
     * @throws IllegalArgumentException 路径非法（绝对路径 / 含 `..` / 空）
     */
    /**
     * ★#1119：由 private 放宽到 package-private —— `HttpCapability` 的落盘路径**必须复用本校验**。
     *   ★为什么不能各写一份：沙箱校验（拒绝绝对路径 / `..`）一旦分叉，迟早有一边漏。
     */
    static File resolve(Context ctx, String path) {
        if (path == null || path.isEmpty()) throw new IllegalArgumentException("fs: path 为空");
        if (path.startsWith("/")) throw new IllegalArgumentException("fs: 只接受沙箱相对路径（收到绝对路径 " + path + "）");
        for (String seg : path.split("/")) {
            if ("..".equals(seg)) throw new IllegalArgumentException("fs: 路径不得含 '..'（拒绝目录穿越）：" + path);
        }
        File root = ctx.getFilesDir();
        return new File(root, path);
    }

    /** `fs.writeBytes`：`{ path, bytes: number[] }` → `{ path, size }`（覆盖写）。 */
    public static JSONObject writeBytes(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        JSONArray arr = args.optJSONArray("bytes");
        if (arr == null) throw new IllegalArgumentException("fs.writeBytes 需要 { path, bytes: number[] }");
        File f = resolve(ctx, path);
        File parent = f.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("fs.writeBytes 无法创建目录：" + parent);
        }
        byte[] buf = new byte[arr.length()];
        for (int i = 0; i < buf.length; i++) buf[i] = (byte) arr.optInt(i, 0);
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(buf);
            out.flush();
        }
        JSONObject o = new JSONObject();
        o.put("path", path);
        o.put("size", buf.length);
        return o;
    }

    /** `fs.readBytes`：`{ path }` → `{ bytes: number[], size }`。 */
    public static JSONObject readBytes(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        if (!f.isFile()) throw new IOException("fs.readBytes: 文件不存在 " + path);
        long len = f.length();
        // ★上限保护：一次读进 JS 内存，超过 64 MiB 直接拒绝（避免把宿主/引擎打爆）
        final long MAX = 64L * 1024 * 1024;
        if (len > MAX) throw new IOException("fs.readBytes: 文件过大（" + len + "B > " + MAX + "B）——分块读取属后续批次");
        byte[] buf = new byte[(int) len];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        JSONArray arr = new JSONArray();
        for (byte b : buf) arr.put(b & 0xFF);
        JSONObject o = new JSONObject();
        o.put("bytes", arr);
        o.put("size", buf.length);
        return o;
    }

    /**
     * ★★★#1226 `fs.exists`：`{ path }` → `{ exists, isFile, isDir }`
     *   为 `getFileSystem` 的基础面补上最后一个方法（现有 fs.* 已有 read/write/remove）。
     *   ★**路径非法仍拒**（复用 `resolve` 的沙箱校验——不开第二份）；“不存在”不是错误，回 exists=false。
     */
    public static JSONObject exists(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        JSONObject o = new JSONObject();
        o.put("exists", f.exists());
        o.put("isFile", f.isFile());
        o.put("isDir", f.isDirectory());
        return o;
    }

    /** `fs.remove`：`{ path }` → `{}`（**幂等**：不存在也算成功）。 */
    public static JSONObject remove(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        if (f.exists() && !f.delete()) {
            // ★删除失败要如实报错（不能静默当成功——清理路径失败会让磁盘悄悄涨）
            throw new IOException("fs.remove 删除失败：" + path);
        }
        return new JSONObject();
    }

    // ── ★★★#1227 `getFileSystem` **目录面**（stat/readdir/mkdir/rmdir）──
    //   ★沙箱校验全部走 `resolve()`（不开第二份——#1212：两份沙箱根必然漂移）。

    /** `fs.stat`：`{ path }` → FileStat（size/mode/时间/isFile/isDir）。
     *  ★诚实边界：`mode` 是**当前进程可见的 owner 权限近似**（canRead/canWrite/canExecute 拼成 0o400/0o200/0o100），
     *    不是完整 POSIX mode——App 沙箱里只有当前用户，完整 mode 无消费方；拿不到就不假装拿到。 */
    public static JSONObject stat(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        if (!f.exists()) throw new IOException("fs.stat: 不存在 " + path);
        JSONObject o = new JSONObject();
        o.put("size", f.length());
        int mode = 0;
        if (f.canRead()) mode |= 0x100;   // 0o400
        if (f.canWrite()) mode |= 0x80;   // 0o200
        if (f.canExecute()) mode |= 0x40; // 0o100
        o.put("mode", mode);
        long mtime = f.lastModified();
        // ★`lastAccessedTime`：Android 的 `File` **拿不到 atime**（只有 mtime）⇒ 回 0 并在文档登记，**不拿 mtime 冒充**
        o.put("lastAccessedTime", 0);
        o.put("lastModifiedTime", mtime);
        o.put("isDirectory", f.isDirectory());
        o.put("isFile", f.isFile());
        return o;
    }

    /** `fs.readdir`：`{ path }` → `{ entries: string[] }`（只返**名字**，不返绝对路径——与 wx 同形）。
     *  ★非目录 / 不存在 ⇒ **报错**（不返空数组：空数组会让业务以为"目录存在但是空的"）。 */
    public static JSONObject readdir(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File d = resolve(ctx, path);
        if (!d.isDirectory()) throw new IOException("fs.readdir: 不是目录 " + path);
        String[] names = d.list();
        if (names == null) throw new IOException("fs.readdir: 读目录失败 " + path);
        JSONArray arr = new JSONArray();
        for (String n : names) arr.put(n);
        JSONObject o = new JSONObject();
        o.put("entries", arr);
        return o;
    }

    /** `fs.mkdir`：`{ path, recursive? }` → `{}`。★**幂等**：已存在且是目录 ⇒ 成功（与 `mkdir -p` 同意）。
     *  已存在但是**文件** ⇒ 报错（不能把文件当目录用）。 */
    public static JSONObject mkdir(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        boolean recursive = args.optBoolean("recursive", false);
        File d = resolve(ctx, path);
        if (d.isDirectory()) return new JSONObject();   // 幂等
        if (d.exists()) throw new IOException("fs.mkdir: 同名文件已存在 " + path);
        boolean ok = recursive ? d.mkdirs() : d.mkdir();
        if (!ok && !d.isDirectory()) throw new IOException("fs.mkdir 失败：" + path);
        return new JSONObject();
    }

    /** `fs.rmdir`：`{ path, recursive? }` → `{}`。★**幂等**：不存在 ⇒ 成功。
     *  ★★关键：`File.delete()` **删不掉非空目录**（返 false）⇒ recursive 必须**自己递归**。
     *  ★**不跟随符号链接**（`listFiles`/`delete` 本身不跟随）⇒ 沙箱外的目标不会被误删。 */
    public static JSONObject rmdir(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        boolean recursive = args.optBoolean("recursive", false);
        File d = resolve(ctx, path);
        if (!d.exists()) return new JSONObject();   // 幂等
        if (!d.isDirectory()) throw new IOException("fs.rmdir: 不是目录 " + path + "（文件请用 fs.remove）");
        if (recursive) deleteTree(d);
        else if (!d.delete()) throw new IOException("fs.rmdir: 目录非空或删除失败 " + path);
        return new JSONObject();
    }

    /** 递归删子树（不跟随符号链接；任一制度失败 ⇒ 报错，不假装清完）。 */
    private static void deleteTree(File f) throws IOException {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) {
            if (k.isDirectory() && !java.nio.file.Files.isSymbolicLink(k.toPath())) deleteTree(k);
            else if (!k.delete()) throw new IOException("fs.rmdir: 删不掉 " + k.getName());
        }
        if (!f.delete()) throw new IOException("fs.rmdir: 删不掉目录 " + f.getName());
    }

    /** 诊断读数：沙箱根（判据确认"写到了哪里"）。 */
    public static String sandboxRoot(Context ctx) {
        return ctx.getFilesDir().getAbsolutePath();
    }
}
