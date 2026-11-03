// GLB の中身（アニメーション・モーフ・ボーン）を一覧表示する
// 使い方: node scripts/inspect-glb.mjs <file.glb>
import fs from 'fs';

const buf = fs.readFileSync(process.argv[2]);
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('GLB ではありません');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

console.log('generator:', gltf.asset?.generator, '/ extensions:', gltf.extensionsUsed || []);
console.log('scenes:', gltf.scenes?.length, 'nodes:', gltf.nodes?.length, 'meshes:', gltf.meshes?.length,
  'materials:', gltf.materials?.length, 'textures:', gltf.textures?.length);

console.log('\n# animations');
for (const a of gltf.animations || []) {
  const acc = gltf.accessors[a.samplers[0]?.input];
  console.log(`- ${a.name || '(no name)'}: channels=${a.channels.length} duration=${acc?.max?.[0]?.toFixed(2)}s`);
}

console.log('\n# morph targets');
for (const m of gltf.meshes || []) {
  const n = m.primitives[0]?.targets?.length || 0;
  if (!n) continue;
  const names = m.extras?.targetNames || m.primitives[0]?.extras?.targetNames || [];
  console.log(`- mesh "${m.name}": ${n} targets ${names.length ? JSON.stringify(names) : '(名前なし)'}`);
}

console.log('\n# skins');
for (const s of gltf.skins || []) {
  const names = s.joints.map((j) => gltf.nodes[j].name);
  console.log(`- skin "${s.name}": ${names.length} joints`);
  console.log('  ', names.join(', '));
}
