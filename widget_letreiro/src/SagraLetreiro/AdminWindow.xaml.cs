using System.Windows;
using System.Windows.Input;

namespace SagraLetreiro;

public partial class AdminWindow : Window
{
    readonly LetreiroApiClient _client;
    readonly AppConfig _local;
    List<InstanceRow> _rows = [];

    public AdminWindow(AppConfig local, LetreiroApiClient client)
    {
        InitializeComponent();
        _local = ConfigStore.Normalize(local);
        _client = client;
        Loaded += async (_, _) => await RefreshAsync();
    }

    async Task RefreshAsync()
    {
        StatusText.Text = "Carregando…";
        try
        {
            var items = await _client.FetchLetreiroInstancesAsync();
            _rows = items.Select(InstanceRow.From).ToList();
            Grid.ItemsSource = _rows;
            StatusText.Text = _rows.Count == 0
                ? "Nenhuma instância reportou heartbeat ainda."
                : $"{_rows.Count} instância(s)";
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            AppLog.Warn("Admin instâncias: " + ex.Message);
        }
    }

    async void OnRefresh(object sender, RoutedEventArgs e) => await RefreshAsync();

    async void OnEdit(object sender, RoutedEventArgs e) => await EditSelectedAsync();

    async void OnEdit(object sender, MouseButtonEventArgs e)
    {
        if (Grid.SelectedItem is InstanceRow) await EditSelectedAsync();
    }

    async Task EditSelectedAsync()
    {
        if (Grid.SelectedItem is not InstanceRow row)
        {
            MessageBox.Show(this, "Selecione um computador.", "Letreiro");
            return;
        }
        AppConfig draft;
        try
        {
            draft = await _client.FetchLetreiroConfigAsync(row.HostName, row.WindowsUser)
                    ?? ConfigStore.ForRemote(_local);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Letreiro");
            return;
        }

        AppConfig? saved = null;
        var editor = new SettingsWindow(draft, _client, (cfg, _) => saved = cfg, persistLocal: false)
        {
            Title = $"Configurar {row.HostName} ({row.WindowsUser})",
            Owner = this,
        };
        editor.ShowDialog();
        if (saved is not null)
            await SaveAsync(row.HostName, row.WindowsUser, saved, applyAll: false);
        await RefreshAsync();
    }

    async void OnApplyAll(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this,
                "Aplicar a configuração deste PC a todos os letreiros conhecidos?",
                "Letreiro", MessageBoxButton.YesNo) != MessageBoxResult.Yes)
            return;
        await SaveAsync(null, null, _local, applyAll: true);
        await RefreshAsync();
    }

    async Task SaveAsync(string? host, string? user, AppConfig cfg, bool applyAll)
    {
        try
        {
            await _client.PutLetreiroConfigAsync(cfg, host, user, applyAll);
            StatusText.Text = applyAll ? "Configuração aplicada a todos." : "Configuração gravada.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Letreiro");
        }
    }

    sealed class InstanceRow
    {
        public string HostName { get; init; } = "";
        public string WindowsUser { get; init; } = "";
        public string Version { get; init; } = "";
        public string Ponto { get; init; } = "";
        public string StatusLabel { get; init; } = "";
        public string LastSeenLabel { get; init; } = "";
        public string ConfigLabel { get; init; } = "";

        public static InstanceRow From(LetreiroInstance item) => new()
        {
            HostName = item.HostName,
            WindowsUser = item.WindowsUser,
            Version = item.Version,
            Ponto = item.Ponto,
            StatusLabel = item.Online ? "Online" : "Offline",
            LastSeenLabel = item.LastSeen is { } seen ? seen.ToLocalTime().ToString("g") : "—",
            ConfigLabel = item.HasConfig ? "Sim" : "Não",
        };
    }
}
