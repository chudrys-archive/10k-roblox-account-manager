# Persistent Win32 helper for Isa's Roblox Account Manager.
# Protocol: one JSON request per stdin line -> one JSON response per stdout line.
#   request:  {"id":1,"cmd":"procs","args":{...}}
#   response: {"id":1,"ok":true,"result":...}  |  {"id":1,"ok":false,"error":"..."}
# Holding this process open keeps the Roblox singleton handles owned (multi-instance).
# When the parent (Node) dies, stdin hits EOF and we exit, releasing everything.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class IramWin {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowTextW(IntPtr h, string s);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);

  // Prefer the real Roblox render window (class WINDOWSCLIENT); otherwise any visible top-level window of the pid.
  public static IntPtr FindMainWindow(uint pid) {
    IntPtr best = IntPtr.Zero;
    EnumProc cb = delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(256); GetClassNameW(h, sb, 256);
      if (sb.ToString() == "WINDOWSCLIENT") { best = h; return false; }
      if (best == IntPtr.Zero) best = h;
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return best;
  }
  // One EnumWindows pass for all pids (instead of one pass per client) - matters with 20-30 clients.
  public static System.Collections.Generic.Dictionary<uint, IntPtr> MainWindows(uint[] pids) {
    var want = new System.Collections.Generic.HashSet<uint>(pids);
    var best = new System.Collections.Generic.Dictionary<uint, IntPtr>();
    var exact = new System.Collections.Generic.HashSet<uint>();
    EnumProc cb = delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (!want.Contains(p) || exact.Contains(p) || !IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(256); GetClassNameW(h, sb, 256);
      if (sb.ToString() == "WINDOWSCLIENT") { best[p] = h; exact.Add(p); }
      else if (!best.ContainsKey(p)) best[p] = h;
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return best;
  }
  public static string GetTitle(IntPtr h) {
    StringBuilder sb = new StringBuilder(512); GetWindowTextW(h, sb, 512); return sb.ToString();
  }

  // ---------------- anti-AFK / input ----------------
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);

  public static uint IdleMs() {
    LASTINPUTINFO li = new LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(li);
    if (!GetLastInputInfo(ref li)) return 0;
    return (uint)Environment.TickCount - li.dwTime;
  }

  // Windows only lets the process that produced the last input change the foreground window.
  // F24 is unassigned everywhere, so tapping it makes us that process without side effects;
  // AttachThreadInput covers the remaining cases.
  public static bool ForceForeground(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    if (fg == h) return true;
    uint pid;
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint me = GetCurrentThreadId();
    keybd_event(0x87, 0, 0, UIntPtr.Zero); keybd_event(0x87, 0, 2, UIntPtr.Zero);
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    System.Threading.Thread.Sleep(30);
    return GetForegroundWindow() == h;
  }

  static void Tap(byte vk, int holdMs) {
    byte sc = (byte)MapVirtualKey(vk, 0);
    keybd_event(vk, sc, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(holdMs);
    keybd_event(vk, sc, 2, UIntPtr.Zero);
  }

  // Briefly focuses each Roblox window, sends one harmless input, then puts the user's
  // window, cursor and minimized state back. Returns how many windows were nudged.
  public static int Nudge(long[] hwnds, string action, int vk) {
    IntPtr prev = GetForegroundWindow();
    POINT cur; GetCursorPos(out cur);
    int n = 0;
    foreach (long hv in hwnds) {
      IntPtr h = new IntPtr(hv);
      if (!IsWindow(h)) continue;
      bool wasMin = IsIconic(h);
      if (wasMin) { ShowWindow(h, 9); System.Threading.Thread.Sleep(250); }
      if (!ForceForeground(h)) { if (wasMin) ShowWindow(h, 7); continue; }
      System.Threading.Thread.Sleep(120);
      switch (action) {
        case "wasd": Tap(0x57, 90); System.Threading.Thread.Sleep(40); Tap(0x53, 90); break;
        case "rightclick": {
          RECT r; GetWindowRect(h, out r);
          SetCursorPos((r.L + r.R) / 2, (r.T + r.B) / 2);
          System.Threading.Thread.Sleep(40);
          mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
          break;
        }
        case "key": Tap((byte)vk, 70); break;
        default: Tap(0x20, 70); break; // space = jump
      }
      System.Threading.Thread.Sleep(120);
      if (wasMin) ShowWindow(h, 7); // SW_SHOWMINNOACTIVE
      n++;
    }
    SetCursorPos(cur.X, cur.Y);
    if (prev != IntPtr.Zero && IsWindow(prev)) ForceForeground(prev);
    return n;
  }
}
"@

# Per-process audio mute through Windows Core Audio (the same thing the Volume Mixer does).
$script:AudioOk = $true
try {
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IramAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int s); int GetDisplayName(out IntPtr s); int SetDisplayName(IntPtr s, IntPtr g);
    int GetIconPath(out IntPtr s); int SetIconPath(IntPtr s, IntPtr g); int GetGroupingParam(out Guid g);
    int SetGroupingParam(IntPtr g, IntPtr c); int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr s); int GetSessionInstanceIdentifier(out IntPtr s);
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute(bool mute, ref Guid ctx);
    [PreserveSig] int GetMute(out bool mute);
  }

  // Applies mute/unmute to every audio session (on every active output device) owned by the given pids.
  public static int SetMute(int[] pids, bool mute) {
    HashSet<uint> want = new HashSet<uint>();
    foreach (int p in pids) want.Add((uint)p);
    int changed = 0;
    IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
    IMMDeviceCollection devs;
    if (en.EnumAudioEndpoints(0 /*render*/, 1 /*active*/, out devs) != 0) return 0;
    int n; devs.GetCount(out n);
    Guid iid = typeof(IAudioSessionManager2).GUID;
    for (int d = 0; d < n; d++) {
      IMMDevice dev; if (devs.Item(d, out dev) != 0) continue;
      object o; if (dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out o) != 0) continue;
      IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se; if (mgr.GetSessionEnumerator(out se) != 0) continue;
      int c; se.GetCount(out c);
      for (int i = 0; i < c; i++) {
        IAudioSessionControl2 ctl; if (se.GetSession(i, out ctl) != 0) continue;
        uint pid; if (ctl.GetProcessId(out pid) != 0 || !want.Contains(pid)) continue;
        ISimpleAudioVolume vol = ctl as ISimpleAudioVolume;
        if (vol == null) continue;
        bool cur; vol.GetMute(out cur);
        if (cur != mute) { Guid g = Guid.Empty; vol.SetMute(mute, ref g); changed++; }
      }
    }
    return changed;
  }
}
"@
} catch { $script:AudioOk = $false; [Console]::Error.WriteLine('audio interop unavailable: ' + $_.Exception.Message) }

$script:Entropy = [System.Text.Encoding]::UTF8.GetBytes('IRAM-vault-v1')
$script:Handles = @{}

function Enable-Multi {
  $status = @{}
  # Singleton mutex. We must actually OWN it: a running Roblox client that owns it makes every
  # new client close the previous one. If Roblox owns it now, we retry until all clients close.
  # (Ownership is per-thread; this script's main loop always runs on the same thread.)
  try {
    if (-not $script:Handles.mutex) { $script:Handles.mutex = New-Object System.Threading.Mutex($false, 'ROBLOX_singletonMutex') }
    if (-not $script:MutexOwned) {
      try { $script:MutexOwned = $script:Handles.mutex.WaitOne(0) }
      catch [System.Threading.AbandonedMutexException] { $script:MutexOwned = $true }
    }
    $status.mutex = if ($script:MutexOwned) { 'held' } else { 'owned by a running Roblox client' }
  } catch { $status.mutex = 'error: ' + $_.Exception.Message }
  # Newer clients use a named event
  if (-not $script:Handles.event) {
    try {
      $e = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, 'ROBLOX_singletonEvent')
      $script:Handles.event = $e
      $status.event = 'held'
    } catch { $status.event = 'error: ' + $_.Exception.Message }
  } else { $status.event = 'held' }
  return $status
}

function Disable-Multi {
  foreach ($k in @('mutex', 'event')) {
    $h = $script:Handles[$k]
    if ($h) {
      try { if ($k -eq 'mutex' -and $script:MutexOwned) { $h.ReleaseMutex() } } catch { }
      if ($k -eq 'mutex') { $script:MutexOwned = $false }
      try { $h.Dispose() } catch { }
      $script:Handles.Remove($k)
    }
  }
  return @{ mutex = 'released'; event = 'released' }
}

# Commit charge. Windows fails allocations (error 1455) once commit reaches the limit (RAM + page file).
# FreeVirtualMemory is the headroom left under that limit, in KB.
function Get-CommitState {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  return @{
    limitBytes = [int64]$os.TotalVirtualMemorySize * 1024
    freeBytes  = [int64]$os.FreeVirtualMemory * 1024
  }
}

function Get-RobloxProcs {
  $list = New-Object System.Collections.ArrayList
  $cim = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='RobloxPlayerBeta.exe'" -ErrorAction SilentlyContinue)
  $wins = [IramWin]::MainWindows([uint32[]]@($cim | ForEach-Object { [uint32]$_.ProcessId }))
  foreach ($c in $cim) {
    $procId = [int]$c.ProcessId
    $cl = [string]$c.CommandLine
    $btid = $null
    if ($cl -match 'browsertrackerid:(\d+)') { $btid = $Matches[1] }
    elseif ($cl -match '(?:^|\s)-b\s+(\d+)') { $btid = $Matches[1] }
    $p = $null
    try { $p = Get-Process -Id $procId -ErrorAction Stop } catch { continue }
    $h = [IntPtr]::Zero
    if ($wins.ContainsKey([uint32]$procId)) { $h = $wins[[uint32]$procId] }
    $hung = $false; $title = ''; $minimized = $false
    if ($h -ne [IntPtr]::Zero) {
      $hung = [IramWin]::IsHungAppWindow($h)
      $title = [IramWin]::GetTitle($h)
      $minimized = [IramWin]::IsIconic($h)
    }
    $start = $null
    try { $start = $c.CreationDate.ToUniversalTime().ToString('o') } catch { }
    [void]$list.Add(@{
      pid = $procId; btid = $btid; hwnd = [int64]$h; title = $title; hung = $hung; minimized = $minimized
      memMB = [math]::Round($p.WorkingSet64 / 1MB); start = $start
    })
  }
  return , $list.ToArray()
}

function Invoke-Tile($a) {
  $hwnds = @($a.hwnds | ForEach-Object { [IntPtr][int64]$_ } | Where-Object { $_ -ne [IntPtr]::Zero })
  $n = $hwnds.Count
  if ($n -eq 0) { return 0 }
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $cols = [int]$a.cols
  if ($cols -le 0) { $cols = [math]::Ceiling([math]::Sqrt($n)) }
  $rows = [math]::Ceiling($n / $cols)
  $w = [math]::Floor($wa.Width / $cols)
  $hgt = [math]::Floor($wa.Height / $rows)
  for ($i = 0; $i -lt $n; $i++) {
    $col = $i % $cols; $row = [math]::Floor($i / $cols)
    [void][IramWin]::ShowWindow($hwnds[$i], 9) # SW_RESTORE
    [void][IramWin]::MoveWindow($hwnds[$i], $wa.X + $col * $w, $wa.Y + $row * $hgt, $w, $hgt, $true)
  }
  return $n
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $resp = @{ ok = $true }
  try {
    $req = $line | ConvertFrom-Json
    $resp.id = $req.id
    $a = $req.args
    $r = $null
    switch ($req.cmd) {
      'ping'      { $r = 'pong' }
      'multi_on'  { $r = Enable-Multi }
      'multi_off' { $r = Disable-Multi }
      'procs'     { $r = Get-RobloxProcs }
      'memory'    { $r = Get-CommitState }
      'kill'      {
        $killed = 0
        foreach ($x in @($a.pids)) { try { Stop-Process -Id ([int]$x) -Force -ErrorAction Stop; $killed++ } catch { } }
        $r = $killed
      }
      'settitle'  { $r = [IramWin]::SetWindowTextW([IntPtr][int64]$a.hwnd, [string]$a.title) }
      'show'      { $r = [IramWin]::ShowWindow([IntPtr][int64]$a.hwnd, [int]$a.mode) } # 6=min, 9=restore
      'focus'     { $h = [IntPtr][int64]$a.hwnd; [void][IramWin]::ShowWindow($h, 9); $r = [IramWin]::SetForegroundWindow($h) }
      'tile'      { $r = Invoke-Tile $a }
      'idle'      { $r = [IramWin]::IdleMs() }
      'foreground' {
        $fg = [IramWin]::GetForegroundWindow(); $fpid = [uint32]0
        [void][IramWin]::GetWindowThreadProcessId($fg, [ref]$fpid)
        $r = @{ hwnd = [int64]$fg; pid = [int]$fpid }
      }
      'mute'      {
        if (-not $script:AudioOk) { throw 'audio control unavailable on this system' }
        $r = [IramAudio]::SetMute([int[]]@($a.pids | ForEach-Object { [int]$_ }), [bool]$a.mute)
      }
      'nudge'     {
        $hw = [long[]]@($a.hwnds | ForEach-Object { [long]$_ })
        $r = [IramWin]::Nudge($hw, [string]$a.action, [int]$a.vk)
      }
      'tune'      {
        # priority: Normal | BelowNormal | Idle ; trim: empty working set (pages idle memory out)
        $done = 0
        foreach ($x in @($a.pids)) {
          try {
            $p = Get-Process -Id ([int]$x) -ErrorAction Stop
            if ($a.priority) { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]([string]$a.priority) }
            if ($a.trim) { [void][IramWin]::EmptyWorkingSet($p.Handle) }
            $done++
          } catch { }
        }
        $r = $done
      }
      'protect'   {
        $b = [Convert]::FromBase64String([string]$a.data)
        $r = [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b, $script:Entropy, 'CurrentUser'))
      }
      'unprotect' {
        $b = [Convert]::FromBase64String([string]$a.data)
        $r = [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b, $script:Entropy, 'CurrentUser'))
      }
      default { throw "unknown command: $($req.cmd)" }
    }
    $resp.result = $r
  } catch {
    $resp.ok = $false
    $resp.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $resp -Compress -Depth 6))
  [Console]::Out.Flush()
}
Disable-Multi | Out-Null
