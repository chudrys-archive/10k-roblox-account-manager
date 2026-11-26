# Persistent Win32 helper for 10k's Account Manager.
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
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
[DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
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
  // ProcessPowerThrottling (class 4): ControlMask 1 = execution speed, StateMask 0 = do not throttle this process (EcoQoS off)
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref PowerThrottle info, int size);
  [StructLayout(LayoutKind.Sequential)] public struct PowerThrottle { public uint Version; public uint ControlMask; public uint StateMask; }
  public static bool NoPowerThrottle(IntPtr h) { PowerThrottle t = new PowerThrottle(); t.Version = 1; t.ControlMask = 1; t.StateMask = 0; return SetProcessInformation(h, 4, ref t, Marshal.SizeOf(t)); }

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

# Frees the Roblox single-instance lock inside clients that are already running, WITHOUT closing them: the named
# event/mutex handle is closed in the client (DuplicateHandle with DUPLICATE_CLOSE_SOURCE, the Process Explorer
# method). Only Event and Mutant handles in the pids we are given are inspected, and only a name that ends exactly
# in the wanted suffix at a '\' boundary is closed. Nothing here ever throws into the caller: failures return empty.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IramSingleton {
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  [DllImport("ntdll.dll")] static extern int NtQueryObject(IntPtr h, int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sp, IntPtr sh, IntPtr tp, out IntPtr th, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern int GetCurrentProcessId();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateEventW(IntPtr a, bool manual, bool init, string name);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateMutexW(IntPtr a, bool owner, string name);
  const int SystemExtendedHandleInformation = 0x40;
  const int ObjectNameInformation = 1;
  const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);
  const long MaxSnapshot = 256L * 1024 * 1024;
  const uint PROCESS_DUP_HANDLE = 0x40;
  const uint DUPLICATE_CLOSE_SOURCE = 1, DUPLICATE_SAME_ACCESS = 2;
  const int EntrySize = 40, EntriesOffset = 16;

  static IntPtr Snapshot(out long bytes) {
    int size = 1 << 20; bytes = 0;
    while (size <= MaxSnapshot) {
      IntPtr buf = Marshal.AllocHGlobal(size);
      int ret; int st = NtQuerySystemInformation(SystemExtendedHandleInformation, buf, size, out ret);
      if (st == 0) { bytes = size; return buf; }
      Marshal.FreeHGlobal(buf);
      if (st != STATUS_INFO_LENGTH_MISMATCH) return IntPtr.Zero;
      size = Math.Max(size * 2, ret + (1 << 16));
    }
    return IntPtr.Zero;
  }

  public static bool NameMatches(string name, string suffix) {
    if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(suffix) || name.Length < suffix.Length) return false;
    if (!name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return false;
    int split = name.Length - suffix.Length;
    return split == 0 || name[split - 1] == '\\';
  }

  static string ObjectName(IntPtr h) {
    IntPtr buf = Marshal.AllocHGlobal(4096);
    try {
      int ret; if (NtQueryObject(h, ObjectNameInformation, buf, 4096, out ret) != 0) return null;
      int len = Marshal.ReadInt16(buf, 0); IntPtr str = Marshal.ReadIntPtr(buf, 8);
      if (len <= 0 || str == IntPtr.Zero) return null;
      return Marshal.PtrToStringUni(str, len / 2);
    } finally { Marshal.FreeHGlobal(buf); }
  }

  // Returns "pid:name" for every handle closed.
  public static string[] Release(int[] pids, string[] suffixes) {
    var closed = new List<string>();
    if (!Environment.Is64BitProcess || pids == null || pids.Length == 0 || suffixes == null) return closed.ToArray();
    var want = new HashSet<int>(pids);
    IntPtr own1 = CreateEventW(IntPtr.Zero, true, false, null), own2 = CreateMutexW(IntPtr.Zero, false, null);
    long bytes; IntPtr snap = Snapshot(out bytes);
    try {
      if (snap == IntPtr.Zero || own1 == IntPtr.Zero || own2 == IntPtr.Zero) return closed.ToArray();
      long count = Marshal.ReadInt64(snap, 0);
      if (count < 0 || EntriesOffset + count * EntrySize > bytes) return closed.ToArray();
      int me = GetCurrentProcessId(); int evType = -1, muType = -1;
      for (long i = 0; i < count; i++) {
        IntPtr e = snap + (int)(EntriesOffset + i * EntrySize);
        if ((long)Marshal.ReadIntPtr(e, 8) != me) continue;
        long hv = (long)Marshal.ReadIntPtr(e, 16); int ty = Marshal.ReadInt16(e, 28);
        if (hv == (long)own1) evType = ty; else if (hv == (long)own2) muType = ty;
      }
      if (evType < 0 || muType < 0) return closed.ToArray();
      var procs = new Dictionary<int, IntPtr>();
      try {
        for (long i = 0; i < count; i++) {
          IntPtr e = snap + (int)(EntriesOffset + i * EntrySize);
          int pid = (int)(long)Marshal.ReadIntPtr(e, 8);
          if (!want.Contains(pid)) continue;
          int ty = Marshal.ReadInt16(e, 28);
          if (ty != evType && ty != muType) continue;
          IntPtr ph; if (!procs.TryGetValue(pid, out ph)) { ph = OpenProcess(PROCESS_DUP_HANDLE, false, pid); procs[pid] = ph; }
          if (ph == IntPtr.Zero) continue;
          IntPtr hv = Marshal.ReadIntPtr(e, 16), local;
          if (!DuplicateHandle(ph, hv, GetCurrentProcess(), out local, 0, false, DUPLICATE_SAME_ACCESS)) continue;
          string name = null; try { name = ObjectName(local); } finally { CloseHandle(local); }
          string hit = null; foreach (var s in suffixes) if (NameMatches(name, s)) { hit = s; break; }
          if (hit == null) continue;
          IntPtr gone; if (DuplicateHandle(ph, hv, GetCurrentProcess(), out gone, 0, false, DUPLICATE_CLOSE_SOURCE)) { CloseHandle(gone); closed.Add(pid + ":" + hit); }
        }
      } finally { foreach (var p in procs.Values) if (p != IntPtr.Zero) CloseHandle(p); }
    } finally { if (snap != IntPtr.Zero) Marshal.FreeHGlobal(snap); if (own1 != IntPtr.Zero) CloseHandle(own1); if (own2 != IntPtr.Zero) CloseHandle(own2); }
    return closed.ToArray();
  }
}
"@

function Release-Singleton($a) {
  $pids = @($a.pids | ForEach-Object { [int]$_ })
  $names = @($a.names | ForEach-Object { [string]$_ })
  if ($names.Count -eq 0) { $names = @('ROBLOX_singletonEvent') } # a mutex's owner stays recorded after its handle is closed, so closing it frees nothing
  return , @([IramSingleton]::Release([int[]]$pids, [string[]]$names))
}
# Exit codes of Roblox clients: a handle opened while the client runs still answers after it ends, so the manager can tell a clean exit (window closed by hand) from a crash.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IramExit {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static readonly Dictionary<int, IntPtr> handles = new Dictionary<int, IntPtr>();
  public static int Watch(int[] pids) {
    int n = 0;
    lock (handles) foreach (int pid in pids) {
      if (handles.ContainsKey(pid)) continue;
      IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
      if (h != IntPtr.Zero) { handles[pid] = h; n++; }
    }
    return n;
  }
  // -1 = not watched, -2 = still running, otherwise the exit code. A finished process is released.
  public static long Take(int pid) {
    lock (handles) {
      IntPtr h; if (!handles.TryGetValue(pid, out h)) return -1;
      uint code; if (!GetExitCodeProcess(h, out code)) return -1;
      if (code == 259) return -2; // STILL_ACTIVE (the handle has no SYNCHRONIZE right, so the exit code is the only signal)
      CloseHandle(h); handles.Remove(pid);
      return (long)code;
    }
  }
  public static void Release(int pid) { lock (handles) { IntPtr h; if (handles.TryGetValue(pid, out h)) { CloseHandle(h); handles.Remove(pid); } } }
}
"@
# CPU cap per client: a job object with a hard CPU-rate limit. A process can join one job and keep it until it ends; changing the rate changes the cap.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IramJob {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref CpuRate info, int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct CpuRate { public uint ControlFlags; public uint Rate; }
  static readonly Dictionary<int, IntPtr> jobs = new Dictionary<int, IntPtr>();
  // pct = share of the whole machine (1..100); 0 lifts the cap (100%). Returns false when the process could not be put in a job.
  public static bool Cap(int pid, int pct) {
    lock (jobs) {
      IntPtr job;
      if (!jobs.TryGetValue(pid, out job)) {
        if (pct <= 0) return true; // never capped, nothing to lift
        IntPtr proc = OpenProcess(0x0100 | 0x0001, false, pid); // PROCESS_SET_QUOTA | PROCESS_TERMINATE
        if (proc == IntPtr.Zero) return false;
        try {
          job = CreateJobObjectW(IntPtr.Zero, null);
          if (job == IntPtr.Zero) return false;
          if (!AssignProcessToJobObject(job, proc)) { CloseHandle(job); return false; }
        } finally { CloseHandle(proc); }
        jobs[pid] = job;
      }
      CpuRate info; info.ControlFlags = 0x1 | 0x4; // ENABLE | HARD_CAP
      info.Rate = (uint)(pct <= 0 ? 10000 : Math.Min(100, pct) * 100);
      return SetInformationJobObject(job, 15, ref info, Marshal.SizeOf(typeof(CpuRate)));
    }
  }
  public static void Release(int pid) { lock (jobs) { IntPtr j; if (jobs.TryGetValue(pid, out j)) { CloseHandle(j); jobs.Remove(pid); } } }
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

# The command line and start time of a process never change, so they are read once (WMI is the slow part) and kept per pid + start time.
$script:ProcInfo = @{}
function Get-RobloxProcs {
  $list = New-Object System.Collections.ArrayList
  $procsNow = @([System.Diagnostics.Process]::GetProcessesByName('RobloxPlayerBeta'))
  $wins = [IramWin]::MainWindows([uint32[]]@($procsNow | ForEach-Object { [uint32]$_.Id }))
  $seen = @{}
  foreach ($p in $procsNow) {
    try {
      $procId = [int]$p.Id
      $st = $null; try { $st = $p.StartTime.ToUniversalTime().ToString('o') } catch { continue }
      $key = "$procId|$st"
      $seen[$key] = $true
      $info = $script:ProcInfo[$key]
      if ($null -eq $info) {
        $cl = ''
        try { $c = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop; $cl = [string]$c.CommandLine } catch { }
        $btid = $null
        if ($cl -match 'browsertrackerid:(\d+)') { $btid = $Matches[1] }
        elseif ($cl -match '(?:^|\s)-b\s+(\d+)') { $btid = $Matches[1] }
        $info = @{ btid = $btid; start = $st }
        $script:ProcInfo[$key] = $info
      }
      $h = [IntPtr]::Zero
      if ($wins.ContainsKey([uint32]$procId)) { $h = $wins[[uint32]$procId] }
      $hung = $false; $title = ''; $minimized = $false
      if ($h -ne [IntPtr]::Zero) {
        $hung = [IramWin]::IsHungAppWindow($h)
        $title = [IramWin]::GetTitle($h)
        $minimized = [IramWin]::IsIconic($h)
      }
      $cpu = $null; try { $cpu = [math]::Round($p.TotalProcessorTime.TotalMilliseconds) } catch { }
      $p.Refresh()
      [void]$list.Add(@{
        pid = $procId; btid = $info.btid; hwnd = [int64]$h; title = $title; hung = $hung; minimized = $minimized
        memMB = [math]::Round($p.WorkingSet64 / 1MB); privMB = [math]::Round($p.PrivateMemorySize64 / 1MB); start = $info.start
        cpuMs = $cpu; handles = $p.HandleCount
      })
    } catch { } finally { $p.Dispose() }
  }
  foreach ($k in @($script:ProcInfo.Keys)) { if (-not $seen.ContainsKey($k)) { $script:ProcInfo.Remove($k) } }
  return , $list.ToArray()
}

# Roblox refuses to be smaller than 800x600 when it is sized the normal way: its window procedure answers WM_GETMINMAXINFO, and
# SetWindowPos sends WM_WINDOWPOSCHANGING, which applies that minimum. SWP_NOSENDCHANGING skips that message, so the size sticks.
# Sizes are physical pixels (per-monitor DPI awareness for this call only). A maximized window is left alone (maximize one to look at it),
# and nothing is resized while the left mouse button is down, so dragging a window is never fought.
$SWP_NOSIZE = 0x0001; $SWP_NOMOVE = 0x0002; $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_NOSENDCHANGING = 0x0400
function Invoke-Resize($a) {
  $w = [int]$a.width; $hh = [int]$a.height
  if ($w -lt 1 -or $hh -lt 1) { return 0 }
  if (([IramWin]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0) { return 0 }
  $old = [IramWin]::SetThreadDpiAwarenessContext([IntPtr](-4))
  $n = 0
  try {
    foreach ($x in @($a.hwnds)) {
      $h = [IntPtr][int64]$x
      if ($h -eq [IntPtr]::Zero) { continue }
      if (-not [IramWin]::IsWindow($h) -or [IramWin]::IsIconic($h) -or [IramWin]::IsZoomed($h)) { continue }
      $rc = New-Object IramWin+RECT
      if (-not [IramWin]::GetWindowRect($h, [ref]$rc)) { continue }
      if (($rc.R - $rc.L) -eq $w -and ($rc.B - $rc.T) -eq $hh) { continue }
      if ([IramWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $w, $hh, ($SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_NOSENDCHANGING))) { $n++ }
    }
  } finally {
    if ($old -ne [IntPtr]::Zero) { [void][IramWin]::SetThreadDpiAwarenessContext($old) }
  }
  return $n
}

# Tiles windows of one fixed size (the size set in Settings) in rows; when they do not all fit they overlap a little instead of leaving the screen.
function Invoke-TileSmall($a) {
  $hwnds = @($a.hwnds | ForEach-Object { [IntPtr][int64]$_ } | Where-Object { $_ -ne [IntPtr]::Zero })
  $n = $hwnds.Count
  if ($n -eq 0) { return 0 }
  $w = [int]$a.width; $hh = [int]$a.height
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $cols = [int]$a.cols
  if ($cols -le 0) { $cols = [math]::Max(1, [math]::Floor($wa.Width / $w)) }
  $cols = [math]::Min($cols, $n)
  $rows = [math]::Ceiling($n / $cols)
  $stepX = if ($cols -gt 1) { [math]::Max(1, [math]::Min($w, [math]::Floor(($wa.Width - $w) / ($cols - 1)))) } else { 0 }
  $stepY = if ($rows -gt 1) { [math]::Max(1, [math]::Min($hh, [math]::Floor(($wa.Height - $hh) / ($rows - 1)))) } else { 0 }
  for ($i = 0; $i -lt $n; $i++) {
    $col = $i % $cols; $row = [math]::Floor($i / $cols)
    [void][IramWin]::ShowWindow($hwnds[$i], 9)
    [void][IramWin]::SetWindowPos($hwnds[$i], [IntPtr]::Zero, $wa.X + $col * $stepX, $wa.Y + $row * $stepY, $w, $hh, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_NOSENDCHANGING))
  }
  return $n
}

function Invoke-Tile($a) {
  if ([int]$a.width -gt 0 -and [int]$a.height -gt 0) { return Invoke-TileSmall $a }
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
      'release_singleton' { $r = Release-Singleton $a }
      'memory'    { $r = Get-CommitState }
      'cpucap'    { $r = @(@($a.items) | ForEach-Object { [IramJob]::Cap([int]$_.pid, [int]$_.pct) }) }
      'watch'     { $r = [IramExit]::Watch([int[]]@($a.pids | ForEach-Object { [int]$_ })) }
      'exitcode'  { $r = [IramExit]::Take([int]$a.pid); if ($r -ne -2) { [IramJob]::Release([int]$a.pid) } }
      'unwatch'   { [IramExit]::Release([int]$a.pid); [IramJob]::Release([int]$a.pid); $r = $true }
      'kill'      {
        $killed = 0
        foreach ($x in @($a.pids)) { try { Stop-Process -Id ([int]$x) -Force -ErrorAction Stop; $killed++ } catch { } }
        $r = $killed
      }
      'settitle'  { $r = [IramWin]::SetWindowTextW([IntPtr][int64]$a.hwnd, [string]$a.title) }
      'show'      { $r = [IramWin]::ShowWindow([IntPtr][int64]$a.hwnd, [int]$a.mode) } # 6=min, 9=restore
      'park'      {
        # off-screen but not minimized: restore first, then move far left keeping the size. mode 'back' returns it to (80,80).
        $h = [IntPtr][int64]$a.hwnd
        [void][IramWin]::ShowWindow($h, 9)
        # SWP_NOSIZE: only the position changes, so a window made smaller than Roblox's minimum keeps its size
        $mv = $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_NOSENDCHANGING
        if ([string]$a.mode -eq 'back') { $r = [IramWin]::SetWindowPos($h, [IntPtr]::Zero, 80, 80, 0, 0, $mv) }
        else { $r = [IramWin]::SetWindowPos($h, [IntPtr]::Zero, -20000, 0, 0, 0, $mv) }
      }
      'focus'     { $h = [IntPtr][int64]$a.hwnd; [void][IramWin]::ShowWindow($h, 9); $r = [IramWin]::SetForegroundWindow($h) }
      'tile'      { $r = Invoke-Tile $a }
      'resize'    { $r = Invoke-Resize $a }
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
            if ($a.noThrottle) { [void][IramWin]::NoPowerThrottle($p.Handle) }
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
