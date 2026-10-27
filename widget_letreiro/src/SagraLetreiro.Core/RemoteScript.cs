using System.Diagnostics;
using System.Text;

namespace SagraLetreiro;

public readonly record struct ProcessLaunch(string FileName, IReadOnlyList<string> Arguments, string Extension);

public sealed class RemoteScriptOutcome
{
    public int? ExitCode { get; init; }
    public string Stdout { get; init; } = "";
    public string Stderr { get; init; } = "";
    public bool TimedOut { get; init; }
}

public static class RemoteScript
{
    public const int MaxOutputChars = 64 * 1024;
    public const int TimeoutMinSec = 5;
    public const int TimeoutMaxSec = 300;

    public static ProcessLaunch BuildLaunch(string? kind)
    {
        var k = (kind ?? "").Trim().ToLowerInvariant().TrimStart('.');
        if (k == "ps1")
        {
            return new ProcessLaunch(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"],
                ".ps1");
        }

        return new ProcessLaunch("cmd.exe", ["/c"], ".bat");
    }

    public static string TruncateOutput(string? text)
    {
        var raw = text ?? "";
        return raw.Length <= MaxOutputChars ? raw : raw[..MaxOutputChars] + "\n…[truncado]";
    }

    public static RemoteScriptOutcome Execute(string kind, string content, int jobId, int timeoutSec)
    {
        timeoutSec = Math.Clamp(timeoutSec, TimeoutMinSec, TimeoutMaxSec);
        var launch = BuildLaunch(kind);
        var path = Path.Combine(Path.GetTempPath(), $"sagra-letreiro-{jobId}{launch.Extension}");
        try
        {
            File.WriteAllText(path, content ?? "", new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            var psi = new ProcessStartInfo
            {
                FileName = launch.FileName,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var arg in launch.Arguments)
                psi.ArgumentList.Add(arg);
            psi.ArgumentList.Add(path);

            using var proc = Process.Start(psi);
            if (proc is null)
                return new RemoteScriptOutcome { Stderr = "Não foi possível iniciar o processo.", ExitCode = -1 };

            proc.StandardInput.Close();
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            var finished = proc.WaitForExit(timeoutSec * 1000);
            if (!finished)
            {
                try { proc.Kill(entireProcessTree: true); }
                catch { /* processo já saiu */ }
                try { proc.WaitForExit(5000); }
                catch { /* ignore */ }
            }

            string stdout;
            string stderr;
            try { stdout = stdoutTask.GetAwaiter().GetResult(); }
            catch { stdout = ""; }
            try { stderr = stderrTask.GetAwaiter().GetResult(); }
            catch { stderr = ""; }

            return new RemoteScriptOutcome
            {
                TimedOut = !finished,
                ExitCode = proc.HasExited ? proc.ExitCode : null,
                Stdout = TruncateOutput(stdout),
                Stderr = TruncateOutput(stderr),
            };
        }
        finally
        {
            try { File.Delete(path); }
            catch { /* temp pode ficar preso */ }
        }
    }
}
