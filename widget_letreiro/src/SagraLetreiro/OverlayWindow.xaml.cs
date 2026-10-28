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

    readonly Dictionary<string, OsItem> _master = new();
    readonly HashSet<string> _inboxSeen = new();
    readonly DispatcherTimer _dockTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    readonly DispatcherTimer _pollTimer = new();
    readonly DispatcherTimer _commandTimer = new();
    readonly object _gate = new();
    int _commandPollSec = LetreiroCommandPoll.DefaultSec;

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
    int _dragWidth;
    bool _didDrag;
    TickerCard? _pressCard;
    Point _pressCardScreen;
    OsBalloonWindow? _balloon;
    readonly Queue<TickerCard> _arrivalQueue = new();
    readonly HashSet<string> _heldArrivalKeys = new();
    ArrivalToastWindow? _arrivalToast;
    TickerCard? _showingArrival;
    ArrivalPreview? _previewToast;
    AdminHost? _adminHost;
    string? _remoteFp;
    int _jobBusy;
    const int ClickSlopPx = 6;

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
        PreviewMouseWheel += OnPreviewMouseWheel;
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
        _commandTimer.Tick += async (_, _) => await DrainRemoteJobAsync();
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
        ScheduleCommandPoll();
        _ = PollOnceAsync();
        _ = DrainRemoteJobAsync();
        _dockTimer.Start();
        AppLog.Info("Loop da janela iniciado");
    }

    void OnClosed(object? sender, EventArgs e)
    {
        CompositionTarget.Rendering -= OnRenderTick;
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        _dockTimer.Stop();
        _pollTimer.Stop();
        _commandTimer.Stop();
        CloseBalloon();
        CloseArrivalToast();
        _adminHost?.Dispose();
        _adminHost = null;
        _client.Dispose();
        AppLog.Info("Letreiro encerrado");
    }

    public void ApplyConfig(AppConfig config, bool relogin, bool poll = true)
    {
        _config = ConfigStore.Normalize(config);
        if (relogin)
        {
            CloseBalloon();
            CloseArrivalToast();
            _arrivalQueue.Clear();
            _heldArrivalKeys.Clear();
            _client.Dispose();
            _client = NewClient(_config);
            _master.Clear();
            _inboxSeen.Clear();
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
        if (poll) _ = PollOnceAsync();
    }

    void SchedulePoll()
    {
        _pollTimer.Stop();
        _pollTimer.Interval = TimeSpan.FromSeconds(Math.Clamp(_config.PollIntervalSec, 5, 120));
        _pollTimer.Start();
    }

    void ScheduleCommandPoll()
    {
        _commandTimer.Stop();
        _commandTimer.Interval = TimeSpan.FromSeconds(LetreiroCommandPoll.Clamp(_commandPollSec));
        _commandTimer.Start();
    }

    void ApplyCommandPollInterval(int seconds)
    {
        var next = LetreiroCommandPoll.Clamp(seconds);
        if (next == _commandPollSec && _commandTimer.IsEnabled) return;
        _commandPollSec = next;
        ScheduleCommandPoll();
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
        var probeX = initial && win.X is null
            ? 8
            : (win.X ?? _physX) + 8;
        var probeY = _physY + Math.Max(_physHeight, 1) / 2;
        var geom = TaskbarService.At(probeX, probeY);
        var rect = TaskbarService.ClampPinnedRight(win.Width, geom);
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
                if (!_didDrag && Math.Abs(pt.X - _dragOriginX) < ClickSlopPx)
                    return;
                if (!_didDrag)
                {
                    _didDrag = true;
                    CloseBalloon();
                }
                ApplyDrag(pt.X);
            }
            Cursor = Cursors.SizeAll;
            return;
        }
        if (CardAt(e.GetPosition(Ticker)) is not null)
            Cursor = Cursors.Hand;
        else
            Cursor = Cursors.SizeAll;
    }

    void OnPress(object sender, MouseButtonEventArgs e)
    {
        GetCursorPos(out var pt);
        _dragMode = "move";
        _didDrag = false;
        _pressCard = CardAt(e.GetPosition(Ticker));
        if (_pressCard is not null)
        {
            var el = CardElement(_pressCard);
            _pressCardScreen = el is not null
                ? el.PointToScreen(new Point(0, 0))
                : PointToScreen(e.GetPosition(this));
        }
        CloseBalloon();
        _dragOriginX = pt.X;
        _dragWidth = _physWidth;
        CaptureMouse();
        e.Handled = true;
    }

    void ApplyDrag(int xRoot)
    {
        if (_dragMode is null) return;
        var geom = TaskbarService.At(xRoot, _physY);
        var rect = TaskbarService.ClampPinnedRight(_dragWidth, geom);
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
        var card = _pressCard;
        var dragged = _didDrag;
        _dragMode = null;
        _pressCard = null;
        _didDrag = false;
        ReleaseMouseCapture();
        if (dragged)
        {
            PersistWindow();
            return;
        }
        if (card is not null)
            OpenBalloon(card, _pressCardScreen);
    }

    void OnContext(object sender, MouseButtonEventArgs e)
    {
        var menu = new ContextMenu();
        menu.Items.Add(Item("Ajustes…", OpenSettings));
        if (LetreiroAdmin.IsAdmin())
            menu.Items.Add(Item("Administrar…", OpenAdmin));
        menu.Items.Add(Item("Recarregar", () => _ = PollOnceAsync()));
        menu.Items.Add(Item("Verificar atualização", () => App.CheckUpdatesFromMenu()));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Sair", () => Application.Current.Shutdown()));
        CloseBalloon();
        menu.IsOpen = true;
        e.Handled = true;
    }

    TickerCard? CardAt(Point tickerPos) => HitCard(Ticker, tickerPos);

    static TickerCard? HitCard(Panel host, Point pos)
    {
        TickerCard? found = null;
        foreach (UIElement child in host.Children)
        {
            if (child is Canvas nested && nested.Tag is not TickerCard)
            {
                var nx = Canvas.GetLeft(nested);
                var ny = Canvas.GetTop(nested);
                if (double.IsNaN(nx)) nx = 0;
                if (double.IsNaN(ny)) ny = 0;
                var inner = HitCard(nested, new Point(pos.X - nx, pos.Y - ny));
                if (inner is not null) found = inner;
                continue;
            }
            if (child is not FrameworkElement fe || fe.Tag is not TickerCard card) continue;
            var x = Canvas.GetLeft(fe);
            var y = Canvas.GetTop(fe);
            if (double.IsNaN(x) || double.IsNaN(y)) continue;
            if (pos.X >= x && pos.X <= x + fe.Width && pos.Y >= y && pos.Y <= y + fe.Height)
                found = card;
        }
        return found;
    }

    FrameworkElement? CardElement(TickerCard card) => FindCard(Ticker, card);

    static FrameworkElement? FindCard(Panel host, TickerCard card)
    {
        foreach (UIElement child in host.Children)
        {
            if (child is Canvas nested && nested.Tag is not TickerCard)
            {
                var found = FindCard(nested, card);
                if (found is not null) return found;
                continue;
            }
            if (child is FrameworkElement fe && fe.Tag is TickerCard tagged &&
                (ReferenceEquals(tagged, card) || tagged.UniqueKey == card.UniqueKey))
                return fe;
        }
        return null;
    }

    void OpenBalloon(TickerCard card, Point screenTopLeft)
    {
        CloseBalloon();
        _balloon = new OsBalloonWindow(card, _client);
        _balloon.Closed += (_, _) =>
        {
            _balloon = null;
            _needsDraw = true;
        };
        _balloon.Show();
        _balloon.PlaceAbove(this, screenTopLeft);
        _balloon.Activate();
    }

    void CloseBalloon()
    {
        if (_balloon is null) return;
        try { _balloon.Close(); }
        catch { }
        _balloon = null;
    }

    void PreviewArrivalNotification(ArrivalPreview preview)
    {
        _previewToast = preview with
        {
            Width = preview.Width > 0 ? ArrivalNotify.ClampCardWidth(preview.Width) : _config.Window.NotificationWidth,
            Height = preview.Height > 0 ? ArrivalNotify.ClampCardHeight(preview.Height) : _config.Window.NotificationHeight,
            Animation = ArrivalNotify.ClampAnimation(string.IsNullOrWhiteSpace(preview.Animation) ? _config.Window.NotificationAnimation : preview.Animation),
            Visual = ArrivalNotify.NormalizeVisual(preview.Visual ?? _config.Window.NotificationVisual),
            TitleFontSize = preview.TitleFontSize > 0 ? ArrivalNotify.ClampTitleFontSize(preview.TitleFontSize) : _config.Window.NotificationTitleFontSize,
            SituationFontSize = preview.SituationFontSize > 0 ? ArrivalNotify.ClampSituationFontSize(preview.SituationFontSize) : _config.Window.NotificationSituationFontSize,
        };
        var card = ArrivalNotify.PreviewCard();
        if (_cards.All(item => item.UniqueKey != card.UniqueKey))
            _cards.Add(card);
        EnqueueArrivals([card], [card.UniqueKey]);
        RebuildLayout();
        PumpArrivalQueue();
    }

    void EnqueueArrivals(IEnumerable<TickerCard> cards, IReadOnlyCollection<string> arrivalKeys)
    {
        if (arrivalKeys.Count == 0) return;
        foreach (var card in cards)
        {
            if (!arrivalKeys.Contains(card.UniqueKey)) continue;
            if (!_heldArrivalKeys.Add(card.UniqueKey)) continue;
            _arrivalQueue.Enqueue(card);
        }
    }

    void PreserveHeldPreview()
    {
        var pending = _arrivalQueue
            .Concat(_showingArrival is null ? Array.Empty<TickerCard>() : [_showingArrival])
            .Where(card => card.UniqueKey == ArrivalNotify.PreviewKey);
        foreach (var card in pending)
        {
            if (_cards.All(item => item.UniqueKey != card.UniqueKey))
                _cards.Add(card);
        }
    }

    void PumpArrivalQueue()
    {
        if (_arrivalToast is not null) return;
        if (!_arrivalQueue.TryDequeue(out var card)) return;
        _showingArrival = card;
        var width = _config.Window.NotificationWidth;
        var height = _config.Window.NotificationHeight;
        var animation = _config.Window.NotificationAnimation;
        var visual = _config.Window.NotificationVisual;
        var titleFont = _config.Window.NotificationTitleFontSize;
        var situationFont = _config.Window.NotificationSituationFontSize;
        if (card.UniqueKey == ArrivalNotify.PreviewKey && _previewToast is { } preview)
        {
            width = preview.Width;
            height = preview.Height;
            animation = preview.Animation;
            visual = preview.Visual ?? visual;
            titleFont = preview.TitleFontSize;
            situationFont = preview.SituationFontSize;
        }
        _arrivalToast = new ArrivalToastWindow(card, width, height, animation, visual, titleFont, situationFont);
        _arrivalToast.Closed += OnArrivalToastClosed;
        _arrivalToast.ShowAbove(this);
    }

    void OnArrivalToastClosed(object? sender, EventArgs e)
    {
        if (_showingArrival is not null)
            _heldArrivalKeys.Remove(_showingArrival.UniqueKey);
        _showingArrival = null;
        _arrivalToast = null;
        RebuildLayout();
        PumpArrivalQueue();
    }

    void CloseArrivalToast()
    {
        if (_arrivalToast is null)
        {
            _showingArrival = null;
            return;
        }
        _arrivalToast.Closed -= OnArrivalToastClosed;
        try { _arrivalToast.Close(); }
        catch { }
        _arrivalToast = null;
        _showingArrival = null;
    }

    static MenuItem Item(string header, Action action)
    {
        var item = new MenuItem { Header = header };
        item.Click += (_, _) => action();
        return item;
    }

    void OpenSettings()
    {
        try
        {
            EnsureLocalHost();
            _adminHost!.OpenBrowser("#ajustes");
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Ajustes", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    void OpenAdmin()
    {
        if (!LetreiroAdmin.IsAdmin()) return;
        try
        {
            EnsureLocalHost();
            _adminHost!.OpenBrowser();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Administração", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    void EnsureLocalHost()
    {
        _adminHost ??= AdminHost.Start(new AdminHostOptions
        {
            Client = () => _client,
            IsAdmin = LetreiroAdmin.IsAdmin(),
            GetLocalConfig = () => Dispatcher.Invoke(() => _config),
            ApplyLocalConfig = (cfg, relogin) => Dispatcher.Invoke(() =>
            {
                ConfigStore.Save(cfg);
                ApplyConfig(cfg, relogin);
            }),
            PreviewNotification = preview => Dispatcher.Invoke(() => PreviewArrivalNotification(preview)),
        });
    }

    async Task SyncRemoteConfigAsync()
    {
        var remote = await _client.FetchLetreiroConfigAsync(
            LetreiroAdmin.CurrentHost(), LetreiroAdmin.CurrentWindowsUser()).ConfigureAwait(true);
        if (remote is null) return;
        var merged = ConfigStore.MergeRemote(_config, remote);
        var fp = ConfigStore.RemoteFingerprint(merged);
        if (fp == _remoteFp) return;
        var relogin = merged.ApiBaseUrl != _config.ApiBaseUrl || merged.Ponto != _config.Ponto
            || merged.Password != _config.Password || merged.SslVerify != _config.SslVerify;
        _remoteFp = fp;
        ConfigStore.Save(merged);
        ApplyConfig(merged, relogin, poll: false);
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
            try { await SyncRemoteConfigAsync().ConfigureAwait(true); }
            catch (LetreiroApiException ex) { AppLog.Warn("Config remota: " + ex.Message); }
            lock (_gate) cfg = _config;

            try
            {
                await _client.HeartbeatAsync(
                    LetreiroAdmin.CurrentHost(),
                    LetreiroAdmin.CurrentWindowsUser(),
                    UpdateService.CurrentVersion,
                    cfg.Ponto).ConfigureAwait(true);
            }
            catch (LetreiroApiException ex) { AppLog.Warn("Heartbeat: " + ex.Message); }

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

            var processed = Board.ProcessDashboardData(items, cfg.Board, _master, isInitialLoad: initial, inboxOs: inbox, inboxSeen: _inboxSeen);
            var cards = Board.FlattenTickerCards(processed.Columns, cfg.Board);
            lock (_gate) _initial = false;
            _cards = cards;
            PreserveHeldPreview();
            EnqueueArrivals(cards, processed.NewArrivalKeys);
            _status = "connected";
            _statusMsg = string.IsNullOrEmpty(inboxNote) ? $"{cards.Count} OP(s)" : inboxNote;
            RebuildLayout();
            PaintStatus();
            PumpArrivalQueue();
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

    async Task DrainRemoteJobAsync()
    {
        if (Interlocked.CompareExchange(ref _jobBusy, 1, 0) != 0) return;
        try
        {
            LetreiroJob? job;
            try
            {
                var pending = await _client.FetchPendingLetreiroJobAsync(
                    LetreiroAdmin.CurrentHost(),
                    LetreiroAdmin.CurrentWindowsUser()).ConfigureAwait(true);
                job = pending.Job;
                ApplyCommandPollInterval(pending.PollIntervalSec);
            }
            catch (LetreiroApiException ex)
            {
                AppLog.Warn("Job remoto: " + ex.Message);
                return;
            }
            if (job is null) return;

            var host = LetreiroAdmin.CurrentHost();
            var user = LetreiroAdmin.CurrentWindowsUser();
            RemoteScriptOutcome outcome;
            try
            {
                outcome = await Task.Run(() =>
                    RemoteScript.Execute(job.Kind, job.Content, job.Id, job.TimeoutSec)).ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                AppLog.Warn("Execução remota: " + ex.Message);
                outcome = new RemoteScriptOutcome { ExitCode = -1, Stderr = ex.Message };
            }

            try
            {
                await _client.PostLetreiroJobResultAsync(job.Id, host, user, outcome).ConfigureAwait(true);
            }
            catch (LetreiroApiException ex)
            {
                AppLog.Warn("Resultado job: " + ex.Message);
            }
        }
        finally
        {
            Interlocked.Exchange(ref _jobBusy, 0);
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
        foreach (var card in ArrivalNotify.VisibleOnTicker(_cards, _heldArrivalKeys))
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
        if (!TotalOverflow())
        {
            if (_offset != 0)
            {
                _offset = 0;
                Redraw();
            }
            else if (_needsDraw)
            {
                Redraw();
                _needsDraw = false;
            }
            return;
        }
        if (NeedsScroll() && !IsPaused())
        {
            _offset += _config.Window.SpeedPxPerSec * dt;
            Redraw();
        }
        else if (_needsDraw)
        {
            Redraw();
            _needsDraw = false;
        }
    }

    bool IsPaused() => _paused || _balloon is not null;

    double TickerWidth() => Math.Max(1, Ticker.ActualWidth);

    bool TotalOverflow()
    {
        var widths = _layout.Select(c => c.Width).ToList();
        return TickerLayout.TotalOverflow(widths, TickerWidth());
    }

    bool NeedsScroll()
    {
        var cards = _layout.Select(c => c.Card).ToList();
        var widths = _layout.Select(c => c.Width).ToList();
        return TickerLayout.RotatingNeedsMarquee(cards, widths, TickerWidth());
    }

    void OnPreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (!NeedsScroll()) return;
        e.Handled = true;
        var widths = _layout.Select(c => c.Width).ToList();
        var split = TickerLayout.SplitByPriority(_layout.Select(c => c.Card).ToList(), widths);
        _offset -= e.Delta / 120.0 * TickerLayout.MarqueeWheelStep(split.RotatingWidths);
        Redraw();
    }

    void Redraw()
    {
        Ticker.Children.Clear();
        var height = Math.Max(1, Ticker.ActualHeight);
        var width = TickerWidth();
        if (_layout.Count == 0)
        {
            if (_status != "connected") DrawEmpty(_statusMsg, height);
            return;
        }

        var cards = _layout.Select(c => c.Card).ToList();
        var widths = _layout.Select(c => c.Width).ToList();
        var placed = TickerLayout.PlaceCarousel(cards, widths, width, _offset, TotalOverflow());
        var rotating = new List<PlacedCard>();
        var pinned = new List<PlacedCard>();
        foreach (var item in placed)
        {
            if (TickerLayout.IsPinnedPriority(item.Card)) pinned.Add(item);
            else rotating.Add(item);
        }

        var remaining = width - TickerLayout.PinnedReserve(pinned.Select(p => p.Width).ToList());
        if (pinned.Count > 0 && rotating.Count > 0 && remaining > 0)
        {
            var host = new Canvas
            {
                Width = remaining,
                Height = height,
                ClipToBounds = true,
            };
            Canvas.SetLeft(host, 0);
            Canvas.SetTop(host, 0);
            foreach (var item in rotating)
                host.Children.Add(Paint(item, height));
            Ticker.Children.Add(host);
            foreach (var item in pinned)
                Ticker.Children.Add(Paint(item, height));
            return;
        }

        foreach (var item in placed)
            Ticker.Children.Add(Paint(item, height));
    }

    UIElement Paint(PlacedCard item, double height)
    {
        var meta = _layout.First(c => ReferenceEquals(c.Card, item.Card) || c.Card.UniqueKey == item.Card.UniqueKey);
        return PaintCard(item.X, height, item.Width, meta.Card, meta.Situacao);
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
            Tag = card,
            Cursor = Cursors.Hand,
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
