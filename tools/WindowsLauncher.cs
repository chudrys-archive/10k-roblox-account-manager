using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
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
