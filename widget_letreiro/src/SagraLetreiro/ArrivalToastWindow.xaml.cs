using System.Windows;
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

    readonly Storyboard _mercury;

    public ArrivalToastWindow(TickerCard card)
    {
        InitializeComponent();
        Width = ArrivalNotify.ToastWidth;
        Height = ArrivalNotify.ToastWindowHeight;
        OverlayChrome.ApplyFloatingStyle(this);
        Bind(card);
        _mercury = (Storyboard)FindResource("Mercury");
        _mercury.Completed += (_, _) => Close();
    }

    public void ShowAbove(Window overlay)
    {
        Show();
        PlaceAbove(overlay);
        _mercury.Begin(this, true);
    }

    public void PlaceAbove(Window overlay)
    {
        UpdateLayout();
        var dpi = VisualTreeHelper.GetDpi(this);
        var overlayTop = overlay.PointToScreen(new Point(0, 0));
        var overlayW = overlay.ActualWidth * dpi.DpiScaleX;
        var overlayH = overlay.ActualHeight * dpi.DpiScaleY;
        var widthPx = ArrivalNotify.ToastWidth * dpi.DpiScaleX;
        var heightPx = ArrivalNotify.ToastWindowHeight * dpi.DpiScaleY;
        var geom = TaskbarService.At((int)overlayTop.X, (int)overlayTop.Y);
        var left = overlayTop.X + overlayW - widthPx;
        var holdBottom = overlayTop.Y - 8;
        var top = holdBottom - (ArrivalNotify.ToastEnterSlack + ArrivalNotify.ToastHeight) * dpi.DpiScaleY;
        if (top < geom.MonitorTop)
            top = overlayTop.Y + overlayH + 8 - ArrivalNotify.ToastEnterSlack * dpi.DpiScaleY;
        if (left + widthPx > geom.MonitorRight) left = geom.MonitorRight - widthPx - 8;
        if (left < geom.MonitorLeft) left = geom.MonitorLeft + 8;
        if (top + heightPx > geom.MonitorBottom) top = geom.MonitorBottom - heightPx - 8;
        Left = left / dpi.DpiScaleX;
        Top = top / dpi.DpiScaleY;
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

        Fill.Background = bg;
        Accent.Background = NewAccent;
        LabelText.Text = card.Label ?? "";
        LabelText.Foreground = fg;
        SituacaoText.Text = card.Situacao ?? "";
        SituacaoText.Foreground = sitFg;
    }

    static T Frozen<T>(T value) where T : Freezable
    {
        if (value.CanFreeze) value.Freeze();
        return value;
    }
}
