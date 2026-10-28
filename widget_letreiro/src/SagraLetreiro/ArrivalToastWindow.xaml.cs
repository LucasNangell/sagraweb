using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace SagraLetreiro;

public partial class ArrivalToastWindow : Window
{
    static readonly Brush CardBg = Frozen(new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x38)));
    static readonly Brush TextBrush = Frozen(new SolidColorBrush(Color.FromRgb(0xe1, 0xe1, 0xe6)));
    static readonly Brush PriorityHigh = Frozen(new SolidColorBrush(Color.FromRgb(0xd3, 0x11, 0x11)));
    static readonly Brush PriorityMedium = Frozen(new SolidColorBrush(Color.FromRgb(0xff, 0x98, 0x00)));
    static readonly Brush PriorityMediumText = Frozen(new SolidColorBrush(Color.FromRgb(0x1a, 0x1a, 0x1a)));
    static readonly Brush White = Frozen(Brushes.White);
    static readonly Brush NewAccent = Frozen(new SolidColorBrush(Color.FromRgb(0x04, 0xd3, 0x61)));

    readonly ArrivalToastLayout _layout;
    readonly Storyboard _motion;
    readonly NotificationVisual _visual;
    readonly string _animation;
    readonly int _titleFontSize;
    readonly int _situationFontSize;
    readonly int _padX;
    readonly int _textGap;
    readonly int _offsetRight;
    readonly int _offsetBottom;

    public ArrivalToastWindow(
        TickerCard card,
        int cardWidth,
        int cardHeight,
        string? animation = null,
        NotificationVisual? visual = null,
        int titleFontSize = 0,
        int situationFontSize = 0,
        int padX = 0,
        int? textGap = null,
        int? offsetRight = null,
        int? offsetBottom = null)
    {
        InitializeComponent();
        Opacity = 0;
        var id = ArrivalNotify.ClampAnimation(animation);
        _animation = id;
        _visual = ArrivalNotify.NormalizeVisual(visual);
        _layout = ArrivalNotify.Layout(cardWidth, cardHeight, id);
        _titleFontSize = ArrivalNotify.ClampTitleFontSize(titleFontSize);
        _situationFontSize = ArrivalNotify.ClampSituationFontSize(situationFontSize);
        _padX = ArrivalNotify.ClampPadX(padX);
        _textGap = ArrivalNotify.ClampTextGap(textGap);
        _offsetRight = ArrivalNotify.ClampOffsetRight(offsetRight);
        _offsetBottom = ArrivalNotify.ClampOffsetBottom(offsetBottom);
        OverlayChrome.ApplyFloatingStyle(this);
        ApplyLayout();
        Bind(card);
        ArrivalToastMotion.Prepare(this, _layout, id);
        _motion = ArrivalToastMotion.Build(_layout, id);
        _motion.Completed += (_, _) => Close();
    }

    public void ShowAbove(Window overlay)
    {
        Opacity = 0;
        Show();
        PlaceAbove(overlay);
        _motion.Begin(this, HandoffBehavior.SnapshotAndReplace, true);
        Opacity = 1;
    }

    public void PlaceAbove(Window overlay)
    {
        UpdateLayout();
        var dpi = VisualTreeHelper.GetDpi(this);
        var overlayTop = overlay.PointToScreen(new Point(0, 0));
        var geom = TaskbarService.At((int)overlayTop.X, (int)overlayTop.Y);
        var origin = ArrivalNotify.WindowOrigin(
            _layout,
            _offsetRight,
            _offsetBottom,
            geom.MonitorLeft,
            geom.MonitorTop,
            geom.MonitorRight,
            geom.MonitorBottom,
            dpi.DpiScaleX,
            dpi.DpiScaleY);
        Left = origin.Left / dpi.DpiScaleX;
        Top = origin.Top / dpi.DpiScaleY;
    }

    void ApplyLayout()
    {
        Width = _layout.WindowWidth;
        Height = _layout.WindowHeight;
        Stage.Width = _layout.WindowWidth;
        Stage.Height = _layout.WindowHeight;
        CardBorder.Width = _layout.CardWidth;
        CardBorder.Height = _layout.CardHeight;
        Canvas.SetLeft(CardBorder, _layout.SidePad);
        Canvas.SetTop(CardBorder, _layout.EnterSlack);
        LabelText.FontSize = _titleFontSize;
        SituacaoText.FontSize = _situationFontSize;
        TextStack.Margin = new Thickness(_padX + ArrivalNotify.AccentWidth, 0, _padX, 0);
        SituacaoText.Margin = new Thickness(0, _textGap, 0, 0);
        PositionUfo();
    }

    void PositionUfo()
    {
        var ufo = _animation == "fx-ufo";
        var show = ufo ? Visibility.Visible : Visibility.Collapsed;
        UfoRig.Visibility = show;
        UfoBeam.Visibility = show;
        UfoLanding.Visibility = show;
        if (!ufo) return;

        const double ufoW = 120;
        const double ufoH = 48;
        var cardLeft = _layout.SidePad;
        var cardTop = _layout.EnterSlack;
        var cardW = _layout.CardWidth;
        var cardH = _layout.CardHeight;
        Canvas.SetLeft(UfoRig, cardLeft + cardW / 2.0 - ufoW / 2.0);
        Canvas.SetTop(UfoRig, Math.Max(0, cardTop - ufoH - 8));

        var beamW = cardW * 1.12;
        var beamLeft = cardLeft - (beamW - cardW) / 2.0;
        var beamTop = Canvas.GetTop(UfoRig) + ufoH * 0.72;
        var beamH = Math.Max(40, cardTop + cardH - beamTop + 6);
        UfoBeam.Points = new PointCollection
        {
            new(beamW * 0.43, 0),
            new(beamW * 0.57, 0),
            new(beamW, beamH),
            new(0, beamH),
        };
        Canvas.SetLeft(UfoBeam, beamLeft);
        Canvas.SetTop(UfoBeam, beamTop);

        var ringW = cardW * 0.92;
        Canvas.SetLeft(UfoLanding, cardLeft + (cardW - ringW) / 2.0);
        Canvas.SetTop(UfoLanding, cardTop + cardH - 10);
        UfoLanding.Width = ringW;
    }

    void Bind(TickerCard card)
    {
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

        var slot = ArrivalNotify.SlotFor(_visual, card.Priority);
        if (TryBrush(slot.Bg, out var customBg)) bg = customBg;
        if (TryBrush(slot.Title, out var customFg)) fg = customFg;
        if (TryBrush(slot.Situation, out var customSit)) sitFg = customSit;
        Fill.Background = bg;
        Accent.Background = TryBrush(slot.Accent, out var customAccent) ? customAccent : NewAccent;
        if (TryBrush(slot.Border, out var customBorder))
        {
            CardBorder.BorderBrush = customBorder;
            CardBorder.BorderThickness = new Thickness(1);
        }
        LabelText.Text = card.Label ?? "";
        LabelText.Foreground = fg;
        SituacaoText.Text = card.Situacao ?? "";
        SituacaoText.Foreground = sitFg;
        if (ArrivalNotify.UsesCatalog(_visual))
            _ = BindCatalogAsync(card);
    }

    async Task BindCatalogAsync(TickerCard card)
    {
        try
        {
            var html = ArrivalToastHtml.Build(card, _visual, _titleFontSize, _situationFontSize);
            var env = await ArrivalToastBrowser.EnvironmentAsync().ConfigureAwait(true);
            CardWeb.DefaultBackgroundColor = System.Drawing.Color.Transparent;
            await CardWeb.EnsureCoreWebView2Async(env).ConfigureAwait(true);
            var core = CardWeb.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            ArrivalToastBrowser.MapHost(core);
            core.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess) return;
                CardWeb.Visibility = Visibility.Visible;
                Fill.Visibility = Visibility.Collapsed;
                Accent.Visibility = Visibility.Collapsed;
                TextStack.Visibility = Visibility.Collapsed;
                CardBorder.Background = Brushes.Transparent;
                CardBorder.BorderBrush = Brushes.Transparent;
                CardBorder.BorderThickness = new Thickness(0);
                CardBorder.CornerRadius = new CornerRadius(10);
                CardBorder.ClipToBounds = false;
            };
            CardWeb.Source = ArrivalToastBrowser.WritePage(html);
        }
        catch (Exception ex)
        {
            AppLog.Warn($"Toast do catálogo indisponível: {ex.Message}");
        }
    }

    static bool TryBrush(string hex, out Brush brush)
    {
        brush = Brushes.Transparent;
        if (string.IsNullOrWhiteSpace(hex)) return false;
        try
        {
            if (ColorConverter.ConvertFromString(hex) is Color color)
            {
                brush = Frozen(new SolidColorBrush(color));
                return true;
            }
        }
        catch
        {
            return false;
        }
        return false;
    }

    static T Frozen<T>(T value) where T : Freezable
    {
        if (value.CanFreeze) value.Freeze();
        return value;
    }
}
