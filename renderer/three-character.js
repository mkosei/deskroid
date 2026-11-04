// glTF / GLB / VRM の 3D モデルを表示するキャラクター。app.js の character と同じ形のオブジェクトを返す
// - VRM: 規格のボーン・表情（まばたき・笑顔・口の形）・視線・髪や服の揺れを使う
// - ボーン入りモデル（opts.rig あり）: 首・頭・目・胸・腕・口のボーンを動かす
// - ボーンの無い「置物」モデル（opts.headNodes）: 頭まわりの部品をまとめて回す
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
// 少し行き過ぎてから戻る（勢いのある上げ方）
const easeOutBack = (p) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
// 手を振る動きの強さ：さっと上げて、振って、ゆっくり下ろす
const waveEnvelope = (p) => (p < 0.18 ? easeOutBack(p / 0.18) : p > 0.8 ? ease((1 - p) / 0.2) : 1);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// 感情タグに対応する動き（config の expressions の値）
// 一回きりの動き: hop / jump / shake / nod / wave、続く姿勢: droop / tilt、元に戻す: idle
const ONE_SHOT = {
  hop: { dur: 0.8 },
  jump: { dur: 1.0 },
  startle: { dur: 0.9 },
  shake: { dur: 1.0 },
  nod: { dur: 0.9 },
  wave: { dur: 2.4 },
};
// 立ち姿。上腕（肩→ひじ）と前腕（ひじ→手首）が向く方向を、
// 左腕を基準に [外側, 上, 前] で書く（右腕は左右反転して使う）
// curl は指の曲げ具合（0=まっすぐ、1=ほぼ握りこぶし）
const ARM_POSES = {
  behind: { label: '手を後ろで組む', upper: [0.22, -1, -0.45], lower: [-0.55, -0.5, -0.6], curl: 0.5 },
  relaxed: { label: '自然体', upper: [0.18, -1, 0.12], lower: [0.07, -1, 0.35], curl: 0.35 },
  hips: { label: '腰に手', upper: [0.8, -0.75, -0.12], lower: [-0.5, -0.65, 0.05], curl: 0.8 },
};
const CURL_WEIGHTS = [0.55, 0.85, 0.65]; // 指の付け根・中・先の曲がり方の配分
const CROUCH_BEND = 0.65; // しゃがみきったときの、ももの曲げ角（ひざはその 2 倍）

const POSES = {
  idle: { pitch: 0, roll: 0 },
  droop: { pitch: 0.28, roll: 0 },
  tilt: { pitch: 0.05, roll: 0.22 },
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GLTFLoader はノード名の空白を _ に変え、重複には _数字 を付けるので、それを許して探す
function findNode(root, name) {
  if (!name) return null;
  const re = new RegExp(`^${escapeRe(name.replace(/\s/g, '_'))}(_\\d+)?$`);
  let hit = null;
  root.traverse((o) => { if (!hit && re.test(o.name)) hit = o; });
  return hit;
}

// ---------- ボーンの自動検出（VRM / Mixamo / 3ds Max Biped / Unity / Blender などの名前に対応） ----------

// 比較用に名前をそろえる："J_Bip_L_UpperArm" → "jbiplupperarm"、"Left arm_0391" → "leftarm"
const normName = (name) => name.replace(/_\d+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function sideParts(s) {
  const side = s === 'l' ? 'left' : 'right';
  return {
    UpperArm: [`${side}upperarm`, `${side}arm`, `${s}upperarm`, `upperarm${s}`, `upperarm${side}`],
    LowerArm: [`${side}forearm`, `${side}lowerarm`, `${side}elbow`, `${s}lowerarm`, `lowerarm${s}`, `forearm${s}`, `${s}forearm`],
    Hand: [`${side}hand`, `${side}wrist`, `${s}hand`, `hand${s}`],
    UpperLeg: [`${side}upleg`, `${side}upperleg`, `${side}thigh`, `${s}upperleg`, `upperleg${s}`, `thigh${s}`],
    LowerLeg: [`${side}lowerleg`, `${side}knee`, `${side}calf`, `${s}lowerleg`, `lowerleg${s}`, `calf${s}`, `shin${s}`],
    Foot: [`${side}foot`, `${side}ankle`, `${s}foot`, `foot${s}`],
    Eye: [`${side}eye`, `eye${s}`, `eye${side}`, `${s}faceeye`],
  };
}

function autoDetectRig(model) {
  const bones = [];
  model.traverse((o) => { if (o.isBone) bones.push({ o, n: normName(o.name) }); });
  // 末尾が一致する中で、名前がいちばん短いもの（"chest" と "upperchest" なら "chest"）
  const pick = (patterns, exclude = new Set()) => {
    for (const p of patterns) {
      const hits = bones.filter((b) => b.n.endsWith(p) && !exclude.has(b.o));
      if (hits.length) return hits.sort((a, b) => a.n.length - b.n.length)[0].o;
    }
    return null;
  };

  const rig = {
    hips: pick(['hips', 'pelvis']),
    spine: pick(['spine']),
    chest: pick(['chest', 'spine1', 'spine01']),
    neck: pick(['neck']),
    head: pick(['head']),
  };
  for (const [s, Side] of [['l', 'left'], ['r', 'right']]) {
    const p = sideParts(s);
    const key = (part) => `${Side}${part}`;
    rig[key('UpperArm')] = pick(p.UpperArm);
    rig[key('LowerArm')] = pick(p.LowerArm);
    rig[key('Hand')] = pick(p.Hand);
    // Mixamo の "LeftLeg" はすね、3ds Max 系の "Left leg" はもも、なので順番に探す
    let upperLeg = pick(p.UpperLeg);
    let lowerLeg = pick(p.LowerLeg);
    if (!upperLeg) upperLeg = pick([`${Side}leg`]);
    else if (!lowerLeg) lowerLeg = pick([`${Side}leg`], new Set([upperLeg]));
    rig[key('UpperLeg')] = upperLeg;
    rig[key('LowerLeg')] = lowerLeg;
    rig[key('Foot')] = pick(p.Foot);
    rig[key('Eye')] = pick(p.Eye);
  }
  for (const k of Object.keys(rig)) if (!rig[k]) delete rig[k];
  return rig;
}

// ---------- VRM ----------

// VRM は規格でボーンの役割が決まっているので、名前を推測せずにそのまま使う。
// 目は VRM の視線（lookAt）に任せるので含めない
const VRM_RIG_BONES = [
  'hips', 'spine', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

function vrmRig(vrm) {
  const rig = {};
  for (const name of VRM_RIG_BONES) {
    const node = vrm.humanoid.getRawBoneNode(name);
    if (node) rig[name] = node;
  }
  const chest = vrm.humanoid.getRawBoneNode('chest') || vrm.humanoid.getRawBoneNode('upperChest');
  if (chest) rig.chest = chest;
  return rig;
}

const VRM_FINGERS = [
  ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  ['IndexProximal', 'IndexIntermediate', 'IndexDistal'],
  ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'],
  ['RingProximal', 'RingIntermediate', 'RingDistal'],
  ['LittleProximal', 'LittleIntermediate', 'LittleDistal'],
];

function vrmFingers(vrm, side) {
  const chains = VRM_FINGERS.map((names) => names
    .map((n) => vrm.humanoid.getRawBoneNode(`${side}${n}`)).filter(Boolean));
  return chains.every((c) => c.length >= 2) ? chains : [];
}

// 感情タグ → VRM の表情（名前, 強さ）。VRM 0.x の joy / sorrow / fun は three-vrm が happy / sad / relaxed に読み替える
const VRM_FACES = {
  smile: [['happy', 1]],
  angry: [['angry', 0.9]],
  sad: [['sad', 0.9]],
  surprised: [['surprised', 1], ['aa', 0.3]],
  shy: [['happy', 0.4], ['relaxed', 0.4]],
};
const VRM_FACE_NAMES = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];

// 手のボーンの直下から、親指〜小指の付け根を名前で探し、3 節ずつたどる
function autoDetectFingers(hand) {
  if (!hand) return [];
  const kinds = [/thumb|finger0$/, /index|finger1$/, /middle|finger2$/, /ring|finger3$/, /little|pinky|finger4$/];
  const children = hand.children.filter((c) => c.isBone);
  const chains = kinds.map((re) => {
    const root = children.find((c) => re.test(normName(c.name)));
    const chain = [];
    for (let b = root; b && chain.length < 3; b = b.children.find((c) => c.isBone)) chain.push(b);
    return chain;
  });
  return chains.every((c) => c.length >= 2) ? chains : [];
}

export async function createGltfCharacter(canvas, url, opts = {}) {
  // 描く大きさは窓ではなくキャンバスの大きさ（吹き出しのために窓が上へ伸びても、キャラの大きさ・位置は変えない）
  const stageW = canvas.clientWidth || window.innerWidth;
  const stageH = canvas.clientHeight || window.innerHeight;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(stageW, stageH, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 3);
  scene.add(sun);

  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm || null;
  const model = vrm ? vrm.scene : gltf.scene;
  if (vrm) {
    VRMUtils.rotateVRM0(vrm); // VRM 0.x の後ろ向きのモデルをこちらに向ける
    // ボーンはこのファイルで直接動かすので、three-vrm には上書きさせない
    vrm.humanoid.autoUpdateHumanBones = false;
    model.traverse((o) => { o.frustumCulled = false; });
  }

  // Sketchfab の unlit 書き出しは色テクスチャを emissiveTexture に入れてくることがあるが、
  // three.js の unlit（MeshBasicMaterial）は emissive を描かないので通常のテクスチャに付け替える
  const { parser } = gltf;
  const fixes = [];
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mat of new Set(meshes.flatMap((o) => [].concat(o.material)))) {
    const def = parser.json.materials?.[parser.associations.get(mat)?.materials];
    const idx = def?.emissiveTexture?.index;
    if (idx === undefined || mat.map) continue;
    fixes.push(parser.getDependency('texture', idx).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.color.setRGB(...(def.emissiveFactor || [1, 1, 1]));
      mat.needsUpdate = true;
    }));
  }
  await Promise.all(fixes);

  // 武器などの不要な部品を外す（マテリアル名かメッシュ名に一致したもの）
  if (opts.hideMeshes?.length) {
    const re = new RegExp(opts.hideMeshes.map(escapeRe).join('|'), 'i');
    for (const o of meshes) {
      if ([].concat(o.material).some((m) => re.test(m.name)) || re.test(o.name)) o.removeFromParent();
    }
  }

  const holder = new THREE.Group();
  holder.add(model);
  scene.add(holder);
  // VRM 0.x のモデルは後ろ（-Z）を向いているので、こちらを向かせる（VRM として読めたときは rotateVRM0 済み）
  if (opts.rotationY !== undefined) model.rotation.y = opts.rotationY;
  else if (!vrm && parser.json.extensions?.VRM) model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);

  // ---------- ボーン ----------

  const rig = vrm ? vrmRig(vrm) : opts.rig === 'auto' ? autoDetectRig(model) : {};
  if (!vrm && opts.rig !== 'auto') {
    for (const [key, name] of Object.entries(opts.rig || {})) {
      const node = findNode(model, name);
      if (node) rig[key] = node;
      else console.warn(`[3d] ボーンが見つかりません: ${key}=${name}`);
    }
  }
  const hasRig = !!(rig.head || rig.neck);

  // 腕にぶら下がっている小物を体側のボーンに付け替える（腕を動かしても腰に留まるように）
  // 例: { "Tablet": "Hips" }
  for (const [childName, parentName] of Object.entries(opts.reparent || {})) {
    const child = findNode(model, childName);
    const parent = findNode(model, parentName);
    if (child && parent) parent.attach(child);
    else console.warn(`[3d] 付け替えできません: ${childName} → ${parentName}`);
  }

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();

  // ワールド座標での回転 q をボーンのローカル回転に掛ける（ボーンごとの軸の向きを気にしなくてよい）
  function rotateWorld(bone, q) {
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(qa);
    qb.copy(qa).invert().multiply(q).multiply(qa);
    bone.quaternion.premultiply(qb);
    bone.updateMatrixWorld(true);
  }

  // ボーン from → to の向きが、ワールド座標で target を向くように回す
  function pointBone(bone, child, target) {
    if (!bone || !child) return;
    model.updateMatrixWorld(true);
    bone.getWorldPosition(va);
    child.getWorldPosition(vb);
    const dir = vb.sub(va).normalize();
    rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(dir, target.clone().normalize()));
  }

  // 指：opts.fingers の接頭辞 + 番号（0=親指〜4=小指）で、各指の付け根から 3 節を探す
  // 例: "Bip001LFinger" → Bip001LFinger1, Bip001LFinger11, Bip001LFinger12（人差し指）
  function findFingers(prefix) {
    if (!prefix) return [];
    return [0, 1, 2, 3, 4].map((n) => [`${n}`, `${n}1`, `${n}2`]
      .map((s) => findNode(model, `${prefix}${s}`)).filter(Boolean));
  }
  const fingers = vrm
    ? { left: vrmFingers(vrm, 'left'), right: vrmFingers(vrm, 'right') }
    : opts.fingers === 'auto'
      ? { left: autoDetectFingers(rig.leftHand), right: autoDetectFingers(rig.rightHand) }
      : { left: findFingers(opts.fingers?.left), right: findFingers(opts.fingers?.right) };
  console.log(`[3d] fingers: left=${fingers.left.length ? 'ok' : 'なし'} right=${fingers.right.length ? 'ok' : 'なし'}`);

  // 読み込んだままの姿勢（A ポーズなど）。以後の動きはここからの差分で付ける
  const rest = new Map();
  for (const bone of [...Object.values(rig), ...fingers.left.flat(), ...fingers.right.flat()]) {
    rest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
  }

  // ---------- 立ち姿（腕のポーズ） ----------

  const armBones = [
    [rig.leftUpperArm, rig.leftLowerArm, rig.leftHand, 1, fingers.left],
    [rig.rightUpperArm, rig.rightLowerArm, rig.rightHand, -1, fingers.right],
  ].filter(([u, l]) => u && l);

  const wp = (o) => o.getWorldPosition(new THREE.Vector3());

  // 手のひらの向き（親指がある側）
  function palmNormal(hand, chains) {
    model.updateMatrixWorld(true);
    const h = wp(hand);
    const across = wp(chains[1][0]).sub(wp(chains[4][0]));
    const along = wp(chains[2][0]).sub(h).normalize();
    const palm = new THREE.Vector3().crossVectors(along, across).normalize();
    const thumb = wp(chains[0][chains[0].length - 1]).sub(h);
    if (thumb.dot(palm) < 0) palm.negate();
    return palm.multiplyScalar(opts.fingerCurlSign ?? 1);
  }

  // 親指以外の指を手のひら側へ曲げる
  function curlFingers(hand, chains, curl) {
    if (!hand || chains.length < 5 || chains.some((c) => !c.length) || !curl) return;
    const palm = palmNormal(hand, chains);

    for (const chain of chains.slice(1)) {
      chain.forEach((seg, i) => {
        const child = seg.children.find((c) => c.isBone) || seg.children[0];
        if (!child) return;
        model.updateMatrixWorld(true);
        const v = wp(child).sub(wp(seg)).normalize();
        const axis = new THREE.Vector3().crossVectors(v, palm).normalize();
        rotateWorld(seg, new THREE.Quaternion().setFromAxisAngle(axis, curl * CURL_WEIGHTS[i]));
      });
    }
    // 親指は軽く内側へ
    const t0 = chains[0][0];
    const tChild = t0.children.find((c) => c.isBone);
    if (tChild) {
      const v = wp(tChild).sub(wp(t0)).normalize();
      const axis = new THREE.Vector3().crossVectors(v, palm).normalize();
      rotateWorld(t0, new THREE.Quaternion().setFromAxisAngle(axis, curl * 0.3));
    }
  }
  const armPoses = {
    ...ARM_POSES,
    relaxed: {
      ...ARM_POSES.relaxed,
      upper: [opts.armSpread ?? 0.18, -1, 0.12],
      lower: [(opts.armSpread ?? 0.18) * 0.4, -1, opts.elbowBend ?? 0.35],
    },
  };
  const poseCache = new Map();

  // ポーズ定義（上腕・前腕の向き）から、腕のボーンの回転を求める
  function computeArmPose(id) {
    if (poseCache.has(id)) return poseCache.get(id);
    const def = armPoses[id] || armPoses.relaxed;
    const saved = [holder.position.clone(), holder.rotation.clone(), holder.scale.clone()];
    holder.position.set(0, 0, 0);
    holder.rotation.set(0, 0, 0);
    holder.scale.set(1, 1, 1);
    const posed = armBones.flatMap(([u, l, h, , f]) => [u, l, h, ...f.flat()]).filter(Boolean);
    for (const b of posed) b.quaternion.copy(rest.get(b).q);
    for (const [u, l, h, side, f] of armBones) {
      const lowerDir = new THREE.Vector3(def.lower[0] * side, def.lower[1], def.lower[2]);
      pointBone(u, l, new THREE.Vector3(def.upper[0] * side, def.upper[1], def.upper[2]));
      pointBone(l, h, lowerDir);
      // 手首はまっすぐ（手の向き = 前腕の向き）にして、指を曲げる
      if (h && f[2]?.[0]) pointBone(h, f[2][0], lowerDir);
      curlFingers(h, f, (def.curl ?? 0.35) * (opts.fingerCurl ?? 1));
    }
    const out = new Map();
    for (const b of posed) out.set(b, b.quaternion.clone());
    [holder.position, holder.rotation, holder.scale].forEach((v, i) => v.copy(saved[i]));
    poseCache.set(id, out);
    return out;
  }

  const poseIds = Object.keys(armPoses);
  let poseChoice = (armPoses[opts.pose] || opts.pose === 'auto') ? opts.pose : 'behind';
  let armFrom = null;
  let armTo = null;
  let armStart = 0;
  let nextAutoSwitch = 0;

  function applyArmPose(id, now, instant) {
    const target = computeArmPose(id);
    armFrom = instant || !armTo ? target : new Map([...armTo].map(([b]) => [b, b.quaternion.clone()]));
    armTo = target;
    armStart = now;
  }

  function pickAutoPose(now) {
    const current = [...poseCache].find(([, m]) => m === armTo)?.[0];
    const others = poseIds.filter((p) => p !== current);
    applyArmPose(others[Math.floor(Math.random() * others.length)], now, false);
    nextAutoSwitch = now + 40 + Math.random() * 40;
  }

  if (hasRig && armBones.length && opts.lowerArms !== false) {
    for (const id of poseIds) computeArmPose(id);
    if (poseChoice === 'auto') pickAutoPose(0);
    else applyArmPose(poseChoice, 0, true);
    // 体の大きさを測る前に、腕をポーズの形にしておく
    for (const [b, q] of armTo) b.quaternion.copy(q);
  }

  // ---------- 足元を原点・左右中央にそろえ、カメラを置く ----------

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  holder.updateMatrixWorld(true);
  const H = size.y;
  console.log(`[3d] size=${size.toArray().map((v) => v.toFixed(2))} rig=${Object.keys(rig).join(',') || 'なし'}`);

  const fov = 30;
  const camera = new THREE.PerspectiveCamera(fov, stageW / stageH, H * 0.01, H * 20);
  const viewH = H / (opts.fill || 0.8);
  const dist = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  camera.position.set(0, viewH / 2, dist);
  camera.lookAt(0, viewH / 2, 0);

  // ---------- ボーンの無いモデル：頭まわりの部品を首を軸にした pivot にまとめる ----------

  let pivot = null;
  const headNames = hasRig ? [] : (opts.headNodes || []);
  if (headNames.length) {
    const nameRe = new RegExp(`^(${headNames.map(escapeRe).join('|')})(_\\d+)?$`);
    const headParts = [];
    model.traverse((o) => { if (nameRe.test(o.name)) headParts.push(o); });
    const base = headParts.find((o) => o.name === (opts.headPivotNode || headNames[0])) || headParts[0];
    const hb = base && new THREE.Box3().setFromObject(base);
    if (hb && !hb.isEmpty()) {
      const neck = new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.min.y + (hb.max.y - hb.min.y) * 0.1, (hb.min.z + hb.max.z) / 2);
      pivot = new THREE.Group();
      holder.add(pivot);
      pivot.position.copy(holder.worldToLocal(neck));
      pivot.updateMatrixWorld(true);
      for (const part of headParts) pivot.attach(part);
    }
  }
  const headAnchor = rig.head || pivot;

  // ---------- VRM の顔（表情・まばたき・視線） ----------

  const em = vrm?.expressionManager;
  if (em) console.log(`[3d] VRM ${vrm.meta?.metaVersion ?? ''} expressions: ${Object.keys(em.expressionMap).join(',')} lookAt=${!!vrm.lookAt}`);
  // モデルによって "Surprised" のように大文字で始まる表情名もあるので、大文字小文字を区別せずに探す
  const exprKeys = em ? Object.keys(em.expressionMap) : [];
  const exprName = (n) => exprKeys.find((k) => k === n) || exprKeys.find((k) => k.toLowerCase() === n.toLowerCase());
  const setExpr = (n, v) => { const k = exprName(n); if (k) em.setValue(k, v); };
  const faceNow = Object.fromEntries(VRM_FACE_NAMES.map((n) => [n, 0]));
  // 調整用：config の model3d.demoFace に感情タグ（smile など）を入れると、その表情で始まる
  let faceTarget = Object.fromEntries(VRM_FACES[opts.demoFace] || []);
  let nextBlink = 2;
  let blinkStart = -1;
  const lookTarget = new THREE.Object3D();
  if (vrm?.lookAt) {
    scene.add(lookTarget);
    lookTarget.position.copy(rig.head ? rig.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, H * 0.9, 0));
    lookTarget.position.z += H; // 最初は正面を見る
    vrm.lookAt.target = lookTarget;
  }

  function updateFace(t, dt) {
    if (!em) return;
    // 表情はゆっくり切り替える
    for (const n of VRM_FACE_NAMES) {
      faceNow[n] += ((faceTarget[n] || 0) - faceNow[n]) * Math.min(1, dt * 6);
      setExpr(n, faceNow[n]);
    }
    // まばたき（笑顔など目を閉じる表情のときはしない）
    if (t > nextBlink && blinkStart < 0) blinkStart = t;
    let blink = 0;
    if (blinkStart >= 0) {
      const p = (t - blinkStart) / 0.16;
      if (p >= 1) {
        blinkStart = -1;
        nextBlink = t + 2 + Math.random() * 4;
      } else {
        blink = Math.sin(p * Math.PI);
      }
    }
    setExpr('blink', blink * (1 - Math.min(1, faceNow.happy * 1.5)));
    // 口：話している間は「あ」の口を開け閉めする
    setExpr('aa', Math.max(mouth * 0.9, (faceTarget.aa || 0)));
  }

  // ---------- 動き ----------

  let mouth = 0;
  const look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  let pose = POSES.idle;
  const poseNow = { pitch: 0, roll: 0 };
  let action = null; // { name, start }
  const clock = new THREE.Clock();
  const qTmp = new THREE.Quaternion();
  const rot = (axis, angle) => qTmp.setFromAxisAngle(axis, angle);
  const A = opts.motionScale ?? 1; // 動きの大きさ
  const S = opts.motionSpeed ?? 1; // 動きの速さ

  // 脚の長さ（股関節〜足首）。しゃがんだときにどれだけ体を下げるかに使う
  const legLen = rig.leftUpperLeg && rig.leftFoot
    ? wp(rig.leftUpperLeg).distanceTo(wp(rig.leftFoot)) / Math.max(1e-6, holder.scale.y)
    : 0;
  const LEG_STYLES = { auto: 'おまかせ（たまに組む）', shift: '自然（体重移動）', cross: '足を組む' };
  let legStyle = LEG_STYLES[opts.legs] ? opts.legs : 'auto';
  let autoCross = false;
  let legAutoNext = 30 + Math.random() * 30;
  let crossK = legStyle === 'cross' ? 1 : 0;
  let stance = legStyle === 'cross' ? 1 : 0;
  let stanceTarget = 1;
  let nextStanceSwitch = 25;
  let tapStart = 8;

  function animateRig(t, act, crouch) {
    for (const [bone, r] of rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }

    // 立ち姿（ポーズを切り替えたときは 0.9 秒かけて移る）
    if (armTo) {
      if (poseChoice === 'auto' && t > nextAutoSwitch) pickAutoPose(t);
      const k = ease(clamp((t - armStart) / 0.9, 0, 1));
      for (const [b, q] of armTo) b.quaternion.slerpQuaternions(armFrom.get(b), q, k);
    }

    // 足：片足に体重を乗せて反対のひざを軽く曲げる（20〜30 秒ごとに入れ替え）、ときどきつま先でトン
    const legs = [
      [rig.leftUpperLeg, rig.leftLowerLeg, rig.leftFoot, 1],
      [rig.rightUpperLeg, rig.rightLowerLeg, rig.rightFoot, -1],
    ].filter(([u, l]) => u && l);
    if (rig.hips && legs.length === 2) {
      // おまかせ：基本は普通に立ち、たまに（20%）足を組んでしばらくしたら戻す
      if (legStyle === 'auto' && t > legAutoNext) {
        autoCross = !autoCross && Math.random() < 0.2;
        legAutoNext = t + (autoCross ? 15 + Math.random() * 15 : 30 + Math.random() * 30);
      }
      const crossing = legStyle === 'cross' || (legStyle === 'auto' && autoCross);
      // 足を組んでいる間は軸足を入れ替えない
      if (t > nextStanceSwitch && !crossing && crossK < 0.01) {
        stanceTarget = -Math.sign(stanceTarget || 1);
        nextStanceSwitch = t + 20 + Math.random() * 10;
        tapStart = t + 6 + Math.random() * 6;
      }
      stance += (stanceTarget - stance) * 0.02;
      crossK += ((crossing ? 1 : 0) - crossK) * 0.03;
      const hipRoll = 0.06 * A * stance * (1 + 0.4 * crossK);
      rotateWorld(rig.hips, rot(Z, hipRoll));
      if (rig.spine) rotateWorld(rig.spine, rot(Z, -hipRoll * 1.3));

      // 腰を軸足の上へ横にずらす（重心を軸足に乗せる）。足の位置は脚の角度で元に戻す
      const shift = H * 0.022 * A * stance * (1 + 0.6 * crossK);
      if (shift) {
        rig.hips.parent.updateWorldMatrix(true, false);
        rig.hips.position.add(new THREE.Vector3(shift, 0, 0)
          .applyQuaternion(rig.hips.parent.getWorldQuaternion(qa).invert())
          .divide(rig.hips.parent.getWorldScale(vb)));
        rig.hips.updateMatrixWorld(true);
      }
      // 腰が +x にずれると足も +x にずれるので、ももを反対向きに傾けて足を戻す
      const legShift = legLen ? -Math.asin(clamp(shift / legLen, -0.5, 0.5)) : 0;

      const tapP = (t - tapStart) / 1.1;
      for (const [u, l, f, side] of legs) {
        rotateWorld(u, rot(Z, -hipRoll + legShift)); // 腰を傾けたりずらしても、足は元の位置へ
        // free: 体重を乗せていない方の脚。ひざを軽く曲げて内側へ
        // 足を組むとき（cross）は、その脚を軸足の前に交差させて、つま先立ちにする
        const free = Math.max(0, -stance * side);
        const cross = crossK * free;
        const support = crossK * Math.max(0, stance * side);
        const bend = 0.2 * free * A + crouch * CROUCH_BEND;
        rotateWorld(u, rot(Z, -side * (0.06 * free * A + 0.26 * cross + 0.03 * support)));
        rotateWorld(l, rot(Z, side * 0.06 * free * A));
        rotateWorld(u, rot(X, -(bend + 0.12 * cross)));
        rotateWorld(l, rot(X, bend * 2 + 0.15 * cross));
        if (f) {
          let ankle = -bend + 0.45 * cross;
          if (free > 0.5 && crossK < 0.1 && tapP > 0 && tapP < 1) ankle += Math.max(0, Math.sin(tapP * Math.PI * 4)) * 0.3;
          rotateWorld(f, rot(X, ankle));
        }
      }
    }

    // 上半身のゆらぎと呼吸
    if (rig.spine) rotateWorld(rig.spine, rot(Z, Math.sin(t * 0.6 * S) * 0.012 * A));
    if (rig.chest) rotateWorld(rig.chest, rot(X, Math.sin(t * 2.1) * 0.012));

    // 首と頭：視線 + 姿勢 + 何もしていないときの小さな揺れ + 一回きりの動き + 話しているときのうなずき
    const idleYaw = (Math.sin(t * 0.37 * S) + Math.sin(t * 0.23 * S)) * 0.035 * A;
    const idlePitch = Math.sin(t * 0.29 * S) * 0.025 * A;
    let pitch = look.pitch + poseNow.pitch + idlePitch + mouth * 0.035 * A * Math.sin(t * 11);
    let yaw = look.yaw + idleYaw;
    let roll = poseNow.roll;
    // 手を振るときは振る手の方へ少し首をかしげ、上半身も少し傾ける
    if (act?.name === 'wave') {
      const e = waveEnvelope(act.p);
      roll -= 0.1 * A * e;
      pitch -= 0.03 * e;
      if (rig.spine) rotateWorld(rig.spine, rot(Z, 0.03 * A * e));
    }
    if (act?.name === 'nod') pitch += Math.sin(act.p * Math.PI * 2) * 0.12 * A * (1 - act.p);
    // 驚き：さっと頭を引いて上体を少し反らし、ゆっくり戻る
    if (act?.name === 'startle') {
      const e = act.p < 0.15 ? ease(act.p / 0.15) : ease(1 - (act.p - 0.15) / 0.85);
      pitch -= 0.14 * A * e;
      if (rig.spine) rotateWorld(rig.spine, rot(X, -0.06 * A * e));
    }
    if (act?.name === 'shake') yaw += Math.sin(act.p * Math.PI * 4) * 0.16 * A * (1 - act.p);
    const parts = rig.neck && rig.head ? [[rig.neck, 0.4], [rig.head, 0.6]] : [[rig.neck || rig.head, 1]];
    for (const [bone, w] of parts) {
      rotateWorld(bone, rot(Y, yaw * w));
      rotateWorld(bone, rot(X, pitch * w));
      rotateWorld(bone, rot(Z, -roll * w));
    }

    // 目は首より少し先回りして追う
    for (const eye of [rig.leftEye, rig.rightEye]) {
      if (!eye) continue;
      rotateWorld(eye, rot(Y, look.yaw * 0.5));
      rotateWorld(eye, rot(X, look.pitch * 0.4));
    }

    // 腕の小さな揺れ（左右で少しずらす）
    if (rig.leftUpperArm) rotateWorld(rig.leftUpperArm, rot(X, Math.sin(t * 1.05 * S) * 0.03 * A));
    if (rig.rightUpperArm) rotateWorld(rig.rightUpperArm, rot(X, Math.sin(t * 1.05 * S + 1.3) * 0.03 * A));

    // 手を振る：右腕を肩の高さくらいまで横に上げ、ひじを曲げて顔の横で手を振る
    if (act?.name === 'wave' && rig.rightUpperArm && rig.rightLowerArm) {
      const up = waveEnvelope(act.p);
      const blend = Math.min(1, up);
      const hand = rig.rightHand;
      const chains = fingers.right;
      // どの立ち姿からでも、いったん自然体の腕に寄せ、指は開いてから振る
      if (armTo) {
        const relaxed = computeArmPose('relaxed');
        for (const b of [rig.rightUpperArm, rig.rightLowerArm, hand]) {
          if (b && relaxed.has(b)) b.quaternion.slerp(relaxed.get(b), blend);
        }
      }
      for (const b of chains.flat()) b.quaternion.slerp(rest.get(b).q, blend);
      rig.rightUpperArm.updateMatrixWorld(true);

      // 腕を横から少し前へ、肩の高さまで上げ、ひじを曲げて前腕を立てる
      rotateWorld(rig.rightUpperArm, rot(Z, -1.25 * up));
      rotateWorld(rig.rightUpperArm, rot(Y, 0.35 * up));
      rotateWorld(rig.rightLowerArm, rot(Z, -1.75 * up));

      // 手のひらをこちらへ向ける（前腕をひねる）
      if (hand && chains.length === 5 && chains.every((c) => c.length)) {
        const axis = wp(hand).sub(wp(rig.rightLowerArm)).normalize();
        const n = palmNormal(hand, chains).projectOnPlane(axis);
        const want = Z.clone().projectOnPlane(axis);
        if (n.lengthSq() > 1e-6 && want.lengthSq() > 1e-6) {
          n.normalize();
          want.normalize();
          const twist = Math.atan2(axis.dot(new THREE.Vector3().crossVectors(n, want)), n.dot(want));
          rotateWorld(rig.rightLowerArm, rot(axis, twist * up));
        }
      }

      // 前腕を左右に振り、手首は少し遅れてついてくる
      const w = t * 11 * S;
      rotateWorld(rig.rightLowerArm, rot(Z, Math.sin(w) * 0.3 * A * up));
      if (hand) rotateWorld(hand, rot(Z, Math.sin(w - 0.9) * 0.35 * A * up));
    }

    // 口：口のボーンを下に下げる
    if (rig.mouth && mouth > 0.01) {
      rig.mouth.parent.updateWorldMatrix(true, false);
      const local = new THREE.Vector3(0, -mouth * H * (opts.mouthOpen ?? 0.004), 0)
        .applyQuaternion(rig.mouth.parent.getWorldQuaternion(qa).invert())
        .divide(rig.mouth.parent.getWorldScale(vb));
      rig.mouth.position.add(local);
    }
  }

  let lastT = 0;

  function render() {
    const t = clock.getElapsedTime();

    holder.scale.set(1, hasRig ? 1 : 1 + Math.sin(t * 2.1) * 0.006, 1);
    holder.rotation.y = Math.sin(t * 0.45) * 0.06;
    holder.position.y = 0;
    holder.rotation.z = 0;

    let act = null;
    if (action) {
      const p = ((t - action.start) * S) / ONE_SHOT[action.name].dur;
      if (p >= 1) action = null;
      else act = { name: action.name, p };
    }
    // 跳ねる：ボーンがあれば「しゃがむ → 跳ぶ（足を少し縮める）→ ひざで着地」、無ければ上下するだけ
    let crouch = 0;
    if (act?.name === 'hop' || act?.name === 'jump') {
      const height = act.name === 'jump' ? 0.07 : 0.03;
      if (hasRig) {
        const { p } = act;
        const air = clamp((p - 0.25) / 0.5, 0, 1);
        if (air > 0 && air < 1) {
          holder.position.y = Math.sin(air * Math.PI) * H * height;
          crouch = Math.sin(air * Math.PI) * 0.15;
        } else if (p <= 0.25) {
          crouch = Math.sin((p / 0.25) * Math.PI) * 0.6;
        } else {
          crouch = Math.sin(((p - 0.75) / 0.25) * Math.PI) * 0.5;
        }
        // ひざを曲げた分だけ体を下げて、足が床から浮かないようにする（もも・すねを同じ長さとみた近似）
        if (air <= 0 || air >= 1) holder.position.y -= legLen * (1 - Math.cos(crouch * CROUCH_BEND));
      } else {
        holder.position.y = Math.sin(act.p * Math.PI) * H * height;
      }
    }
    if (act?.name === 'shake' && !hasRig) holder.rotation.z = Math.sin(act.p * Math.PI * 6) * 0.04 * (1 - act.p);
    if (act?.name === 'startle' && !hasRig) holder.position.y = Math.sin(act.p * Math.PI) * H * 0.03;

    look.yaw += (look.tYaw - look.yaw) * 0.08;
    look.pitch += (look.tPitch - look.pitch) * 0.08;
    poseNow.pitch += (pose.pitch - poseNow.pitch) * 0.06;
    poseNow.roll += (pose.roll - poseNow.roll) * 0.06;

    if (hasRig) {
      animateRig(t, act, crouch);
    } else if (pivot) {
      const nod = mouth * 0.05 * Math.sin(t * 12);
      pivot.rotation.set(look.pitch + poseNow.pitch + nod, look.yaw, poseNow.roll);
    }

    // VRM：表情・視線・髪や服の揺れ（揺れは体を動かした後に計算する）
    if (vrm) {
      const dt = Math.min(0.1, t - lastT);
      updateFace(t, dt);
      vrm.update(dt);
    }
    lastT = t;

    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // 調整用：config の model3d.demo に動きの名前を入れると繰り返し再生する
  if (opts.demo) setInterval(() => { action = { name: opts.demo, start: clock.getElapsedTime() }; }, 2500);

  // ---------- 当たり判定・視線 ----------

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();

  function toNdc(x, y) {
    ndc.set((x / stageW) * 2 - 1, -(y / stageH) * 2 + 1);
    return ndc;
  }

  return {
    view: holder,
    hitTest: (x, y) => {
      raycaster.setFromCamera(toNdc(x, y), camera);
      return raycaster.intersectObject(holder, true).length > 0;
    },
    setMouth: (v) => { mouth = opts.demoMouth ?? v; },
    // キャラのいちばん上（頭のてっぺん）の、キャンバス上の y 座標。吹き出しを頭に重ねないために使う
    topY: () => {
      tmp.set(0, H, 0).project(camera);
      return (1 - tmp.y) / 2 * stageH;
    },
    lookAt: (x, y) => {
      if (!headAnchor) return;
      headAnchor.getWorldPosition(tmp).project(camera);
      const hx = (tmp.x + 1) / 2 * stageW;
      const hy = (1 - tmp.y) / 2 * stageH;
      look.tYaw = clamp((x - hx) / stageW * 1.4, -0.5, 0.5);
      look.tPitch = clamp((y - hy) / stageH * 0.9, -0.25, 0.3);
      // VRM の目は、マウスの先（顔より少し手前の面）を見る
      if (vrm?.lookAt) {
        raycaster.setFromCamera(toNdc(x, y), camera);
        const faceZ = headAnchor.getWorldPosition(tmp).z + H * 0.3;
        const { origin, direction } = raycaster.ray;
        const k = (faceZ - origin.z) / direction.z;
        lookTarget.position.copy(origin).addScaledVector(direction, k);
      }
    },
    // 配色の自動作成用に、キャラを描いた小さな画像を返す（描いた直後に読むので透明部分もそのまま）
    snapshot: (w = 80, h = 124) => {
      renderer.render(scene, camera);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    },
    // name は体の動き（config の expressions の値）、tag は感情タグ（VRM の表情に使う）
    setExpression: (name, tag) => {
      if (em && tag) faceTarget = Object.fromEntries(VRM_FACES[tag] || []);
      if (!name) return;
      if (ONE_SHOT[name]) {
        action = { name, start: clock.getElapsedTime() };
        pose = POSES.idle;
      } else if (POSES[name]) {
        pose = POSES[name];
      }
    },
    tap: () => {
      const name = hasRig && rig.rightUpperArm ? 'wave' : 'hop';
      action = { name, start: clock.getElapsedTime() };
    },
    // 立ち姿の一覧と、いま選ばれているもの（右クリックメニュー用）
    getPoses: () => (armTo ? {
      current: poseChoice,
      poses: [...poseIds.map((id) => ({ id, label: armPoses[id].label })), { id: 'auto', label: 'おまかせ（ときどき変わる）' }],
      legs: rig.hips && rig.leftUpperLeg && rig.rightUpperLeg ? {
        current: legStyle,
        options: Object.entries(LEG_STYLES).map(([id, label]) => ({ id, label })),
      } : null,
    } : null),
    setLegs: (id) => { if (LEG_STYLES[id]) legStyle = id; },
    setPose: (id) => {
      if (!armTo || (id !== 'auto' && !armPoses[id])) return;
      poseChoice = id;
      if (id === 'auto') pickAutoPose(clock.getElapsedTime());
      else applyArmPose(id, clock.getElapsedTime(), false);
    },
  };
}
