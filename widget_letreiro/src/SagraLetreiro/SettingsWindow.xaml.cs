using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace SagraLetreiro;

public partial class SettingsWindow : Window
{
    readonly LetreiroApiClient _client;
    readonly Action<AppConfig, bool> _onSave;
    readonly string _oldApi;
    readonly string _oldPonto;
    readonly string _oldPassword;
    readonly bool _oldSsl;
    AppConfig _draft;
    List<string> _setores = ["SEFOC", "Papelaria", "Gravação"];
    readonly List<GroupEditor> _groups = [];

    public SettingsWindow(AppConfig config, LetreiroApiClient client, Action<AppConfig, bool> onSave)
    {
        InitializeComponent();
        _client = client;
        _onSave = onSave;
        _draft = Clone(config);
        _oldApi = _draft.ApiBaseUrl;
        _oldPonto = _draft.Ponto;
        _oldPassword = _draft.Password;
        _oldSsl = _draft.SslVerify;
        Loaded += async (_, _) => await LoadLookupsAsync();
        Bind();
    }

    void Bind()
    {
        ApiBox.Text = _draft.ApiBaseUrl;
        PontoBox.Text = _draft.Ponto;
        NomeBox.Text = _draft.Nome;
        PasswordBox.Password = _draft.Password;
        SslBox.IsChecked = _draft.SslVerify;
        SectorBox.ItemsSource = _setores;
        SectorBox.Text = _draft.Board.Sector;
        SpeedSlider.Value = _draft.Window.SpeedPxPerSec;
        OpacitySlider.Value = _draft.Window.Opacity;
        TransparentBox.IsChecked = _draft.Window.TransparentBg;
        RebuildGroups(_draft.Board.Columns);
        RefreshLabels();
    }

    void RebuildGroups(IEnumerable<BoardColumn> columns)
    {
        GroupsHost.Children.Clear();
        _groups.Clear();
        foreach (var col in columns)
        {
            var editor = new GroupEditor(col, _setores, RemoveGroup);
            _groups.Add(editor);
            GroupsHost.Children.Add(editor.Root);
        }
    }

    void RemoveGroup(GroupEditor editor)
    {
        if (_groups.Count <= 1)
        {
            MessageBox.Show(this, "É necessário pelo menos 1 grupo.", "Letreiro");
            return;
        }
        _groups.Remove(editor);
        GroupsHost.Children.Remove(editor.Root);
    }

    void OnAddGroup(object sender, RoutedEventArgs e)
    {
        if (_groups.Count >= 6) return;
        var col = new BoardColumn { Id = $"col_{_groups.Count}", Title = $"Grupo {_groups.Count + 1}" };
        var editor = new GroupEditor(col, _setores, RemoveGroup);
        _groups.Add(editor);
        GroupsHost.Children.Add(editor.Root);
    }

    void OnRestore(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this, "Restaurar grupos e setor padrão (SEFOC, 4 grupos)?", "Letreiro",
                MessageBoxButton.YesNo) != MessageBoxResult.Yes)
            return;
        _draft = ConfigStore.RestoreDefaultBoard(_draft);
        SectorBox.Text = _draft.Board.Sector;
        RebuildGroups(_draft.Board.Columns);
    }

    void OnCancel(object sender, RoutedEventArgs e) => Close();

    void OnSave(object sender, RoutedEventArgs e)
    {
        var columns = _groups.Select(g => g.Collect()).ToList();
        if (columns.Count == 0)
        {
            MessageBox.Show(this, "É necessário pelo menos um grupo.", "Letreiro");
            return;
        }
        var payload = new AppConfig
        {
            ApiBaseUrl = ApiBox.Text.Trim(),
            SslVerify = SslBox.IsChecked == true,
            Ponto = PontoBox.Text.Trim(),
            Nome = NomeBox.Text.Trim(),
            Password = PasswordBox.Password,
            PollIntervalSec = _draft.PollIntervalSec,
            Window = new WindowConfig
            {
                Width = _draft.Window.Width,
                X = _draft.Window.X,
                Opacity = OpacitySlider.Value,
                SpeedPxPerSec = SpeedSlider.Value,
                TransparentBg = TransparentBox.IsChecked == true,
            },
            Board = new BoardConfig
            {
                Sector = string.IsNullOrWhiteSpace(SectorBox.Text) ? "SEFOC" : SectorBox.Text.Trim(),
                ColumnCount = columns.Count,
                Columns = columns,
            },
        };
        var cfg = ConfigStore.Normalize(payload);
        ConfigStore.Save(cfg);
        var relogin = cfg.ApiBaseUrl != _oldApi || cfg.Ponto != _oldPonto || cfg.Password != _oldPassword
            || cfg.SslVerify != _oldSsl;
        _onSave(cfg, relogin);
        Close();
    }

    void OnSpeedChanged(object sender, RoutedPropertyChangedEventArgs<double> e) => RefreshLabels();

    void OnOpacityChanged(object sender, RoutedPropertyChangedEventArgs<double> e) => RefreshLabels();

    void RefreshLabels()
    {
        if (SpeedLabel is null || OpacityLabel is null) return;
        SpeedLabel.Text = $"{SpeedSlider.Value:0} px/s";
        OpacityLabel.Text = $"{OpacitySlider.Value * 100:0}%";
    }

    async Task LoadLookupsAsync()
    {
        try
        {
            if (!_client.LoggedIn && !string.IsNullOrWhiteSpace(PontoBox.Text))
                await _client.LoginAsync(PontoBox.Text.Trim(), NomeBox.Text.Trim(), PasswordBox.Password);
            var setores = await _client.FetchSetoresAsync();
            if (setores.Count > 0)
            {
                _setores = setores;
                var current = SectorBox.Text;
                SectorBox.ItemsSource = _setores;
                SectorBox.Text = current;
                foreach (var g in _groups) g.SetSectors(_setores);
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn("Não carregou setores: " + ex.Message);
        }
    }

    static AppConfig Clone(AppConfig cfg) => ConfigStore.Normalize(cfg);

    sealed class GroupEditor
    {
        readonly TextBox _title = new();
        readonly TextBox _statuses = new();
        readonly ComboBox _sector = new() { IsEditable = true };
        readonly CheckBox _inbox = new() { Content = "Fonte: inbox de e-mail" };
        readonly CheckBox _hide = new() { Content = "Ocultar quando vazio" };
        readonly string _id;

        public Border Root { get; }

        public GroupEditor(BoardColumn col, IReadOnlyList<string> setores, Action<GroupEditor> remove)
        {
            _id = col.Id;
            _title.Text = col.Title;
            _statuses.Text = string.Join(", ", col.Statuses);
            _sector.ItemsSource = new[] { "" }.Concat(setores).ToList();
            _sector.Text = col.Sector ?? "";
            _inbox.IsChecked = Board.IsInboxColumn(col);
            _hide.IsChecked = col.HideWhenEmpty;

            var removeBtn = new Button { Content = "Remover", HorizontalAlignment = HorizontalAlignment.Right };
            removeBtn.Click += (_, _) => remove(this);

            var body = new StackPanel();
            body.Children.Add(Label("Título"));
            body.Children.Add(_title);
            body.Children.Add(Label("Situações (separadas por vírgula)"));
            body.Children.Add(_statuses);
            body.Children.Add(Label("Setor (vazio = mesmo do painel)"));
            body.Children.Add(_sector);
            body.Children.Add(_inbox);
            body.Children.Add(_hide);
            body.Children.Add(removeBtn);

            Root = new Border
            {
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x2e, 0x2e, 0x36)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10),
                Margin = new Thickness(0, 0, 0, 10),
                Child = body,
            };
        }

        public void SetSectors(IReadOnlyList<string> setores)
        {
            var current = _sector.Text;
            _sector.ItemsSource = new[] { "" }.Concat(setores).ToList();
            _sector.Text = current;
        }

        public BoardColumn Collect()
        {
            var statuses = _statuses.Text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .ToList();
            var col = new BoardColumn
            {
                Id = _id,
                Title = string.IsNullOrWhiteSpace(_title.Text) ? "Grupo" : _title.Text.Trim(),
                Statuses = statuses,
                HideWhenEmpty = _hide.IsChecked == true,
            };
            if (_inbox.IsChecked == true)
            {
                col.Source = BoardConstants.InboxColumnSource;
                if (col.Title.StartsWith("Grupo", StringComparison.Ordinal))
                    col.Title = BoardConstants.InboxDisplaySituacao;
            }
            else if (!string.IsNullOrWhiteSpace(_sector.Text))
            {
                col.Sector = _sector.Text.Trim();
            }
            return col;
        }

        static TextBlock Label(string text) => new() { Text = text, Foreground = new SolidColorBrush(Color.FromRgb(0x9b, 0x9b, 0xa8)), FontSize = 11 };
    }
}
