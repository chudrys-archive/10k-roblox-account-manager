# Paints the manager's Edge app window with a black caption (Windows 11), dark mode on Windows 10. Best effort.
param([string]$Title = "Isa's Roblox Account Manager")
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class IramCaption {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);
  public static int Paint(string prefix) {
    int count = 0;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(h, sb, sb.Capacity);
      if (!sb.ToString().StartsWith(prefix, StringComparison.Ordinal)) return true;
      int dark = 1, caption = 0x000000, text = 0x00FFFFFF; // COLORREF is 0x00BBGGRR
      DwmSetWindowAttribute(h, 20, ref dark, 4);    // DWMWA_USE_IMMERSIVE_DARK_MODE
      DwmSetWindowAttribute(h, 35, ref caption, 4); // DWMWA_CAPTION_COLOR (Windows 11)
      DwmSetWindowAttribute(h, 36, ref text, 4);    // DWMWA_TEXT_COLOR (Windows 11)
      count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
"@
# Re-applied every 2 s for about 3 minutes: Edge can recreate the window (and its caption) after load.
for ($k = 0; $k -lt 90; $k++) {
  [IramCaption]::Paint($Title) | Out-Null
  Start-Sleep -Seconds 2
}