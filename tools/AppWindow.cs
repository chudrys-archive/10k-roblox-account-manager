// Native window for 10k's Account Manager: a WinForms form around a WebView2 control, no Chrome or Edge window.
// Built by tools\build-window.ps1 with the .NET Framework compiler (C# 5), so no newer syntax here.
//
//   10k-window.exe --url http://127.0.0.1:7963/?t=TOKEN --data C:\path\to\data
//
// Exit codes: 0 window closed normally, 2 the WebView2 runtime is missing or failed to start, 3 bad arguments.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("10k's Account Manager")]
[assembly: AssemblyProduct("10k's Account Manager")]

internal static class AppWindow
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [STAThread]
    private static int Main(string[] args)
    {
        string url = null, data = null;
        bool login = false, qr = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--login") login = true;
            else if (args[i] == "--qr") qr = true;
            else if (i < args.Length - 1 && args[i] == "--url") url = args[i + 1];
            else if (i < args.Length - 1 && args[i] == "--data") data = args[i + 1];
        }
        if (login)
        {
            // Sign-in window (tools\LoginWindow.cs): Roblox pages only, own throwaway profile.
            Uri lu;
            if (string.IsNullOrEmpty(data) || !Directory.Exists(data)) return 3;
            if (string.IsNullOrEmpty(url)) url = "https://www.roblox.com/login";
            if (!Uri.TryCreate(url, UriKind.Absolute, out lu) || !LoginForm.IsRoblox(lu)) return 3;
            try { SetCurrentProcessExplicitAppUserModelID("10k.AccountManager.Login"); } catch (Exception) { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var lf = new LoginForm(data, lu, qr);
            Application.Run(lf);
            return lf.Result;
        }
        Uri uri;
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(data) ||
            !Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != "http")
            return 3;

        try { SetCurrentProcessExplicitAppUserModelID("10k.AccountManager"); } catch (Exception) { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new HostForm(uri, data);
        Application.Run(form);
        return form.Result;
    }
}

internal sealed class HostForm : Form
{
    internal const string Title = "10k's Account Manager";
    private static readonly Color Dark = Color.FromArgb(8, 8, 8);

    private readonly WebView2 _wv = new WebView2();
    private readonly Uri _url;
    private readonly string _data;
    private readonly string _stateFile;
    private readonly string _logFile;
    internal int Result;

    internal HostForm(Uri url, string data)
    {
        _url = url;
        _data = data;
        _stateFile = Path.Combine(data, "window.json");
        _logFile = Path.Combine(data, "window-host.log");

        Text = Title;
        BackColor = Dark;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1400, 860);
        RestoreState();

        _wv.Dock = DockStyle.Fill;
        _wv.DefaultBackgroundColor = Dark;
        Controls.Add(_wv);

        Load += OnLoadAsync;
        FormClosing += delegate { SaveState(); };
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    // Black caption on Windows 11, dark caption on Windows 10 1809+. An older Windows keeps the light one.
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1, caption = 0x000000, text = 0x00FFFFFF; // COLORREF is 0x00BBGGRR
        try
        {
            DwmSetWindowAttribute(Handle, 20, ref dark, 4);
            DwmSetWindowAttribute(Handle, 35, ref caption, 4);
            DwmSetWindowAttribute(Handle, 36, ref text, 4);
        }
        catch (Exception) { }
    }

    private async void OnLoadAsync(object sender, EventArgs e)
    {
        try
        {
            string profile = Path.Combine(_data, "webview2-host");
            Directory.CreateDirectory(profile);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, profile);
            await _wv.EnsureCoreWebView2Async(env);

            CoreWebView2Settings s = _wv.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;

            _wv.CoreWebView2.NavigationStarting += OnNavigationStarting;
            _wv.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            _wv.CoreWebView2.ProcessFailed += OnProcessFailed;
            _wv.Source = _url;
        }
        catch (Exception ex)
        {
            Log("start failed: " + ex.Message);
            Result = 2;
            Close();
        }
    }

    private bool SameOrigin(Uri u)
    {
        return u.Host == _url.Host && u.Port == _url.Port;
    }

    // Only the manager's own pages load here. A link to anywhere else opens in the default browser.
    private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        Uri u;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out u)) return;
        if ((u.Scheme == "http" || u.Scheme == "https") && !SameOrigin(u))
        {
            e.Cancel = true;
            OpenExternal(u);
        }
    }

    private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        Uri u;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out u)) OpenExternal(u);
    }

    private static void OpenExternal(Uri u)
    {
        if (u.Scheme != "http" && u.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (Exception) { }
    }

    private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log("webview process failed: " + e.ProcessFailedKind);
        try
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Result = 2;
                BeginInvoke((Action)Close);
            }
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                     e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                BeginInvoke((Action)(delegate { try { _wv.Reload(); } catch (Exception) { } }));
            }
        }
        catch (Exception) { }
    }

    // Window position and size are kept between runs; a saved spot that is no longer on any screen is ignored.
    private void RestoreState()
    {
        try
        {
            if (!File.Exists(_stateFile)) return;
            string text = File.ReadAllText(_stateFile, Encoding.UTF8);
            int x = Num(text, "x"), y = Num(text, "y"), w = Num(text, "w"), h = Num(text, "h");
            if (w < MinimumSize.Width || h < MinimumSize.Height || w > 10000 || h > 10000) return;
            Rectangle r = new Rectangle(x, y, w, h);
            bool visible = false;
            foreach (Screen sc in Screen.AllScreens)
            {
                Rectangle hit = Rectangle.Intersect(sc.WorkingArea, r);
                if (hit.Width >= 200 && hit.Height >= 100) visible = true;
            }
            if (!visible) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = r;
            if (Num(text, "max") == 1) WindowState = FormWindowState.Maximized;
        }
        catch (Exception) { }
    }

    private static int Num(string json, string key)
    {
        int i = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
        if (i < 0) return 0;
        i = json.IndexOf(':', i);
        if (i < 0) return 0;
        i++;
        int j = i;
        while (j < json.Length && (char.IsWhiteSpace(json[j]) || json[j] == '-' || char.IsDigit(json[j]))) j++;
        int v;
        return int.TryParse(json.Substring(i, j - i).Trim(), out v) ? v : 0;
    }

    private void SaveState()
    {
        try
        {
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            string json = "{\"x\":" + r.X + ",\"y\":" + r.Y + ",\"w\":" + r.Width + ",\"h\":" + r.Height +
                          ",\"max\":" + (WindowState == FormWindowState.Maximized ? 1 : 0) + "}";
            File.WriteAllText(_stateFile, json, new UTF8Encoding(false));
        }
        catch (Exception) { }
    }

    private void Log(string line)
    {
        try { File.AppendAllText(_logFile, DateTime.Now.ToString("s") + " " + line + Environment.NewLine); } catch (Exception) { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _wv.Dispose();
        base.Dispose(disposing);
    }
}
