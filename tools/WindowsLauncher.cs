using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows.Forms;

[assembly: AssemblyTitle("Isa's Roblox Account Manager")]
[assembly: AssemblyProduct("Isa's Roblox Account Manager")]

internal static class WindowsLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var appDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "IsaRobloxAccountManager");
            var assembly = Assembly.GetExecutingAssembly();
            var runtime = UnpackRuntime(assembly, Path.Combine(appDir, "runtime"));
            var dataDir = Environment.GetEnvironmentVariable("IRAM_DATA_DIR");
            dataDir = String.IsNullOrWhiteSpace(dataDir)
                ? Path.Combine(appDir, "data")
                : Path.GetFullPath(dataDir);
            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(runtime, "node.exe"),
                Arguments = "src\\main.js" + (Array.IndexOf(args, "--no-ui") >= 0 ? " --no-ui" : ""),
                WorkingDirectory = runtime,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            startInfo.EnvironmentVariables["IRAM_DATA_DIR"] = dataDir;
            startInfo.EnvironmentVariables["IRAM_LAUNCHER_EXE"] = assembly.Location;
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
            MessageBox.Show(error.Message, "Isa's Roblox Account Manager",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
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

    private static string UnpackRuntime(Assembly assembly, string runtimeDir)
    {
        using (var payload = assembly.GetManifestResourceStream("app.zip"))
        using (var sha256 = SHA256.Create())
        {
            var hash = BitConverter.ToString(sha256.ComputeHash(payload)).Replace("-", "");
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
