// build/icon.svg（と小さいサイズ用の build/icon-small.svg）から、アプリとサイトで使うアイコンを作る
// 使い方: node scripts/make-icons.mjs
//   build/icon.png      1024px（electron-builder が Mac の .icns もここから作る）
//   build/icon.ico      Windows 用（16〜256px を 1 つにまとめたもの）
//   assets/icon.png     256px（アプリの窓・タスクバー用）
//   docs/favicon.ico / docs/favicon.png / docs/apple-touch-icon.png（サイト・README 用）
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const big = fs.readFileSync(path.join(root, 'build', 'icon.svg'));
const small = fs.readFileSync(path.join(root, 'build', 'icon-small.svg'));

// 32px 以下は簡略版の方がくっきり見える。SVG の幅（1024 / 64）に合わせて、2 倍の解像度で描いてから縮める
const render = (size) => {
  const [svg, width] = size <= 32 ? [small, 64] : [big, 1024];
  return sharp(svg, { density: (72 * size * 2) / width })
    .resize(size, size)
    .png()
    .toBuffer();
};

// PNG をそのまま入れる形式の ICO（Windows Vista 以降で使える）
function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const write = (rel, buf) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log(`${rel} (${buf.length} bytes)`);
};

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const ico = toIco(await Promise.all(icoSizes.map(async (size) => ({ size, data: await render(size) }))));

write('build/icon.png', await render(1024));
write('build/icon.ico', ico);
write('assets/icon.png', await render(256));
write('docs/favicon.ico', toIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await render(size) })))));
write('docs/favicon.png', await render(64));
write('docs/apple-touch-icon.png', await render(180));
