using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using static SagraLetreiro.NativeMethods;

namespace SagraLetreiro;

public partial class OverlayWindow : Window
{
    static readonly Color PanelColor = Color.FromRgb(0x12, 0x12, 0x14);
    static readonly Brush HitBackground = Frozen(new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)));
    static readonly Brush PanelBackground = Frozen(new SolidColorBrush(PanelColor));
    static readonly Brush CardBg = Frozen(new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x38)));
    static readonly Brush TextBrush = Frozen(new SolidColorBrush(Color.FromRgb(0xe1, 0xe1, 0xe6)));
    static readonly Brush TextDim = Frozen(new SolidColorBrush(Color.FromRgb(0xa8, 0xa8, 0xb3)));
    static readonly Brush Success = Frozen(new SolidColorBrush(Color.FromRgb(0x04, 0xd3, 0x61)));
    static readonly Brush Danger = Frozen(new SolidColorBrush(Color.FromRgb(0xff, 0x69, 0x61)));
    static readonly Brush PriorityHigh = Frozen(new SolidColorBrush(Color.FromRgb(0xd3, 0x11, 0x11)));
    static readonly Brush PriorityMedium = Frozen(new SolidColorBrush(Color.FromRgb(0xff, 0x98, 0x00)));
    static readonly Brush PriorityMediumText = Frozen(new SolidColorBrush(Color.FromRgb(0x1a, 0x1a, 0x1a)));
    static readonly Brush SubOsBorder = Frozen(new SolidColorBrush(Color.FromRgb(0xf5, 0x9e, 0x0b)));
    static readonly Brush White = Frozen(Brushes.White);
    static readonly Color[] ColumnBorders =
    [
        Color.FromRgb(0xb4, 0x6d, 0x03),
        Color.FromRgb(0x04, 0x61, 0x8d),
        Color.FromRgb(0xa3, 0x0d, 0x0d),
        Color.FromRgb(0x02, 0x46, 0x1e),
        Color.FromRgb(0xff, 0x6b, 0x6b),
        Color.FromRgb(0x20, 0x20, 0x24),
    ];

    const double Edge = 8;
    const double StatusCol = 14;

    readonly Dictionary<string, OsItem> _master = new();
    readonly DispatcherTimer _dockTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    readonly DispatcherTimer _pollTimer = new();
    readonly object _gate = new();

    LetreiroApiClient _client;
    AppConfig _config;
    List<TickerCard> _cards = [];
    List<(TickerCard Card, double Width, string Situacao)> _layout = [];
    string _status = "disconnected";
    string _statusMsg = "Conectando…";
    bool _paused;
    bool _initial = true;
    bool _busyPoll;
    bool _needsDraw = true;
    double _offset;
    DateTime _lastTick = DateTime.UtcNow;
    int _physX;
    int _physY;
    int _physWidth = 720;
    int _physHeight = 48;
    string? _dragMode;
    int _dragOriginX;
    int _dragWinX;
    int _dragWidth;
    SettingsWindow? _settings;

    public OverlayWindow(AppConfig config)
    {
        InitializeComponent();
        _config = ConfigStore.Normalize(config);
        _client = NewClient(_config);
        OverlayChrome.ApplyFloatingStyle(this);
        Loaded += OnLoaded;
        Closed += OnClosed;
        MouseMove += OnMouseMove;
        MouseLeftButtonDown += OnPress;
        MouseLeftButtonUp += OnRelease;
        MouseRightButtonUp += OnContext;
        MouseLeave += (_, _) => _paused = false;
        Ticker.MouseEnter += (_, _) => _paused = true;
        Ticker.MouseLeave += (_, _) => _paused = false;
        Ticker.SizeChanged += OnTickerSizeChanged;
        CompositionTarget.Rendering += OnRenderTick;
        SystemEventsDisplay();
        _dockTimer.Tick += (_, _) =>
        {
            if (_dragMode is null) Place(persist: false);
        };
        _pollTimer.Tick += async (_, _) => await PollOnceAsync();
    }

    static LetreiroApiClient NewClient(AppConfig cfg) =>
        new(cfg.ApiBaseUrl, cfg.SslVerify);

    void SystemEventsDisplay()
    {
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
    }

    void OnDisplayChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(() => Place(persist: false));

    void OnLoaded(object sender, RoutedEventArgs e)
    {
        ApplyChrome();
        Place(persist: false, initial: true);
        SchedulePoll();
        _ = PollOnceAsync();
        _dockTimer.Start();
        AppLog.Info("Loop da janela iniciado");
    }

    void OnClosed(object? sender, EventArgs e)
    {
        CompositionTarget.Rendering -= OnRenderTick;
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        _dockTimer.Stop();
        _pollTimer.Stop();
        _client.Dispose();
        AppLog.Info("Letreiro encerrado");
    }

    public void ApplyConfig(AppConfig config, bool relogin)
    {
        _config = ConfigStore.Normalize(config);
        if (relogin)
        {
            _client.Dispose();
            _client = NewClient(_config);
            _master.Clear();
            _initial = true;
        }
        else
        {
            _client.Configure(_config.ApiBaseUrl, _config.SslVerify);
        }
        App.CurrentConfig = _config;
        ApplyChrome();
        Place(persist: true);
        SchedulePoll();
        _ = PollOnceAsync();
    }

    void SchedulePoll()
    {
        _pollTimer.Stop();
        _pollTimer.Interval = TimeSpan.FromSeconds(Math.Clamp(_config.PollIntervalSec, 5, 120));
        _pollTimer.Start();
    }

    void ApplyChrome()
    {
        Opacity = _config.Window.Opacity;
        var fill = _config.Window.TransparentBg ? HitBackground : PanelBackground;
        Root.Background = fill;
        Ticker.Background = fill;
        StatusHost.Background = fill;
        PaintStatus();
    }

    void Place(bool persist, bool initial = false)
    {
        var win = _config.Window;
        var probeX = win.X ?? _physX;
        var geom = TaskbarService.At(probeX, _physY);
        int x;
        if (initial && win.X is null)
            x = geom.Right - win.Width - 8;
        else
            x = win.X ?? _physX;
        var rect = TaskbarService.Clamp(x, win.Width, geom);
        _physX = rect.Left;
        _physY = rect.Top;
        _physWidth = rect.Width;
        _physHeight = rect.Height;
        TaskbarService.ApplyPhysical(this, rect);
        if (persist) PersistWindow();
    }

    void PersistWindow()
    {
        _config.Window.X = _physX;
        _config.Window.Width = _physWidth;
        App.CurrentConfig = _config;
        try { ConfigStore.Save(_config); }
        catch (Exception ex) { AppLog.Warn("Não gravou posição: " + ex.Message); }
    }

    void OnMouseMove(object sender, MouseEventArgs e)
    {
        if (_dragMode is not null)
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                GetCursorPos(out var pt);
                ApplyDrag(pt.X);
            }
            Cursor = _dragMode is "left" or "right" ? Cursors.SizeWE : Cursors.SizeAll;
            return;
        }
        Cursor = HitZone(e) is "left" or "right" ? Cursors.SizeWE : Cursors.SizeAll;
    }

    string HitZone(MouseEventArgs e)
    {
        var local = e.GetPosition(this);
        if (local.X >= ActualWidth - StatusCol) return "right";
        if (local.X <= Edge) return "left";
        return "move";
    }

    void OnPress(object sender, MouseButtonEventArgs e)
    {
        GetCursorPos(out var pt);
        _dragMode = HitZone(e);
        _dragOriginX = pt.X;
        _dragWinX = _physX;
        _dragWidth = _physWidth;
        CaptureMouse();
        e.Handled = true;
    }

    void ApplyDrag(int xRoot)
    {
        if (_dragMode is null) return;
        var dx = xRoot - _dragOriginX;
        var geom = TaskbarService.At(xRoot, _physY);
        RECT rect;
        if (_dragMode == "move")
            rect = TaskbarService.Clamp(_dragWinX + dx, _dragWidth, geom);
        else if (_dragMode == "left")
            rect = TaskbarService.Clamp(_dragWinX + dx, _dragWidth - dx, TaskbarService.At(_dragWinX + dx, _physY));
        else
            rect = TaskbarService.Clamp(_dragWinX, _dragWidth + dx, TaskbarService.At(_dragWinX + _dragWidth / 2, _physY));
        _physX = rect.Left;
        _physY = rect.Top;
        _physWidth = rect.Width;
        _physHeight = rect.Height;
        _config.Window.X = _physX;
        _config.Window.Width = _physWidth;
        TaskbarService.ApplyPhysical(this, rect);
    }

    void OnRelease(object sender, MouseButtonEventArgs e)
    {
        if (_dragMode is null) return;
        _dragMode = null;
        ReleaseMouseCapture();
        PersistWindow();
    }

    void OnContext(object sender, MouseButtonEventArgs e)
    {
        var menu = new ContextMenu();
        menu.Items.Add(Item("Ajustes…", OpenSettings));
        menu.Items.Add(Item("Recarregar", () => _ = PollOnceAsync()));
        menu.Items.Add(Item("Verificar atualização", () => App.CheckUpdatesFromMenu()));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Sair", () => Application.Current.Shutdown()));
        menu.IsOpen = true;
        e.Handled = true;
    }

    static MenuItem Item(string header, Action action)
    {
        var item = new MenuItem { Header = header };
        item.Click += (_, _) => action();
        return item;
    }

    void OpenSettings()
    {
        if (_settings is { IsVisible: true })
        {
            _settings.Activate();
            return;
        }
        _settings = new SettingsWindow(_config, _client, ApplyConfig);
        _settings.Closed += (_, _) => _settings = null;
        _settings.Show();
    }

    async Task PollOnceAsync()
    {
        if (_busyPoll) return;
        _busyPoll = true;
        AppConfig cfg;
        bool initial;
        lock (_gate)
        {
            cfg = _config;
            initial = _initial;
        }
        try
        {
            var ponto = cfg.Ponto.Trim();
            if (ponto.Length > 0 && !_client.LoggedIn)
            {
                try
                {
                    await _client.LoginAsync(ponto, cfg.Nome, cfg.Password).ConfigureAwait(true);
                }
                catch (LetreiroApiException ex)
                {
                    ApplyError("Login: " + ex.Message);
                    return;
                }
            }

            List<OsItem> items;
            try
            {
                items = await _client.FetchDashboardAsync(cfg.Board).ConfigureAwait(true);
            }
            catch (LetreiroApiException ex)
            {
                ApplyError(ex.Message);
                return;
            }

            List<InboxRef>? inbox = null;
            var inboxNote = "";
            if (Board.DashboardConfigHasInboxColumn(cfg.Board))
            {
                if (_client.LoggedIn)
                {
                    try { inbox = await _client.FetchInboxOsAsync().ConfigureAwait(true); }
                    catch (LetreiroApiException ex) { inboxNote = "Inbox: " + ex.Message; }
                }
                else inboxNote = "Inbox exige login (ponto).";
            }

            var processed = Board.ProcessDashboardData(items, cfg.Board, _master, isInitialLoad: initial, inboxOs: inbox);
            var cards = Board.FlattenTickerCards(processed.Columns);
            lock (_gate) _initial = false;
            _cards = cards;
            _status = "connected";
            _statusMsg = string.IsNullOrEmpty(inboxNote) ? $"{cards.Count} OP(s)" : inboxNote;
            RebuildLayout();
            PaintStatus();
        }
        catch (Exception ex)
        {
            AppLog.Error("Falha no poll do letreiro", ex);
            ApplyError(ex.Message);
        }
        finally
        {
            _busyPoll = false;
        }
    }

    void ApplyError(string message)
    {
        _status = "disconnected";
        _statusMsg = message;
        PaintStatus();
        _needsDraw = true;
        Redraw();
    }

    void PaintStatus()
    {
        Lamp.Fill = _status == "connected" ? Success : Danger;
        StatusHost.ToolTip = _statusMsg;
    }

    void OnTickerSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_cards.Count > 0) RebuildLayout();
        else
        {
            _needsDraw = true;
            Redraw();
        }
    }

    void RebuildLayout()
    {
        var height = Math.Max(18, Ticker.ActualHeight);
        var (numSize, sitSize) = CardMetrics.FontSizes(height);
        var pixels = VisualTreeHelper.GetDpi(this).PixelsPerDip;
        _layout = [];
        foreach (var card in _cards)
        {
            var labelW = Measure(card.Label, numSize, true, pixels);
            var sit = card.Situacao ?? "";
            var sitW = Measure(sit, sitSize, false, pixels);
            var width = CardMetrics.Width(labelW, sitW);
            var inner = CardMetrics.TextInner(width);
            if (sitW > inner)
                sit = Ellipsis(sit, sitSize, inner, pixels);
            _layout.Add((card, width, sit));
        }
        _offset = 0;
        _needsDraw = true;
        Redraw();
    }

    void OnRenderTick(object? sender, EventArgs e)
    {
        var now = DateTime.UtcNow;
        var dt = Math.Clamp((now - _lastTick).TotalSeconds, 0, 0.1);
        _lastTick = now;
        if (_layout.Count == 0)
        {
            if (_needsDraw) { Redraw(); _needsDraw = false; }
            return;
        }
        if (NeedsScroll() && !_paused)
        {
            _offset += _config.Window.SpeedPxPerSec * dt;
            Redraw();
        }
        else if (_offset != 0)
        {
            _offset = 0;
            Redraw();
        }
        else if (_needsDraw)
        {
            Redraw();
            _needsDraw = false;
        }
    }

    bool NeedsScroll()
    {
        var widths = _layout.Select(c => c.Width).ToList();
        return Board.TickerContentOverflows(widths, TickerLayout.Gap, Math.Max(1, Ticker.ActualWidth));
    }

    void Redraw()
    {
        Ticker.Children.Clear();
        var height = Math.Max(1, Ticker.ActualHeight);
        var width = Math.Max(1, Ticker.ActualWidth);
        if (_layout.Count == 0)
        {
            if (_status != "connected") DrawEmpty(_statusMsg, height);
            return;
        }

        var cards = _layout.Select(c => c.Card).ToList();
        var widths = _layout.Select(c => c.Width).ToList();
        var placed = TickerLayout.PlaceRtl(cards, widths, width, _offset, NeedsScroll());
        foreach (var item in placed)
        {
            var meta = _layout.First(c => ReferenceEquals(c.Card, item.Card) || c.Card.UniqueKey == item.Card.UniqueKey);
            Ticker.Children.Add(PaintCard(item.X, height, item.Width, meta.Card, meta.Situacao));
        }
    }

    void DrawEmpty(string text, double height)
    {
        var shown = (text ?? "").Trim();
        if (shown.Length == 0) return;
        if (shown.Length >= 80) shown = shown[..77] + "…";
        var tb = new TextBlock
        {
            Text = shown,
            Foreground = TextDim,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Canvas.SetLeft(tb, 12);
        Canvas.SetTop(tb, Math.Max(0, (height - 16) / 2));
        Ticker.Children.Add(tb);
    }

    UIElement PaintCard(double x, double canvasH, double w, TickerCard card, string situacao)
    {
        var y = 3.0;
        var h = Math.Max(18, canvasH - 6);
        Brush bg, fg, sitFg;
        if (card.Priority == "priority-high")
        {
            bg = PriorityHigh; fg = White; sitFg = Frozen(new SolidColorBrush(Color.FromRgb(0xf0, 0xf0, 0xf0)));
        }
        else if (card.Priority == "priority-medium")
        {
            bg = PriorityMedium; fg = PriorityMediumText; sitFg = PriorityMediumText;
        }
        else
        {
            bg = CardBg; fg = TextBrush; sitFg = White;
        }
        Color border;
        if (card.IsNew) border = Color.FromRgb(0x04, 0xd3, 0x61);
        else if (card.IsSubOs) border = ((SolidColorBrush)SubOsBorder).Color;
        else border = ColumnBorders[Math.Abs(card.ColumnIndex) % ColumnBorders.Length];

        var (numSize, sitSize) = CardMetrics.FontSizes(canvasH);
        var root = new Grid
        {
            Width = w,
            Height = h,
            ClipToBounds = true,
        };
        root.Children.Add(new Border { Background = bg, CornerRadius = new CornerRadius(2) });
        root.Children.Add(new Border
        {
            Width = CardMetrics.Accent,
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = Frozen(new SolidColorBrush(border)),
        });
        var stack = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(CardMetrics.TextLeft, 0, CardMetrics.TextRight, 0),
        };
        stack.Children.Add(TextLine(card.Label, fg, numSize, bold: true));
        stack.Children.Add(TextLine(situacao, sitFg, sitSize, bold: false));
        root.Children.Add(stack);
        Canvas.SetLeft(root, x);
        Canvas.SetTop(root, y);
        return root;
    }

    static TextBlock TextLine(string text, Brush fg, double size, bool bold) => new()
    {
        Text = text ?? "",
        Foreground = fg,
        FontFamily = new FontFamily("Segoe UI"),
        FontWeight = bold ? FontWeights.Bold : FontWeights.Normal,
        FontSize = size,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.NoWrap,
        TextTrimming = TextTrimming.CharacterEllipsis,
        Padding = new Thickness(0),
        Margin = new Thickness(0),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    static double Measure(string text, double size, bool bold, double pixelsPerDip)
    {
        var ft = new FormattedText(
            text ?? "",
            CultureInfo.CurrentUICulture,
            FlowDirection.LeftToRight,
            new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal,
                bold ? FontWeights.Bold : FontWeights.Normal, FontStretches.Normal),
            size,
            Brushes.White,
            pixelsPerDip);
        return ft.WidthIncludingTrailingWhitespace + 2;
    }

    static string Ellipsis(string text, double size, double maxW, double pixelsPerDip)
    {
        if (Measure(text, size, false, pixelsPerDip) <= maxW) return text;
        var trimmed = text;
        while (trimmed.Length > 0 && Measure(trimmed + "…", size, false, pixelsPerDip) > maxW)
            trimmed = trimmed[..^1];
        return trimmed.Length == 0 ? "…" : trimmed + "…";
    }

    static T Frozen<T>(T value) where T : Freezable
    {
        if (value.CanFreeze) value.Freeze();
        return value;
    }
}
