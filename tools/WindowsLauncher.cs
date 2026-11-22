using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Isa's Roblox Account Manager")]
[assembly: AssemblyProduct("Isa's Roblox Account Manager")]

internal static class WindowsLauncher
{
    private const string AppName = "IsaRobloxAccountManager";
    private const string FriendlyName = "Isa's Roblox Account Manager";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var appDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppName);
            Directory.CreateDirectory(appDir);

            var assembly = Assembly.GetExecutingAssembly();
            var currentExe = Path.GetFullPath(assembly.Location);
            var installedExe = Path.Combine(appDir, AppName + ".exe");

            // Unpack the embedded runtime zip — skips extraction if the hash dir already exists
            string payloadHash;
            var runtime = UnpackRuntime(assembly, Path.Combine(appDir, "runtime"), out payloadHash);

            // ---- Install / update ----
            var hashFile = Path.Combine(appDir, "installed.hash");
            var storedHash = File.Exists(hashFile) ? File.ReadAllText(hashFile).Trim() : "";
            var isInstalledCopy = string.Equals(currentExe, Path.GetFullPath(installedExe),
                StringComparison.OrdinalIgnoreCase);

            var needsInstall = !string.Equals(storedHash, payloadHash, StringComparison.OrdinalIgnoreCase)
                               || !File.Exists(installedExe);

            if (needsInstall)
            {
                // Copy this exe to the permanent install location, overwriting the old one.
                // If the installed copy is currently locked (old version still running) we tell the
                // user to close it first rather than silently failing.
                IOException copyErr = null;
                try { File.Copy(currentExe, installedExe, overwrite: true); }
                catch (IOException ex) { copyErr = ex; }
                if (copyErr != null && !isInstalledCopy)
                    throw new InvalidOperationException(
                        "Could not replace the installed copy of the manager — it may still be running.\n" +
                        "Close the manager and try again.\n\n(" + copyErr.Message + ")");

                File.WriteAllText(hashFile, payloadHash);

                // Start Menu shortcut — goes into the user's own Programs folder, no admin needed.
                try
                {
                    var startMenuDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                    Directory.CreateDirectory(startMenuDir);
                    CreateShortcut(
                        Path.Combine(startMenuDir, FriendlyName + ".lnk"),
                        installedExe,
                        FriendlyName);
                }
                catch { /* shortcuts are best-effort */ }

                // Remove runtime directories from old versions to reclaim disk space.
                CleanOldRuntimes(Path.Combine(appDir, "runtime"), payloadHash);

                // If we are running from outside the install directory (e.g. the user
                // double-clicked the downloaded exe), hand control to the installed copy
                // so the app always runs from one known, stable location.
                if (!isInstalledCopy)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = installedExe,
                        Arguments = QuoteArgs(args),
                        UseShellExecute = true,
                    });
                    return 0; // installed copy takes over
                }
            }

            // ---- Launch the Node.js manager ----
            var dataDir = Environment.GetEnvironmentVariable("IRAM_DATA_DIR");
            dataDir = string.IsNullOrWhiteSpace(dataDir)
                ? Path.Combine(appDir, "data")
                : Path.GetFullPath(dataDir);

            // Advertise the installed path so autostart entries and desktop shortcuts created
            // by the manager's UI always point to the stable location, not to whatever temp
            // directory or Downloads folder the user originally ran the exe from.
            var launcherExe = File.Exists(installedExe) ? installedExe : currentExe;

            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(runtime, "node.exe"),
                Arguments = "src\\main.js" + (Array.IndexOf(args, "--no-ui") >= 0 ? " --no-ui" : ""),
                WorkingDirectory = runtime,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            startInfo.EnvironmentVariables["IRAM_DATA_DIR"] = dataDir;
            startInfo.EnvironmentVariables["IRAM_LAUNCHER_EXE"] = launcherExe;

            using (var process = Process.Start(startInfo))
            {
                KillWithThisProcess(process);
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
                throw new InvalidOperationException(
                    "The manager exited with code " + process.ExitCode +
                    ". Check the logs in " + Path.Combine(dataDir, "logs") + ".");
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, FriendlyName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Quote args for re-launch: wrap in double quotes if the arg contains spaces.
    private static string QuoteArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Contains(" ")) { sb.Append('"'); sb.Append(a.Replace("\"", "\"\"")); sb.Append('"'); }
            else sb.Append(a);
        }
        return sb.ToString();
    }

    // Create a Windows .lnk shortcut via the WScript.Shell COM object.
    // WScript.Shell is registered on every Windows installation; no extra reference required.
    private static void CreateShortcut(string lnkPath, string targetPath, string description)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        var shell = Activator.CreateInstance(shellType);
        var sc = shellType.InvokeMember("CreateShortcut",
            BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
        var scType = sc.GetType();
        scType.InvokeMember("TargetPath",    BindingFlags.SetProperty, null, sc, new object[] { targetPath });
        scType.InvokeMember("Description",   BindingFlags.SetProperty, null, sc, new object[] { description });
        scType.InvokeMember("IconLocation",  BindingFlags.SetProperty, null, sc, new object[] { targetPath + ",0" });
        scType.InvokeMember("Save",          BindingFlags.InvokeMethod, null, sc, null);
    }

    // Delete runtime subdirectories whose name does not match keepHash.
    // Each subdirectory is a full Node runtime + app bundle for one version; they can be ~200 MB each.
    private static void CleanOldRuntimes(string runtimeDir, string keepHash)
    {
        try
        {
            if (!Directory.Exists(runtimeDir)) return;
            foreach (var dir in Directory.GetDirectories(runtimeDir))
            {
                if (!string.Equals(Path.GetFileName(dir), keepHash, StringComparison.OrdinalIgnoreCase))
                {
                    try { Directory.Delete(dir, recursive: true); } catch { /* best-effort */ }
                }
            }
        }
        catch { /* best-effort */ }
    }

    // ---- job object: ending this exe (even from Task Manager) also ends node.exe ----
    // KILL_ON_JOB_CLOSE ends node.exe when our handle closes, which Windows does when this process
    // exits for any reason. SILENT_BREAKAWAY_OK keeps node's own children (Roblox clients, the
    // multi-instance lock holder, the window helper) out of the job, so Roblox games are never killed;
    // the window helper exits by itself when node's pipe closes.
    private static IntPtr job = IntPtr.Zero;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
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
            {
                AssignProcessToJobObject(job, process.Handle);
            }
        }
        catch (Exception)
        {
            // best effort: without the job the manager still works, it just is not ended with us
        }
    }

    private static string UnpackRuntime(Assembly assembly, string runtimeDir, out string payloadHash)
    {
        using (var payload = assembly.GetManifestResourceStream("app.zip"))
        using (var sha256 = SHA256.Create())
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
                {
                    archive.ExtractToDirectory(staging);
                }
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
