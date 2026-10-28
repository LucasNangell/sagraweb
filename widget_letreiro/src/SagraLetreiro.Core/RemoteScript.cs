using System.Diagnostics;
using System.Runtime.InteropServices;
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
    public const string TimeoutMessage = "Tempo esgotado. Processo encerrado.";
    const int StreamDrainMs = 2000;
    const int KillWaitMs = 3000;

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
        try
        {
            return ExecuteCore(kind, content, jobId, timeoutSec);
        }
        catch (Exception ex)
        {
            return new RemoteScriptOutcome
            {
                ExitCode = -1,
                Stderr = "Erro ao executar: " + ex.Message,
            };
        }
    }

    static RemoteScriptOutcome ExecuteCore(string kind, string content, int jobId, int timeoutSec)
    {
        timeoutSec = Math.Clamp(timeoutSec, TimeoutMinSec, TimeoutMaxSec);
        var launch = BuildLaunch(kind);
        var path = Path.Combine(Path.GetTempPath(), $"sagra-letreiro-{jobId}{launch.Extension}");
        Process? proc = null;
        using var job = new ProcessJob();
        var timedOut = false;
        try
        {
            var encoding = launch.Extension == ".ps1"
                ? new UTF8Encoding(encoderShouldEmitUTF8Identifier: true)
                : new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
            File.WriteAllText(path, content ?? "", encoding);
            var psi = new ProcessStartInfo
            {
                FileName = launch.FileName,
                UseShellExecute = false,
                CreateNoWindow = true,
                ErrorDialog = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var arg in launch.Arguments)
                psi.ArgumentList.Add(arg);
            psi.ArgumentList.Add(path);

            proc = Process.Start(psi);
            if (proc is null)
                return new RemoteScriptOutcome { Stderr = "Não foi possível iniciar o processo.", ExitCode = -1 };

            job.Assign(proc);
            try { proc.StandardInput.Close(); }
            catch { /* stdin pode já ter fechado */ }

            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            var finished = WaitExit(proc, timeoutSec * 1000);
            timedOut = !finished;
            if (!finished)
                Stop(proc, job);

            var streamsDone = WaitAll(stdoutTask, stderrTask, finished ? StreamDrainMs : KillWaitMs);
            if (!streamsDone)
            {
                timedOut = true;
                Stop(proc, job);
                WaitAll(stdoutTask, stderrTask, 500);
            }

            var stdout = ReadCompleted(stdoutTask);
            var stderr = ReadCompleted(stderrTask);
            if (timedOut)
                stderr = AppendLine(stderr, TimeoutMessage);

            int? exitCode = null;
            try { if (proc.HasExited) exitCode = proc.ExitCode; }
            catch { /* handle inválido após kill */ }
            if (timedOut && exitCode is null)
                exitCode = -1;

            return new RemoteScriptOutcome
            {
                TimedOut = timedOut,
                ExitCode = exitCode,
                Stdout = TruncateOutput(stdout),
                Stderr = TruncateOutput(stderr),
            };
        }
        finally
        {
            if (timedOut || StillRunning(proc))
                Stop(proc, job);
            proc?.Dispose();
            try { File.Delete(path); }
            catch { /* temp pode ficar preso */ }
        }
    }

    static bool StillRunning(Process? proc)
    {
        if (proc is null) return false;
        try { return !proc.HasExited; }
        catch { return false; }
    }

    static bool WaitExit(Process proc, int timeoutMs)
    {
        try { return proc.WaitForExit(Math.Max(1, timeoutMs)); }
        catch { return proc.HasExited; }
    }

    static bool WaitAll(Task stdoutTask, Task stderrTask, int timeoutMs)
    {
        try { return Task.WaitAll([stdoutTask, stderrTask], Math.Max(1, timeoutMs)); }
        catch { return stdoutTask.IsCompleted && stderrTask.IsCompleted; }
    }

    static string ReadCompleted(Task<string> task)
    {
        if (!task.IsCompleted) return "";
        try { return task.GetAwaiter().GetResult() ?? ""; }
        catch { return ""; }
    }

    static string AppendLine(string text, string line)
    {
        if (string.IsNullOrWhiteSpace(text)) return line;
        return text.TrimEnd() + "\n" + line;
    }

    static void Stop(Process? proc, ProcessJob job)
    {
        job.Terminate();
        if (proc is null) return;
        try
        {
            if (!proc.HasExited)
                proc.Kill(entireProcessTree: true);
        }
        catch { /* já encerrou */ }

        try { proc.WaitForExit(KillWaitMs); }
        catch { /* ignore */ }
    }

    sealed class ProcessJob : IDisposable
    {
        readonly IntPtr _handle;

        public ProcessJob()
        {
            try { _handle = CreateJobObjectW(IntPtr.Zero, null); }
            catch { _handle = IntPtr.Zero; }
        }

        public void Assign(Process proc)
        {
            if (_handle == IntPtr.Zero) return;
            try
            {
                if (!proc.HasExited)
                    AssignProcessToJobObject(_handle, proc.Handle);
            }
            catch { /* processo já em outro job */ }
        }

        public void Terminate()
        {
            if (_handle == IntPtr.Zero) return;
            try { TerminateJobObject(_handle, 1); }
            catch { /* job vazio ou já encerrado */ }
        }

        public void Dispose()
        {
            if (_handle == IntPtr.Zero) return;
            try { CloseHandle(_handle); }
            catch { /* ignore */ }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObjectW(IntPtr jobAttributes, string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);
    }
}
