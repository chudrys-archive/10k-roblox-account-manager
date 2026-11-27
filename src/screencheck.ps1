param([Parameter(Mandatory = $true)][string]$Pids, [switch]$NoOcr)
# One-shot window inspector for the manager's screen check.
# For each pid: copy the Roblox window's on-screen pixels INTO MEMORY, reduce them to a 16x9 grayscale fingerprint and read the text
# with Windows' built-in OCR. Nothing is ever written to disk: the bitmap and the PNG stream used by OCR live in memory and are
# disposed before the next window. Output: one JSON line, an array of { pid, ok, covered, w, h, mean, fp, text, error }.
# A window with another window on top of it is reported as covered and not read (its pixels would be someone else's).
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class ScCap {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  static bool dpiSet;
  // 0 = readable, 1 = minimized/unreadable, 2 = covered by another window
  public static int Probe(IntPtr h, out Rectangle rect) {
    if (!dpiSet) { SetProcessDPIAware(); dpiSet = true; }
    rect = Rectangle.Empty;
    if (IsIconic(h)) return 1;
    RECT r; if (!GetWindowRect(h, out r)) return 1;
    int w = r.R - r.L, hh = r.B - r.T;
    if (w < 40 || hh < 40 || w > 8000 || hh > 8000) return 1;
    rect = new Rectangle(r.L, r.T, w, hh);
    int[][] pts = new int[][] { new int[] { w / 2, hh / 2 }, new int[] { w / 5, hh / 2 }, new int[] { w * 4 / 5, hh / 2 }, new int[] { w / 2, hh * 4 / 5 } };
    foreach (int[] p in pts) {
      POINT pt; pt.X = r.L + p[0]; pt.Y = r.T + p[1];
      IntPtr hit = WindowFromPoint(pt);
      if (hit == IntPtr.Zero || GetAncestor(hit, 2) != h) return 2;
    }
    return 0;
  }
  public static Bitmap Grab(Rectangle rect) {
    Bitmap bmp = new Bitmap(rect.Width, rect.Height);
    using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(rect.Left, rect.Top, 0, 0, rect.Size);
    return bmp;
  }
  // 16x9 grayscale fingerprint as 144 two-digit hex values, plus the mean brightness 0..255
  public static string Fingerprint(Bitmap src, out double mean) {
    using (Bitmap s = new Bitmap(16, 9)) {
      using (Graphics g = Graphics.FromImage(s)) {
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
        g.DrawImage(src, new Rectangle(0, 0, 16, 9));
      }
      var sb = new System.Text.StringBuilder(); double sum = 0;
      for (int y = 0; y < 9; y++) for (int x = 0; x < 16; x++) {
        Color c = s.GetPixel(x, y);
        int v = (int)(0.299 * c.R + 0.587 * c.G + 0.114 * c.B);
        sum += v; sb.Append(v.ToString("x2"));
      }
      mean = sum / 144.0;
      return sb.ToString();
    }
  }
}
'@

$ocrReady = $false
if (-not $NoOcr) {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $ocrReady = [bool]$engine
  } catch { $ocrReady = $false }
}
function Wait-Op($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(15000)) { throw 'ocr timeout' }
  $t.Result
}
function Read-Text([System.Drawing.Bitmap]$bmp) {
  $work = $bmp
  $scaled = $null
  if ($bmp.Width -lt 900) {
    $scaled = New-Object System.Drawing.Bitmap ($bmp.Width * 3), ($bmp.Height * 3)
    $g = [System.Drawing.Graphics]::FromImage($scaled)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bmp, 0, 0, $scaled.Width, $scaled.Height); $g.Dispose()
    $work = $scaled
  }
  $ms = New-Object System.IO.MemoryStream
  try {
    $work.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $ms.Position = 0
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $dec = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Wait-Op ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Wait-Op ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    $sb.Dispose(); $ras.Dispose()
    return ($res.Text -replace '\s+', ' ').Trim()
  } finally { $ms.Dispose(); if ($scaled) { $scaled.Dispose() } }
}

$out = @()
foreach ($raw in ($Pids -split ',')) {
  $id = 0
  if (-not [int]::TryParse($raw, [ref]$id)) { continue }
  $row = [ordered]@{ pid = $id; ok = $false }
  $bmp = $null
  try {
    $p = Get-Process -Id $id -ErrorAction Stop
    $h = $p.MainWindowHandle
    if ($h -eq [IntPtr]::Zero) { throw 'no window' }
    $rect = [System.Drawing.Rectangle]::Empty
    $state = [ScCap]::Probe($h, [ref]$rect)
    if ($state -eq 1) { throw 'window minimized or unreadable' }
    if ($state -eq 2) { $row.covered = $true; $out += [pscustomobject]$row; continue }
    $bmp = [ScCap]::Grab($rect)
    $mean = 0.0
    $row.fp = [ScCap]::Fingerprint($bmp, [ref]$mean)
    $row.mean = [math]::Round($mean, 1)
    $row.w = $bmp.Width; $row.h = $bmp.Height
    if ($ocrReady) { try { $row.text = (Read-Text $bmp) } catch { $row.ocrError = $_.Exception.Message } }
    $row.ok = $true
  } catch { $row.error = $_.Exception.Message }
  finally { if ($bmp) { $bmp.Dispose() } }
  $out += [pscustomobject]$row
}
[GC]::Collect()
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
