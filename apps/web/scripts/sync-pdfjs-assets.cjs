/**
 * postinstall 脚本:从 pdfjs-dist 同步 worker、cmaps 和 standard_fonts 到 public/pdfjs。
 *
 * 为什么:中文 PDF 渲染必须加载 cmaps(CJK 字符映射),否则中文显示为方块。
 * 这些文件(1 个 worker + 169 个 cmap + 16 个字体)体积大、是第三方产物,不应进 git。
 * 每次 pnpm install 后自动同步,保证本地/Docker/CI 一致。
 *
 * 失败不阻断 install(打印警告即可),因为开发时不一定需要 PDF 预览。
 */
const fs = require("fs");
const path = require("path");

function findPdfjsDist() {
  // pnpm 把包放在 .pnpm/{name}@{ver}/node_modules/{name}
  const pnpmDir = path.join(__dirname, "..", "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith("pdfjs-dist@")) {
        const candidate = path.join(
          pnpmDir,
          entry,
          "node_modules",
          "pdfjs-dist",
        );
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  // npm/yarn flat 布局
  const flat = path.join(__dirname, "..", "node_modules", "pdfjs-dist");
  if (fs.existsSync(flat)) return flat;
  return null;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      count += copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

const pdfjsDir = findPdfjsDist();
if (!pdfjsDir) {
  console.warn("[postinstall] pdfjs-dist 未找到,跳过 cmaps 同步(可选依赖)");
  process.exit(0);
}

const publicPdfjs = path.join(__dirname, "..", "public", "pdfjs");
const cmapCount = copyDir(
  path.join(pdfjsDir, "cmaps"),
  path.join(publicPdfjs, "cmaps"),
);
const fontCount = copyDir(
  path.join(pdfjsDir, "standard_fonts"),
  path.join(publicPdfjs, "standard_fonts"),
);
const workerSource = path.join(pdfjsDir, "build", "pdf.worker.min.mjs");
let workerCount = 0;
if (fs.existsSync(workerSource)) {
  fs.mkdirSync(publicPdfjs, { recursive: true });
  fs.copyFileSync(workerSource, path.join(publicPdfjs, "pdf.worker.min.mjs"));
  workerCount = 1;
} else {
  console.warn("[postinstall] pdfjs worker 未找到,PDF 预览将不可用");
}

console.log(
  `[postinstall] pdfjs 资源已同步:${workerCount} worker + ${cmapCount} cmaps + ${fontCount} fonts → public/pdfjs/`,
);
