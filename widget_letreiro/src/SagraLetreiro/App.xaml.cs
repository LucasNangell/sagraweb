using System.Windows;
using System.Windows.Threading;

namespace SagraLetreiro;

public partial class App : Application
{
    Mutex? _mutex;
    OverlayWindow? _overlay;
    UpdateService? _updater;

    public static AppConfig CurrentConfig { get; set; } = ConfigStore.Normalize(new AppConfig());

    protected override void OnStartup(StartupEventArgs e)
    {
        var name = $@"Local\SagraLetreiro_{Environment.UserName}";
        _mutex = new Mutex(true, name, out var created);
        if (!created)
        {
            MessageBox.Show("Já existe um letreiro em execução.", "SAGRA Letreiro");
            _mutex.Dispose();
            _mutex = null;
            Shutdown();
            return;
        }

        DispatcherUnhandledException += OnUnhandled;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            AppLog.Error("Exceção não tratada", args.ExceptionObject as Exception);

        try
        {
            CurrentConfig = ConfigStore.Load();
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha ao carregar config", ex);
            CurrentConfig = ConfigStore.Normalize(new AppConfig { Board = ConfigStore.DefaultBoard() });
        }

        base.OnStartup(e);
        AppLog.Info($"SAGRA Letreiro {UpdateService.CurrentVersion} iniciado");
        _overlay = new OverlayWindow(CurrentConfig);
        MainWindow = _overlay;
        _overlay.Show();

        _updater = new UpdateService();
        _ = _updater.StartAsync();
    }

    public static void CheckUpdatesFromMenu()
    {
        if (Current is not App app || app._updater is null) return;
        var found = app._updater.PeekNewerSetup();
        if (found is null)
        {
            MessageBox.Show("Nenhuma atualização encontrada na pasta compartilhada.", "SAGRA Letreiro");
            return;
        }
        _ = app._updater.CheckAsync(silent: false);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _updater?.Dispose();
        try { _mutex?.ReleaseMutex(); } catch { }
        _mutex?.Dispose();
        base.OnExit(e);
    }

    void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("Exceção no dispatcher", e.Exception);
        e.Handled = true;
    }
}
