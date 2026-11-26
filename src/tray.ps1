# Tray icon and global hotkeys for 10k's Account Manager. Talks to the manager over stdin/stdout, one JSON object per line.
#   in : {"cmd":"hotkeys","open":{"mods":3,"vk":77}|null,"closeAll":{...}|null}  {"cmd":"tip","text":"..."}  {"cmd":"balloon","title":"..","text":".."}  {"cmd":"exit"}
#   out: {"event":"ready"} {"event":"open"} {"event":"closeAll"} {"event":"quit"} {"event":"hotkey","name":"open","ok":true|false}
# When the manager goes away (stdin closes) this process removes the icon and exits, so it can never be left behind.
param([string]$Icon = '', [string]$TitleArg = "10k's Account Manager")
$global:Title = $TitleArg
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class IramHotkeyWindow : NativeWindow {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
  public ConcurrentQueue<int> Presses = new ConcurrentQueue<int>();
  public IramHotkeyWindow() { CreateHandle(new CreateParams()); }
  public bool Register(int id, uint mods, uint vk) { UnregisterHotKey(Handle, id); return RegisterHotKey(Handle, id, mods | 0x4000u, vk); } // 0x4000 = MOD_NOREPEAT
  public void Unregister(int id) { UnregisterHotKey(Handle, id); }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0312) Presses.Enqueue((int)m.WParam);
    base.WndProc(ref m);
  }
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    SetForegroundWindow(h);
    return GetForegroundWindow() == h;
  }
  public void Close() { UnregisterHotKey(Handle, 1); UnregisterHotKey(Handle, 2); DestroyHandle(); }
}

public class IramStdin {
  public ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public volatile bool Closed;
  public void Start() {
    Thread t = new Thread(delegate () {
      try { string l; while ((l = Console.In.ReadLine()) != null) Lines.Enqueue(l); } catch { }
      Closed = true;
    });
    t.IsBackground = true;
    t.Start();
  }
}
"@

function global:Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$iconObj = $null
if ($Icon -and (Test-Path -LiteralPath $Icon)) { try { $iconObj = New-Object System.Drawing.Icon($Icon) } catch { $iconObj = $null } }
if (-not $iconObj) { $iconObj = [System.Drawing.SystemIcons]::Application }

$global:ni = New-Object System.Windows.Forms.NotifyIcon
$global:ni.Icon = $iconObj
$global:ni.Text = $global:Title
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('Open manager')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miClose = $menu.Items.Add('Close all clients (one by one)')
$menu.Items.Add('-') | Out-Null
$miQuit = $menu.Items.Add('Quit manager (clients keep running)')
$global:ni.ContextMenuStrip = $menu
$global:ni.Visible = $true

$miOpen.add_Click({ Open-Ui })
$global:ni.add_DoubleClick({ Open-Ui })
$miClose.add_Click({
  $r = [System.Windows.Forms.MessageBox]::Show('Close every Roblox client? They are closed one at a time.', $global:Title, 'YesNo', 'Question')
  if ($r -eq 'Yes') { Send @{ event = 'closeAll' } }
})
$miQuit.add_Click({ Send @{ event = 'quit' } })

$global:hk = New-Object IramHotkeyWindow
$global:stdin = New-Object IramStdin
$global:stdin.Start()
$global:names = @{ 1 = 'open'; 2 = 'closeAll' }
$global:done = $false

# Brings the manager's own window to the front when it is already open. The manager opens a new one only when this says false.
function global:Open-Ui {
  $focused = $false
  try {
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like ("$($global:Title)*") } | Select-Object -First 1
    if ($p) { $focused = [IramHotkeyWindow]::Focus($p.MainWindowHandle) }
  } catch { }
  Send @{ event = 'open'; focused = [bool]$focused }
}

function global:Apply-Hotkey([int]$id, $spec) {
  $global:hk.Unregister($id)
  if ($null -eq $spec) { return }
  $ok = $global:hk.Register($id, [uint32]$spec.mods, [uint32]$spec.vk)
  Send @{ event = 'hotkey'; name = $global:names[$id]; ok = [bool]$ok }
}

$global:timer = New-Object System.Windows.Forms.Timer
$global:timer.Interval = 100
$global:timer.add_Tick({
  try {
    $id = 0
    while ($global:hk.Presses.TryDequeue([ref]$id)) { if ($global:names.ContainsKey($id)) { if ($global:names[$id] -eq 'open') { Open-Ui } else { Send @{ event = $global:names[$id] } } } }
    $line = $null
    while ($global:stdin.Lines.TryDequeue([ref]$line)) {
      $msg = $null
      try { $msg = $line | ConvertFrom-Json } catch { continue }
      switch ($msg.cmd) {
        'hotkeys' { Apply-Hotkey 1 $msg.open; Apply-Hotkey 2 $msg.closeAll }
        'tip' { $t = [string]$msg.text; if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }; $global:ni.Text = $t }
        'balloon' { $global:ni.ShowBalloonTip(4000, [string]$msg.title, [string]$msg.text, [System.Windows.Forms.ToolTipIcon]::Info) }
        'exit' { $global:done = $true }
      }
    }
    if ($global:stdin.Closed -and $global:stdin.Lines.IsEmpty) { $global:done = $true }
    if ($global:done) { [System.Windows.Forms.Application]::ExitThread() }
  } catch { }
})
$global:timer.Start()
Send @{ event = 'ready' }
try { [System.Windows.Forms.Application]::Run() } finally {
  $global:timer.Stop()
  $global:hk.Close()
  $global:ni.Visible = $false
  $global:ni.Dispose()
}
