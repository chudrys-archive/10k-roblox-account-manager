// Sign-in window of 10k's Account Manager: a WebView2 window with its own throwaway profile that loads roblox.com/login (or
// /signup), watches for the .ROBLOSECURITY cookie and hands it to the manager over the same local capture channel the Chrome
// extension uses (/capture/status, /capture/offer, /capture/qr, /capture/closed, token from manager.lock).
// Nothing here writes the cookie to disk or to the log. The profile folder is deleted when the window closes.
//
//   10k-window.exe --login --data C:\path\to\data [--url https://www.roblox.com/login] [--qr]
//
// Built together with AppWindow.cs by tools\build-window.ps1 (.NET Framework compiler, C# 5: no newer syntax).
using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class LoginForm : Form
{
    private static readonly Color Dark = Color.FromArgb(8, 8, 8);

    // Runs in the page: switch the login page to its QR code and return the code as a data URL (null until it is on screen).
    private const string QrScript =
        "(async function () {" +
        " var img = document.querySelector('.cross-device-login-display-qr-code-image');" +
        " if (!img) {" +
        "  var b = Array.prototype.slice.call(document.querySelectorAll('button')).filter(function (x) { return /qr code/i.test(x.innerText || ''); })[0];" +
        "  if (b) b.click();" +
        "  return null;" +
        " }" +
        " if (String(img.src).indexOf('data:') === 0) return img.src;" +
        " var blob = await (await fetch(img.src)).blob();" +
        " return await new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(blob); });" +
        "})()";

    private readonly WebView2 _wv = new WebView2();
    private readonly string _data;
    private readonly string _profile;
    private readonly Uri _start;
    private readonly bool _qr;
    private readonly System.Windows.Forms.Timer _timer = new System.Windows.Forms.Timer();
    private readonly string _logFile;
    private bool _busy;
    private bool _finished;   // the manager took the cookie or stopped waiting: close without telling it we were closed
    private int _failures;    // consecutive status polls that got no answer
    private int _ticks;
    private string _until;   // the manager's wait this window was opened for; a different one means a newer login took over
    private bool _closedSent;
    internal int Result;

    internal LoginForm(string data, Uri start, bool qr)
    {
        _data = data;
        _start = start;
        _qr = qr;
        _logFile = Path.Combine(data, "window-host.log");
        _profile = Path.Combine(Path.Combine(data, "webview2-login"), Guid.NewGuid().ToString("N"));

        Text = "Sign in to Roblox - 10k's Account Manager";
        BackColor = Dark;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        MinimumSize = new Size(480, 600);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 800);

        _wv.Dock = DockStyle.Fill;
        _wv.DefaultBackgroundColor = Dark;
        Controls.Add(_wv);

        _timer.Interval = 1000;
        _timer.Tick += OnTick;

        Load += OnLoadAsync;
        FormClosing += OnClosing;
        FormClosed += delegate { CleanProfileLater(); };
    }

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1, caption = 0x000000, text = 0x00FFFFFF;
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
            PurgeOldProfiles();
            Directory.CreateDirectory(_profile);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, _profile);
            await _wv.EnsureCoreWebView2Async(env);

            CoreWebView2Settings s = _wv.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.AreDevToolsEnabled = false;

            _wv.CoreWebView2.NavigationStarting += OnNavigationStarting;
            _wv.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            _wv.CoreWebView2.ProcessFailed += OnProcessFailed;
            _wv.Source = _start;
            _timer.Start();
        }
        catch (Exception ex)
        {
            Log("login window start failed: " + ex.Message);
            Result = 2;
            _finished = true;
            Close();
        }
    }

    internal static bool IsRoblox(Uri u)
    {
        if (u.Scheme != "https") return false;
        string h = u.Host.ToLowerInvariant();
        return h == "roblox.com" || h.EndsWith(".roblox.com", StringComparison.Ordinal);
    }

    // Only Roblox pages load at the top level. Anything else (an ad, a support link) opens in the default browser instead.
    private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        Uri u;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out u)) return;
        if (u.Scheme == "about" || u.Scheme == "data") return;
        if (!IsRoblox(u))
        {
            e.Cancel = true;
            OpenExternal(u);
        }
    }

    private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        Uri u;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out u)) return;
        if (IsRoblox(u)) { try { _wv.CoreWebView2.Navigate(u.AbsoluteUri); } catch (Exception) { } }
        else OpenExternal(u);
    }

    private static void OpenExternal(Uri u)
    {
        if (u.Scheme != "http" && u.Scheme != "https") return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (Exception) { }
    }

    private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log("login webview process failed: " + e.ProcessFailedKind);
        try
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Result = 2;
                _finished = true;
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

    private async void OnTick(object sender, EventArgs e)
    {
        if (_busy || _finished || _wv.CoreWebView2 == null) return;
        _busy = true;
        try
        {
            _ticks++;
            string lockText = ReadLock();
            string status = lockText == null ? null : await Task.Run(() => Http(lockText, "GET", "/capture/status", null));
            if (status == null) _failures++; else _failures = 0;
            // the manager is gone, was restarted (new token) or stopped waiting for this login: nothing left to do here
            if (_failures >= 4 || (status != null && status.IndexOf("\"armed\":true", StringComparison.Ordinal) < 0))
            {
                _finished = true;
                Close();
                return;
            }
            if (status == null) return;
            string until = JsonValue(status, "until", false);
            if (_until == null) _until = until;
            else if (until != _until)
            {
                _finished = true;
                Close();
                return;
            }

            string cookie = null;
            try
            {
                var list = await _wv.CoreWebView2.CookieManager.GetCookiesAsync("https://www.roblox.com/");
                foreach (CoreWebView2Cookie c in list)
                    if (c.Name == ".ROBLOSECURITY" && !string.IsNullOrEmpty(c.Value)) { cookie = c.Value; break; }
            }
            catch (Exception) { }

            string body = "{\"cookie\":" + (cookie == null ? "null" : "\"" + JsonEscape(cookie) + "\"") + ",\"tabs\":1}";
            string reply = await Task.Run(() => Http(lockText, "POST", "/capture/offer", body));
            cookie = null;
            if (reply != null && reply.IndexOf("\"accepted\":true", StringComparison.Ordinal) >= 0)
            {
                _finished = true;
                Close();
                return;
            }

            if (_qr && _ticks % 2 == 0 && _wv.Source != null && _wv.Source.AbsolutePath.StartsWith("/login", StringComparison.Ordinal))
                await SendQrAsync(lockText);
        }
        catch (Exception ex)
        {
            Log("login tick: " + ex.Message);
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task SendQrAsync(string lockText)
    {
        try
        {
            string args = "{\"expression\":" + "\"" + JsonEscape(QrScript) + "\"" + ",\"awaitPromise\":true,\"returnByValue\":true}";
            string res = await _wv.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", args);
            int i = res.IndexOf("\"value\":\"data:image/", StringComparison.Ordinal);
            if (i < 0) return;
            i += "\"value\":\"".Length;
            int j = res.IndexOf('"', i);
            if (j < 0) return;
            string src = res.Substring(i, j - i).Replace("\\/", "/");
            await Task.Run(() => Http(lockText, "POST", "/capture/qr", "{\"src\":\"" + JsonEscape(src) + "\"}"));
        }
        catch (Exception) { }
    }

    // Closing the window by hand before the cookie was captured cancels the manager's wait so later logins are not blocked.
    private void OnClosing(object sender, FormClosingEventArgs e)
    {
        _timer.Stop();
        if (_finished || _closedSent) return;
        _closedSent = true;
        try
        {
            string lockText = ReadLock();
            if (lockText != null) Http(lockText, "POST", "/capture/closed", "{}");
        }
        catch (Exception) { }
    }

    private string ReadLock()
    {
        try
        {
            string text = File.ReadAllText(Path.Combine(_data, "manager.lock"), Encoding.UTF8);
            return text.IndexOf("captureToken", StringComparison.Ordinal) < 0 ? null : text;
        }
        catch (Exception) { return null; }
    }

    private static string JsonValue(string json, string key, bool quoted)
    {
        int i = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
        if (i < 0) return null;
        i = json.IndexOf(':', i);
        if (i < 0) return null;
        i++;
        while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
        if (quoted)
        {
            if (i >= json.Length || json[i] != '"') return null;
            int j = json.IndexOf('"', i + 1);
            return j < 0 ? null : json.Substring(i + 1, j - i - 1);
        }
        int k = i;
        while (k < json.Length && char.IsDigit(json[k])) k++;
        return k > i ? json.Substring(i, k - i) : null;
    }

    // One small request to the manager on 127.0.0.1. Returns the response text, or null when the manager did not answer well.
    private static string Http(string lockText, string method, string path, string body)
    {
        try
        {
            string port = JsonValue(lockText, "port", false);
            string token = JsonValue(lockText, "captureToken", true);
            if (port == null || token == null) return null;
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            req.Method = method;
            req.Timeout = 4000;
            req.ReadWriteTimeout = 4000;
            req.Proxy = null;
            req.Headers["x-capture-token"] = token;
            if (body != null)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(body);
                req.ContentType = "application/json";
                req.ContentLength = bytes.Length;
                using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            }
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var rd = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return rd.ReadToEnd();
        }
        catch (Exception) { return null; }
    }

    private static string JsonEscape(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        foreach (char ch in s)
        {
            if (ch == '"') sb.Append("\\\"");
            else if (ch == '\\') sb.Append("\\\\");
            else if (ch == '\n') sb.Append("\\n");
            else if (ch == '\r') sb.Append("\\r");
            else if (ch == '\t') sb.Append("\\t");
            else if (ch < ' ') sb.Append("\\u").Append(((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    // Profiles of earlier login windows (a crash can leave one behind). Locked ones are skipped and tried again next time.
    private void PurgeOldProfiles()
    {
        try
        {
            string root = Path.Combine(_data, "webview2-login");
            if (!Directory.Exists(root)) return;
            foreach (string d in Directory.GetDirectories(root))
                try { Directory.Delete(d, true); } catch (Exception) { }
        }
        catch (Exception) { }
    }

    // The browser processes release the profile a moment after the window closes, so deleting is retried for a few seconds.
    private void CleanProfileLater()
    {
        string dir = _profile;
        try { _wv.Dispose(); } catch (Exception) { }
        for (int i = 0; i < 10; i++)
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); return; } catch (Exception) { Thread.Sleep(500); }
        }
    }

    private void Log(string line)
    {
        try { File.AppendAllText(_logFile, DateTime.Now.ToString("s") + " " + line + Environment.NewLine); } catch (Exception) { }
    }
}
