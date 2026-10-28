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
    readonly Storyboard _mercury = new();

    public ArrivalToastWindow(TickerCard card, int cardWidth, int cardHeight)
    {
        InitializeComponent();
        _layout = ArrivalNotify.Layout(cardWidth, cardHeight);
        OverlayChrome.ApplyFloatingStyle(this);
        ApplyLayout();
        Bind(card);
        BuildMercury();
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
        var widthPx = _layout.WindowWidth * dpi.DpiScaleX;
        var heightPx = _layout.WindowHeight * dpi.DpiScaleY;
        var geom = TaskbarService.At((int)overlayTop.X, (int)overlayTop.Y);
        var left = overlayTop.X + overlayW - widthPx;
        var holdBottom = overlayTop.Y - 8;
        var top = holdBottom - (_layout.EnterSlack + _layout.CardHeight) * dpi.DpiScaleY;
        if (top < geom.MonitorTop)
            top = overlayTop.Y + overlayH + 8 - _layout.EnterSlack * dpi.DpiScaleY;
        if (left + widthPx > geom.MonitorRight) left = geom.MonitorRight - widthPx - 8;
        if (left < geom.MonitorLeft) left = geom.MonitorLeft + 8;
        if (top + heightPx > geom.MonitorBottom) top = geom.MonitorBottom - heightPx - 8;
        Left = left / dpi.DpiScaleX;
        Top = top / dpi.DpiScaleY;
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
        CardClip.Rect = new Rect(0, 0, _layout.CardWidth, _layout.CardHeight);
        CardClip.RadiusX = _layout.BlobRadius;
        CardClip.RadiusY = _layout.BlobRadius;
        CardMove.Y = -_layout.EnterTravel;
        LabelText.FontSize = Math.Max(14, _layout.CardHeight * 0.23);
        SituacaoText.FontSize = Math.Max(11, _layout.CardHeight * 0.15);
    }

    void BuildMercury()
    {
        var bounceOut = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.56 };
        var bounceIn = new BackEase { EasingMode = EasingMode.EaseIn, Amplitude = 0.56 };
        ScaleFrames(CardScale, ScaleTransform.ScaleXProperty, bounceOut, bounceIn, 0.15, 1);
        ScaleFrames(CardScale, ScaleTransform.ScaleYProperty, bounceOut, bounceIn, 0.15, 1);
        _mercury.Children.Add(KeyFrames(CardMove, TranslateTransform.YProperty,
            Discrete(-_layout.EnterTravel, 0),
            Eased(0, TimeSpan.FromSeconds(1), bounceOut),
            Discrete(0, 3),
            Eased(_layout.ExitTravel, TimeSpan.FromSeconds(4), bounceIn)));
        _mercury.Children.Add(KeyFrames(CardBorder, UIElement.OpacityProperty,
            Discrete(0, 0),
            Eased(1, TimeSpan.FromSeconds(1), bounceOut),
            Discrete(1, 3),
            Eased(0, TimeSpan.FromSeconds(4), bounceIn)));
        _mercury.Children.Add(KeyFrames(CardClip, RectangleGeometry.RadiusXProperty,
            Discrete(_layout.BlobRadius, 0),
            Linear(_layout.HoldRadius, 1),
            Discrete(_layout.HoldRadius, 3),
            Linear(_layout.BlobRadius, 4)));
        _mercury.Children.Add(KeyFrames(CardClip, RectangleGeometry.RadiusYProperty,
            Discrete(_layout.BlobRadius, 0),
            Linear(_layout.HoldRadius, 1),
            Discrete(_layout.HoldRadius, 3),
            Linear(_layout.BlobRadius, 4)));
    }

    void ScaleFrames(DependencyObject target, DependencyProperty property, IEasingFunction enter, IEasingFunction exit, double from, double to)
    {
        _mercury.Children.Add(KeyFrames(target, property,
            Discrete(from, 0),
            Eased(to, TimeSpan.FromSeconds(1), enter),
            Discrete(to, 3),
            Eased(from, TimeSpan.FromSeconds(4), exit)));
    }

    static DoubleAnimationUsingKeyFrames KeyFrames(DependencyObject target, DependencyProperty property, params DoubleKeyFrame[] frames)
    {
        var anim = new DoubleAnimationUsingKeyFrames();
        Storyboard.SetTarget(anim, target);
        Storyboard.SetTargetProperty(anim, new PropertyPath(property));
        foreach (var frame in frames) anim.KeyFrames.Add(frame);
        return anim;
    }

    static DiscreteDoubleKeyFrame Discrete(double value, double seconds) =>
        new(value, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(seconds)));

    static LinearDoubleKeyFrame Linear(double value, double seconds) =>
        new(value, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(seconds)));

    static EasingDoubleKeyFrame Eased(double value, TimeSpan at, IEasingFunction easing) =>
        new(value, KeyTime.FromTimeSpan(at)) { EasingFunction = easing };

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
