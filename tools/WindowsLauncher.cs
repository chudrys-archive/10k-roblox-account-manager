using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Isa's Roblox Account Manager")]
[assembly: AssemblyProduct("Isa's Roblox Account Manager")]

// ──────────────────────────────────────────────────────────────────────────────
//  WindowsLauncher — self-extracting installer + WinForms/WebView2 host
//
//  Design:
//    1. Installs the exe to %LOCALAPPDATA%\IsaRobloxAccountManager\ (unchanged).
//    2. Starts node.exe with --no-ui; launcher owns the browser window.
//    3. Polls DATA/manager.lock until the HTTP server is ready (up to 30 s).
//    4. Opens a WinForms window with an embedded WebView2 control.
//       No Edge app-mode window; no window-reuse bugs.
//    5. Job object ensures node.exe dies if the launcher is killed.
//
//  Assembly resolution:
//    Microsoft.Web.WebView2.{Core,WinForms}.dll are embedded as manifest
//    resources and loaded from memory via AppDomain.AssemblyResolve.
//    WebView2Loader.dll is a native DLL; it is extracted to appDir at startup
//    so Windows can find it via the standard DLL search path.
// ──────────────────────────────────────────────────────────────────────────────

internal static class WindowsLauncher
{
    private const string AppName     = "IsaRobloxAccountManager";
    private const string FriendlyName = "Isa's Roblox Account Manager";

    // Static constructor runs before Main, so the resolver is in place before
    // any method that references WebView2 types is JIT-compiled.
    static WindowsLauncher()
    {
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
    }

    private static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs args)
    {
        string simpleName = new AssemblyName(args.Name).Name;
        Stream stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(simpleName + ".dll");
        if (stream == null) return null;
        byte[] bytes = new byte[stream.Length];
        stream.Read(bytes, 0, bytes.Length);
        return Assembly.Load(bytes);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var appDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppName);
            Directory.CreateDirectory(appDir);

            var assembly    = Assembly.GetExecutingAssembly();
            var currentExe  = Path.GetFullPath(assembly.Location);
            var installedExe = Path.Combine(appDir, AppName + ".exe");

            // ---- Unpack the embedded runtime zip ----
            string payloadHash;
            var runtime = UnpackRuntime(assembly, Path.Combine(appDir, "runtime"), out payloadHash);

            // ---- Detect a live instance before touching the runtime folders ----
            var earlyDataDir = Environment.GetEnvironmentVariable("IRAM_DATA_DIR");
            earlyDataDir = string.IsNullOrWhiteSpace(earlyDataDir)
                ? Path.Combine(appDir, "data")
                : Path.GetFullPath(earlyDataDir);
            bool instanceAlive = IsManagerAlive(Path.Combine(earlyDataDir, "manager.lock"));

            // ---- Install / update ----
            var hashFile    = Path.Combine(appDir, "installed.hash");
            var storedHash  = File.Exists(hashFile) ? File.ReadAllText(hashFile).Trim() : "";
            var isInstalledCopy = string.Equals(currentExe, Path.GetFullPath(installedExe),
                StringComparison.OrdinalIgnoreCase);

            var needsInstall = !string.Equals(storedHash, payloadHash, StringComparison.OrdinalIgnoreCase)
                               || !File.Exists(installedExe);

            if (needsInstall)
            {
                IOException copyErr = null;
                try { File.Copy(currentExe, installedExe, overwrite: true); }
                catch (IOException ex) { copyErr = ex; }
                if (copyErr != null && !isInstalledCopy)
                    throw new InvalidOperationException(
                        "Could not replace the installed copy of the manager — it may still be running.\n" +
                        "Close the manager and try again.\n\n(" + copyErr.Message + ")");

                File.WriteAllText(hashFile, payloadHash);

                try
                {
                    var startMenuDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                    Directory.CreateDirectory(startMenuDir);
                    CreateShortcut(Path.Combine(startMenuDir, FriendlyName + ".lnk"),
                        installedExe, FriendlyName);
                }
                catch { /* shortcuts are best-effort */ }

                if (!instanceAlive) CleanOldRuntimes(Path.Combine(appDir, "runtime"), payloadHash);

                if (!isInstalledCopy)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName        = installedExe,
                        Arguments       = QuoteArgs(args),
                        UseShellExecute = true,
                    });
                    return 0; // installed copy takes over
                }
            }

            // ---- Extract native WebView2 loader next to the exe ----
            // The managed WebView2 assemblies P/Invoke into WebView2Loader.dll.
            // Windows finds it via the exe's directory (first entry in DLL search path).
            ExtractEmbeddedToDisk(assembly, "WebView2Loader.dll",
                Path.Combine(appDir, "WebView2Loader.dll"));

            // ---- Resolve data directory ----
            var dataDir = Environment.GetEnvironmentVariable("IRAM_DATA_DIR");
            dataDir = string.IsNullOrWhiteSpace(dataDir)
                ? Path.Combine(appDir, "data")
                : Path.GetFullPath(dataDir);

            var launcherExe = File.Exists(installedExe) ? installedExe : currentExe;

            // ---- Start Node.js with --no-ui (launcher owns the window) ----
            var startInfo = new ProcessStartInfo
            {
                FileName        = Path.Combine(runtime, "node.exe"),
                Arguments       = "src\\main.js --no-ui",
                WorkingDirectory = runtime,
                UseShellExecute  = false,
                CreateNoWindow   = true
            };
            startInfo.EnvironmentVariables["IRAM_DATA_DIR"]    = dataDir;
            startInfo.EnvironmentVariables["IRAM_LAUNCHER_EXE"] = launcherExe;

            var nodeProcess = Process.Start(startInfo);
            KillWithThisProcess(nodeProcess);

            // ---- Wait for the HTTP server to be ready ----
            var lockPath   = Path.Combine(dataDir, "manager.lock");
            string managerUrl = WaitForServer(lockPath, nodeProcess, 30000);
            if (managerUrl == null)
            {
                int exitCode = -1;
                try { if (nodeProcess.HasExited) exitCode = nodeProcess.ExitCode; } catch { }
                throw new InvalidOperationException(
                    exitCode > 0
                        ? "The manager exited with code " + exitCode + ".\n" +
                          "Check logs in " + Path.Combine(dataDir, "logs") + "."
                        : "The manager did not start within 30 seconds.\n" +
                          "Check logs in " + Path.Combine(dataDir, "logs") + ".");
            }

            // ---- Run the native window (WebView2 form) ----
            // ShowManagerWindow is a separate method so its body is JIT-compiled
            // only after the assembly resolver above is registered — that guarantees
            // the WebView2 managed DLLs resolve from embedded resources.
            ShowManagerWindow(managerUrl, appDir, nodeProcess);

            // Form closed: kill node if it is still running.
            try { if (!nodeProcess.HasExited) nodeProcess.Kill(); } catch { }
            nodeProcess.Dispose();
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, FriendlyName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Keep this in a separate method so the JIT does not load ManagerForm
    // (and therefore WebView2 assemblies) until after AssemblyResolve is hooked.
    private static void ShowManagerWindow(string url, string appDir, Process nodeProcess)
    {
        using (var form = new ManagerForm(url, appDir))
        {
            // If Node crashes (non-zero exit), close the window so the user knows.
            try
            {
                nodeProcess.EnableRaisingEvents = true;
                nodeProcess.Exited += (s, e) =>
                {
                    try
                    {
                        int code = -1;
                        try { code = nodeProcess.ExitCode; } catch { }
                        if (code != 0 && !form.IsDisposed)
                            form.BeginInvoke((Action)form.Close);
                    }
                    catch { }
                };
            }
            catch { /* process may have already exited; that's fine */ }

            Application.Run(form);
        }
    }

    // Poll DATA/manager.lock until {port, token} appear and the PID is alive.
    // Returns the manager URL, or null on timeout / Node crash.
    private static string WaitForServer(string lockPath, Process nodeProcess, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            // Fail fast if Node crashed before writing the lock file.
            try
            {
                if (nodeProcess.HasExited && nodeProcess.ExitCode != 0)
                    return null;
            }
            catch { }

            try
            {
                if (File.Exists(lockPath))
                {
                    string json = File.ReadAllText(lockPath);

                    Match pidM  = Regex.Match(json, "\"pid\"\\s*:\\s*(\\d+)");
                    Match portM = Regex.Match(json, "\"port\"\\s*:\\s*(\\d+)");
                    Match tokM  = Regex.Match(json, "\"token\"\\s*:\\s*\"([^\"]+)\"");

                    if (pidM.Success && portM.Success && tokM.Success)
                    {
                        int pid = int.Parse(pidM.Groups[1].Value);

                        // Reject stale lock files left by a previous crash.
                        bool pidAlive = false;
                        try { Process.GetProcessById(pid); pidAlive = true; } catch { }
                        if (!pidAlive) { Thread.Sleep(500); continue; }

                        string port  = portM.Groups[1].Value;
                        string token = tokM.Groups[1].Value;
                        return "http://127.0.0.1:" + port + "/?t=" + Uri.EscapeDataString(token);
                    }
                }
            }
            catch { /* lock file may be partially written — retry */ }

            Thread.Sleep(500);
        }
        return null;
    }

    // Write an embedded resource to a file on disk (always overwrites).
    // The DLL is not yet loaded into this process, so overwriting is safe.
    private static void ExtractEmbeddedToDisk(Assembly assembly, string resourceName, string destPath)
    {
        Stream stream = assembly.GetManifestResourceStream(resourceName);
        if (stream == null) return;
        byte[] bytes = new byte[stream.Length];
        stream.Read(bytes, 0, bytes.Length);
        try { File.WriteAllBytes(destPath, bytes); } catch { }
    }

    // Quote args for re-launch: wrap in double quotes if the arg contains spaces.
    private static string QuoteArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Contains(" "))
            {
                sb.Append('"');
                sb.Append(a.Replace("\"", "\"\""));
                sb.Append('"');
            }
            else sb.Append(a);
        }
        return sb.ToString();
    }

    // Create a Windows .lnk shortcut via the WScript.Shell COM object.
    private static void CreateShortcut(string lnkPath, string targetPath, string description)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        var shell = Activator.CreateInstance(shellType);
        var sc = shellType.InvokeMember("CreateShortcut",
            BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
        var scType = sc.GetType();
        scType.InvokeMember("TargetPath",   BindingFlags.SetProperty, null, sc, new object[] { targetPath });
        scType.InvokeMember("Description",  BindingFlags.SetProperty, null, sc, new object[] { description });
        scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { targetPath + ",0" });
        scType.InvokeMember("Save",         BindingFlags.InvokeMethod, null, sc, null);
    }

    // True when manager.lock names a PID that is still running. A live instance
    // runs from its own runtime folder, so that folder must not be deleted.
    private static bool IsManagerAlive(string lockPath)
    {
        try
        {
            if (!File.Exists(lockPath)) return false;
            var m = Regex.Match(File.ReadAllText(lockPath), "\"pid\"\\s*:\\s*(\\d+)");
            if (!m.Success) return false;
            Process.GetProcessById(int.Parse(m.Groups[1].Value));
            return true;
        }
        catch { return false; }
    }

    // Delete runtime subdirectories from old versions to reclaim disk space.
    private static void CleanOldRuntimes(string runtimeDir, string keepHash)
    {
        try
        {
            if (!Directory.Exists(runtimeDir)) return;
            foreach (var dir in Directory.GetDirectories(runtimeDir))
            {
                if (!string.Equals(Path.GetFileName(dir), keepHash, StringComparison.OrdinalIgnoreCase))
                    try { Directory.Delete(dir, recursive: true); } catch { }
            }
        }
        catch { }
    }

    // ── Job object: ending this exe also ends node.exe ─────────────────────────
    private static IntPtr job = IntPtr.Zero;
    private const int  JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE  = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long    PerProcessUserTimeLimit;
        public long    PerJobUserTimeLimit;
        public uint    LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint    ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint    PriorityClass;
        public uint    SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    private static void KillWithThisProcess(Process process)
    {
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return;
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
            if (SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info,
                    Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                AssignProcessToJobObject(job, process.Handle);
        }
        catch { /* best effort */ }
    }

    // Unpack app.zip embedded resource; returns the destination directory path.
    private static string UnpackRuntime(Assembly assembly, string runtimeDir, out string payloadHash)
    {
        using (var payload = assembly.GetManifestResourceStream("app.zip"))
        using (var sha256  = SHA256.Create())
        {
            var hash = BitConverter.ToString(sha256.ComputeHash(payload)).Replace("-", "");
            payloadHash = hash;
            var destination = Path.Combine(runtimeDir, hash);
            if (Directory.Exists(destination)) return destination;

            Directory.CreateDirectory(runtimeDir);
            var staging = Path.Combine(runtimeDir, Guid.NewGuid().ToString("N") + ".tmp");
            Directory.CreateDirectory(staging);
            try
            {
                payload.Position = 0;
                using (var archive = new ZipArchive(payload, ZipArchiveMode.Read, true))
                    archive.ExtractToDirectory(staging);
                try { Directory.Move(staging, destination); }
                catch (IOException) { if (!Directory.Exists(destination)) throw; }
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
            return destination;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
//  ManagerForm — WinForms window hosting the WebView2 control
// ──────────────────────────────────────────────────────────────────────────────

internal sealed class ManagerForm : Form
{
    private readonly WebView2 _wv;
    private readonly string   _url;
    private readonly string   _appDir;
    private const string Title = "Isa's Roblox Account Manager";

    internal ManagerForm(string url, string appDir)
    {
        _url    = url;
        _appDir = appDir;
        _wv     = new WebView2();

        Text          = Title;
        Width         = 1400;
        Height        = 900;
        StartPosition = FormStartPosition.CenterScreen;

        _wv.Dock = DockStyle.Fill;
        Controls.Add(_wv);

        Load += OnFormLoadAsync;
    }

    private async void OnFormLoadAsync(object sender, EventArgs e)
    {
        try
        {
            string userDataFolder = Path.Combine(_appDir, "webview2-data");
            Directory.CreateDirectory(userDataFolder);

            CoreWebView2Environment env =
                await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await _wv.EnsureCoreWebView2Async(env);

            // Open target="_blank" links in the user's default browser, not a new WebView2 window.
            _wv.CoreWebView2.NewWindowRequested += OnNewWindowRequested;

            _wv.Source = new Uri(_url);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not start the browser view:\n" + ex.Message,
                Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void OnNewWindowRequested(object sender,
        CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); }
        catch { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && _wv != null) _wv.Dispose();
        base.Dispose(disposing);
    }
}
