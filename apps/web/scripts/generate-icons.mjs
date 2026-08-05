import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const publicDir = path.join(root, "public");
const iconsDir = path.join(publicDir, "icons");
const sourcePath = path.join(publicDir, "icon.svg");
const svg = await fs.readFile(sourcePath, "utf8");

await fs.mkdir(iconsDir, { recursive: true });

function render(input, size, background) {
  return sharp(Buffer.from(input))
    .resize(size, size, { fit: "contain" })
    .flatten({ background })
    .png({ compressionLevel: 9, adaptiveFiltering: true });
}

const outputs = [
  path.join(iconsDir, "icon-192.png"),
  path.join(iconsDir, "icon-512.png"),
  path.join(iconsDir, "icon-maskable-512.png"),
  path.join(iconsDir, "shortcut-96.png"),
  path.join(publicDir, "apple-touch-icon.png"),
  path.join(publicDir, "favicon.ico"),
];

await render(svg, 192, "#fcfdff").toFile(outputs[0]);
await render(svg, 512, "#fcfdff").toFile(outputs[1]);
await render(svg, 96, "#fcfdff").toFile(outputs[3]);
await render(svg, 180, "#fcfdff").toFile(outputs[4]);

const invertedSvg = svg.replaceAll("#0f121a", "#f1f3f7");
const safeMark = await sharp(Buffer.from(invertedSvg))
  .resize(360, 360, { fit: "contain" })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: "#0d0f14",
  },
})
  .composite([{ input: safeMark, gravity: "centre" }])
  .removeAlpha()
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(outputs[2]);

const faviconSizes = [16, 32, 48];
const faviconPngs = await Promise.all(
  faviconSizes.map((size) => render(svg, size, "#fcfdff").toBuffer()),
);

// ICO stores a small directory followed by standard PNG payloads.
const headerSize = 6 + faviconPngs.length * 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(faviconPngs.length, 4);

let offset = headerSize;
faviconPngs.forEach((png, index) => {
  const entry = 6 + index * 16;
  const size = faviconSizes[index];
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});

await fs.writeFile(outputs[5], Buffer.concat([header, ...faviconPngs]));
await Promise.all(outputs.map((file) => fs.chmod(file, 0o644)));
