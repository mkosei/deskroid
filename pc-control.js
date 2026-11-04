// 音量・再生の操作（キーボードのメディアキーを押すのと同じこと。Electron に依存しない）
// - Windows: 仮想キー（音量 +/-、ミュート、再生/一時停止、次/前の曲）を送る
// - Mac: 音量とミュートだけ AppleScript で変える（再生の操作はアプリごとに違うので未対応）
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Windows の仮想キーコード
const VK = {
  volume_up: 0xaf, volume_down: 0xae, mute: 0xad,
  play_pause: 0xb3, next: 0xb0, previous: 0xb1,
};
const ACTIONS = Object.keys(VK);

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
});

// steps: 音量を何段階動かすか（Windows は 1 段階 = 2%、Mac は 1 段階 = 6%）
async function mediaControl(action, steps = 1) {
  if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${action}`);
  const n = action.startsWith('volume_') ? Math.min(25, Math.max(1, Math.round(Number(steps) || 1))) : 1;
  if (IS_WIN) {
    // Windows API の keybd_event で、本物のメディアキーを押して離す（SendKeys では効かない環境がある）
    const script = [
      "Add-Type -Namespace DeskroidKeys -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'",
      `1..${n} | ForEach-Object { [DeskroidKeys.K]::keybd_event(${VK[action]}, 0, 1, [UIntPtr]::Zero); [DeskroidKeys.K]::keybd_event(${VK[action]}, 0, 3, [UIntPtr]::Zero) }`,
    ].join('; ');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return true;
  }
  if (IS_MAC) {
    const scripts = {
      volume_up: `set volume output volume ((output volume of (get volume settings)) + ${6 * n})`,
      volume_down: `set volume output volume ((output volume of (get volume settings)) - ${6 * n})`,
      mute: 'set volume output muted (not (output muted of (get volume settings)))',
    };
    if (!scripts[action]) return false;
    await run('osascript', ['-e', scripts[action]]);
    return true;
  }
  return false;
}

module.exports = { mediaControl, MEDIA_ACTIONS: ACTIONS };
