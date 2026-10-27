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

    /**
     * ★★★#1237 `fs.appendBytes`：`{ path, bytes: number[] }` → `{ path, size, appended }`
     *   （**原生追加**：`FileOutputStream(f, true)` = `O_APPEND`；文件不存在则创建）。
     *
     * 【为什么必须是宿主方法（不是 JS 侧读全文再整写）】
     *   JS 侧"读全文 + 拼接 + 整写"在 `await` 边界会被别的写插入 ⇒ **并发下静默丢数据**。
     *   这是 `appendFile` 此前如实归 unsupported 的唯一原因，而它并不是"做不到"——
     *   宿主用 O_APPEND 打开就没有读-改-写窗口，也不必把整个文件读进 JS 堆。
     *
     * 【返回值语义】`size` = **追加后**的文件总大小，`appended` = 本次写入字节数。
     *   ★两者都给：只给 size 的话，调用方无法验证"确实是追加而不是覆盖"（#1228 摘要对拍同族口径）。
     */
    public static JSONObject appendBytes(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        JSONArray arr = args.optJSONArray("bytes");
        if (arr == null) throw new IllegalArgumentException("fs.appendBytes 需要 { path, bytes: number[] }");
        File f = resolve(ctx, path);
        File parent = f.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("fs.appendBytes 无法创建目录：" + parent);
        }
        byte[] buf = new byte[arr.length()];
        for (int i = 0; i < buf.length; i++) buf[i] = (byte) arr.optInt(i, 0);
        // ★append=true ⇒ O_APPEND 语义（内核保证每次写入落在当前文件尾，天然对多写者安全）
        try (FileOutputStream out = new FileOutputStream(f, true)) {
            out.write(buf);
            out.flush();
        }
        JSONObject o = new JSONObject();
        o.put("path", path);
        o.put("size", f.length());
        o.put("appended", buf.length);
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

    // ── ★★★#1228 `getFileSystem` **复合面**（copyFile/rename/getFileInfo）──
    //   ★★沙箱校验：`src` 与 `dest` **两端都**过 `resolve()`——只校验一端等于
    //     允许把沙箱外的文件拷进来 / 把沙箱内的文件拷出去。

    /** `fs.copy`：`{ src, dest }` → `{ dest, size }`。★**不覆盖已存在的 dest**（报错——静默覆盖 = 丢数据）。 */
    public static JSONObject copy(Context ctx, JSONObject args) throws Exception {
        String src = args.optString("src", "");
        String dest = args.optString("dest", "");
        File s = resolve(ctx, src);
        File d = resolve(ctx, dest);
        if (!s.isFile()) throw new IOException("fs.copy: 源不是文件 " + src);
        if (d.exists()) throw new IOException("fs.copy: 目标已存在 " + dest + "（拒绝静默覆盖）");
        File parent = d.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("fs.copy: 建目标目录失败");
        java.nio.file.Files.copy(s.toPath(), d.toPath(), java.nio.file.StandardCopyOption.COPY_ATTRIBUTES);
        JSONObject o = new JSONObject();
        o.put("dest", dest);
        o.put("size", d.length());
        return o;
    }

    /** `fs.rename`：`{ oldPath, newPath }` → `{ newPath }`。★目标已存在 ⇒ 报错（同 copy）。 */
    public static JSONObject rename(Context ctx, JSONObject args) throws Exception {
        String oldPath = args.optString("oldPath", "");
        String newPath = args.optString("newPath", "");
        File s = resolve(ctx, oldPath);
        File d = resolve(ctx, newPath);
        if (!s.exists()) throw new IOException("fs.rename: 源不存在 " + oldPath);
        if (d.exists()) throw new IOException("fs.rename: 目标已存在 " + newPath);
        if (!s.renameTo(d)) throw new IOException("fs.rename 失败：" + oldPath + " → " + newPath);
        JSONObject o = new JSONObject();
        o.put("newPath", newPath);
        return o;
    }

    /** `fs.getFileInfo`：`{ path, digestAlgorithm? }` → `{ size, digest }`。
     *  ★`digestAlgorithm` 默认 `sha256`；`md5` / `sha1` 也认。不认识的算法 ⇒ **报错**（不静默假设为 md5）。
     *  ★超大文件边读边算（不把整文件读进内存）——与 `fs.readBytes` 的 64 MiB 上限无关。 */
    public static JSONObject getFileInfo(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        String alg = args.optString("digestAlgorithm", "sha256").trim().toLowerCase();
        String jcaName;
        if ("sha256".equals(alg)) jcaName = "SHA-256";
        else if ("sha1".equals(alg)) jcaName = "SHA-1";
        else if ("md5".equals(alg)) jcaName = "MD5";
        else throw new IllegalArgumentException("fs.getFileInfo: 不支持的 digestAlgorithm「" + alg + "」（仅 sha256/sha1/md5）");
        File f = resolve(ctx, path);
        if (!f.isFile()) throw new IOException("fs.getFileInfo: 不是文件 " + path);
        java.security.MessageDigest md = java.security.MessageDigest.getInstance(jcaName);
        long total = 0;
        byte[] buf = new byte[64 * 1024];
        try (FileInputStream in = new FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) { md.update(buf, 0, n); total += n; }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b & 0xFF));
        JSONObject o = new JSONObject();
        o.put("size", total);
        o.put("digest", hex.toString());
        return o;
    }

    /** ★★★#1232 `fs.inflateRaw`：`{ bytes }` → `{ bytes, size }`（**裸 deflate**，ZIP 条目用）。
     *  ★★为什么只做裸解压、不做 unzip：ZIP 容器解析（EOCD/中央目录/local header + zip slip 校验）
     *    放**共享 JS 层一份** ⇒ 三端不会各写一套安全逻辑（zip slip 是最容易写错的地方）。
     *  ★上限：解压后 > 128 MiB ⇒ 报错（zip bomb 第一道闸在宿主，JS 层还有条目数/总量）。 */
    public static JSONObject inflateRaw(Context ctx, JSONObject args) throws Exception {
        JSONArray in = args.optJSONArray("bytes");
        if (in == null) throw new IllegalArgumentException("fs.inflateRaw 需要 { bytes: number[] }");
        byte[] src = new byte[in.length()];
        for (int i = 0; i < src.length; i++) src[i] = (byte) (in.optInt(i) & 0xFF);
        final long MAX_OUT = 128L * 1024 * 1024;
        // ★true = nowrap（裸 deflate）——ZIP 条目没有 zlib 头
        java.util.zip.Inflater inf = new java.util.zip.Inflater(true);
        try {
            inf.setInput(src);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream(Math.max(64, src.length * 3));
            byte[] buf = new byte[64 * 1024];
            while (!inf.finished()) {
                int n = inf.inflate(buf);
                if (n == 0) {
                    if (inf.needsInput() || inf.needsDictionary()) break;
                }
                bos.write(buf, 0, n);
                if (bos.size() > MAX_OUT) throw new IOException("fs.inflateRaw: 解压后超过 " + MAX_OUT + "B（可疑 zip bomb）");
            }
            byte[] out = bos.toByteArray();
            JSONArray arr = new JSONArray();
            for (byte b : out) arr.put(b & 0xFF);
            JSONObject o = new JSONObject();
            o.put("bytes", arr);
            o.put("size", out.length);
            return o;
        } finally {
            inf.end();
        }
    }

    /** ★★★#1229 `fs.unzip`：`{ zipPath, targetPath }` → `{ entries, bytes }`。
     *  ★★**zip slip 防护**：每个条目的落地路径**规范化后必须仍在目标目录之下**；
     *    否则条目名写成 `../../evil.sh` 就能写到沙箱外。
     *  ★**zip bomb 防护**：条目数 / 单条解压后大小 / 总解压大小 三个上限。
     *  ★加密条目：`ZipInputStream` 解不开 ⇒ **如实报错**（不静默产出空文件）。 */
    public static JSONObject unzip(Context ctx, JSONObject args) throws Exception {
        String zipPath = args.optString("zipPath", "");
        String targetPath = args.optString("targetPath", "");
        File zip = resolve(ctx, zipPath);
        File target = resolve(ctx, targetPath);
        if (!zip.isFile()) throw new IOException("fs.unzip: zip 不是文件 " + zipPath);
        if (!target.exists() && !target.mkdirs()) throw new IOException("fs.unzip: 建目标目录失败 " + targetPath);
        // ★规范化目标目录（后缀加 /，防 `foo` 与 `foobar` 前缀误判）
        final String targetRoot = target.getCanonicalPath() + File.separator;
        final int MAX_ENTRIES = 4096;
        final long MAX_ENTRY_BYTES = 128L * 1024 * 1024;
        final long MAX_TOTAL_BYTES = 512L * 1024 * 1024;
        int entries = 0;
        long total = 0;
        byte[] buf = new byte[64 * 1024];
        try (java.util.zip.ZipInputStream zin =
                     new java.util.zip.ZipInputStream(new java.io.BufferedInputStream(new FileInputStream(zip)))) {
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (++entries > MAX_ENTRIES) throw new IOException("fs.unzip: 条目超过 " + MAX_ENTRIES + "（可疑 zip bomb）");
                String name = e.getName();
                // ★★zip slip：解析后的 canonical 路径必须以目标目录为前缀
                File out = new File(target, name);
                String canon = out.getCanonicalPath();
                if (!canon.equals(target.getCanonicalPath()) && !canon.startsWith(targetRoot)) {
                    throw new IOException("fs.unzip: 条目越出目标目录（拒绝 zip slip）：" + name);
                }
                if (e.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) throw new IOException("fs.unzip: 建目录失败 " + name);
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("fs.unzip: 建父目录失败 " + name);
                long wrote = 0;
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) {
                        wrote += n;
                        total += n;
                        if (wrote > MAX_ENTRY_BYTES) throw new IOException("fs.unzip: 单条目超过 " + MAX_ENTRY_BYTES + "B（可疑 zip bomb）：" + name);
                        if (total > MAX_TOTAL_BYTES) throw new IOException("fs.unzip: 总解压量超过 " + MAX_TOTAL_BYTES + "B（可疑 zip bomb）");
                        fos.write(buf, 0, n);
                    }
                }
                zin.closeEntry();
            }
        }
        JSONObject o = new JSONObject();
        o.put("entries", entries);
        o.put("bytes", total);
        return o;
    }

    /** 诊断读数：沙箱根（判据确认"写到了哪里"）。 */
    public static String sandboxRoot(Context ctx) {
        return ctx.getFilesDir().getAbsolutePath();
    }
}
