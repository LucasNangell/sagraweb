using System.Diagnostics;

namespace SagraLetreiro.Tests;

public class RemoteScriptTests
{
    static int NewJobId() => Random.Shared.Next(10_000, 1_000_000_000);

    [Fact]
    public void ExecuteCapturesStdout()
    {
        var outcome = RemoteScript.Execute("bat", "@echo hello-letreiro", NewJobId(), 10);
        Assert.False(outcome.TimedOut);
        Assert.Equal(0, outcome.ExitCode);
        Assert.Contains("hello-letreiro", outcome.Stdout);
    }

    [Fact]
    public void ExecuteCapturesFailureExitCode()
    {
        var outcome = RemoteScript.Execute("bat", "exit /b 7", NewJobId(), 10);
        Assert.False(outcome.TimedOut);
        Assert.Equal(7, outcome.ExitCode);
    }

    [Fact(Timeout = 20000)]
    public async Task ExecuteTimesOutAndKillsHungProcess()
    {
        var sw = Stopwatch.StartNew();
        var outcome = await Task.Run(() => RemoteScript.Execute("bat", "ping -n 40 127.0.0.1", NewJobId(), 5));
        sw.Stop();
        Assert.True(outcome.TimedOut);
        Assert.Contains(RemoteScript.TimeoutMessage, outcome.Stderr, StringComparison.OrdinalIgnoreCase);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(12), $"demorou {sw.Elapsed}");
    }

    [Fact(Timeout = 20000)]
    public async Task ExecutePowerShellErrorDoesNotHang()
    {
        var sw = Stopwatch.StartNew();
        var outcome = await Task.Run(() => RemoteScript.Execute("ps1", "throw 'falha-letreiro'", NewJobId(), 10));
        sw.Stop();
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(15), $"demorou {sw.Elapsed}");
        Assert.False(outcome.TimedOut);
        Assert.NotEqual(0, outcome.ExitCode ?? 0);
        Assert.Contains("falha-letreiro", outcome.Stdout + outcome.Stderr, StringComparison.OrdinalIgnoreCase);
    }
}
