# Debug helper: temporarily add one setting to the active character's model3d in config.json,
# launch the app, and screenshot its window. config.json is restored afterwards.
# Usage: powershell -File scripts/shot.ps1 -Out C:\path\shot.png [-Key legs -Value cross] [-Wait 18]
param(
  [Parameter(Mandatory)][string]$Out,
  [string]$Key = '',
  [string]$Value = '',
  [int]$Wait = 18
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root 'config.json'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$utf8 = New-Object Text.UTF8Encoding $false

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public class AppWin {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public static int[] Find(uint[] pids) {
    int[] found = null;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (found == null && Array.IndexOf(pids, pid) >= 0 && IsWindowVisible(h)) {
        R r; GetWindowRect(h, out r); found = new[] { r.L, r.T, r.Rt - r.L, r.B - r.T };
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$original = [IO.File]::ReadAllText($configPath, $utf8)
try {
  if ($Key) {
    $json = '"' + $Key + '": ' + ($(if ($Value -match '^[\d.]+$|^(true|false)$') { $Value } else { '"' + $Value + '"' }))
    [IO.File]::WriteAllText($configPath, $original.Replace('"mouthOpen": 0.004', '"mouthOpen": 0.004, ' + $json), $utf8)
  }
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
  Start-Sleep 1
  Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $root 'run.log') -RedirectStandardError (Join-Path $root 'run.err.log') | Out-Null
  Start-Sleep $Wait
} finally {
  [IO.File]::WriteAllText($configPath, $original, $utf8)
}

$pids = [uint32[]](Get-Process electron | ForEach-Object { $_.Id })
$r = [AppWin]::Find($pids)
if (-not $r) { throw 'App window not found (check run.log)' }
$bmp = New-Object System.Drawing.Bitmap $r[2], $r[3]
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($r[0], $r[1], 0, 0, $bmp.Size)
$bmp.Save($Out)
"saved $Out (window at $($r[0]),$($r[1]))"
