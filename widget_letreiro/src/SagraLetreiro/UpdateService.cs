using System.Diagnostics;
using System.Reflection;
using System.Windows.Threading;

namespace SagraLetreiro;

internal sealed class UpdateService : IDisposable
{
    static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(5);

    readonly DispatcherTimer _timer;
    bool _busy;
    bool _updating;

    public bool IsUpdating => _updating;

    public string SourceDirectory { get; set; } = ConfigStore.DefaultUpdateSourceDirectory;
    public string FallbackSourceDirectory { get; set; } = ConfigStore.FallbackUpdateSourceDirectory;

    IEnumerable<string> SourceDirectories => [SourceDirectory, FallbackSourceDirectory];

    public static string CurrentVersion =>
        UpdateFinder.Normalize(Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0, 0))
            .ToString(3);

    public UpdateService()
    {
        _timer = new DispatcherTimer { Interval = PollInterval };
        _timer.Tick += async (_, _) => await CheckAsync(silent: true);
    }

    public Task StartAsync()
    {
        _timer.Start();
        return CheckAsync(silent: true);
    }

    public Task CheckAsync(bool silent = true) => CheckCoreAsync(silent);

    async Task CheckCoreAsync(bool silent)
    {
        if (_busy || _updating) return;
        _busy = true;
        try
        {
            await Task.Run(() => { }).ConfigureAwait(true);
            if (!UpdateFinder.TryFindNewerSetup(SourceDirectories, CurrentAssemblyVersion(), out var path))
            {
                if (!silent)
                    AppLog.Info("Nenhuma atualização na pasta compartilhada.");
                return;
            }

            AppLog.Info($"Atualização encontrada: {path}");
            ConfigStore.Save(App.CurrentConfig);
            if (!Launch(path))
            {
                if (!silent)
                    AppLog.Warn("Não foi possível iniciar o instalador.");
                return;
            }

            _updating = true;
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao verificar atualização", ex);
        }
        finally
        {
            _busy = false;
        }
    }

    public string? PeekNewerSetup()
    {
        try
        {
            return UpdateFinder.TryFindNewerSetup(SourceDirectories, CurrentAssemblyVersion(), out var path)
                ? path
                : null;
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao listar instaladores", ex);
            return null;
        }
    }

    static Version CurrentAssemblyVersion() =>
        UpdateFinder.Normalize(Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0, 0));

    static bool Launch(string path)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = path,
                Arguments = "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES",
                UseShellExecute = false,
            });
            return process is not null;
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao iniciar o instalador", ex);
            return false;
        }
    }

    public void Dispose() => _timer.Stop();
}
