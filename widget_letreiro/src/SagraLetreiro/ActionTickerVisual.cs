using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace SagraLetreiro;

sealed class ActionTickerVisual
{
    public required FrameworkElement Root { get; init; }
    public required TextBlock Label { get; init; }
    public required TextBlock Situacao { get; init; }
    public required string Kind { get; init; }
    public required double Width { get; init; }
    public required double Height { get; init; }
    public required Storyboard Motion { get; init; }

    public void Bind(TickerCard card, string situacao)
    {
        Root.Tag = card;
        Label.Text = card.Label ?? "";
        Situacao.Text = situacao ?? "";
    }

    public void Stop() => Motion.Stop();

    public static ActionTickerVisual Create(TickerCard card, string situacao, double width, double height)
    {
        var kind = ArrivalNotify.ClampColumnAnimation(card.Animation);
        var analisar = kind == "fx-analisar";
        var (numSize, sitSize) = CardMetrics.FontSizes(height + 6);
        var badgeSize = Math.Max(8, height * 0.22);
        var cyan = Color.FromRgb(0x38, 0xbd, 0xf8);
        var mint = Color.FromRgb(0x00, 0xff, 0xcc);
        var green = Color.FromRgb(0x10, 0xb9, 0x81);
        var fill = analisar
            ? Gradient(Color.FromRgb(0x16, 0x20, 0x32), Color.FromRgb(0x0c, 0x13, 0x22), 145)
            : Gradient(Color.FromRgb(0x06, 0x2c, 0x21), Color.FromRgb(0x0c, 0x13, 0x22), 135);
        var border = Frozen(new SolidColorBrush(analisar ? cyan : green));
        var badgeBg = analisar
            ? Gradient(Color.FromRgb(0x02, 0x84, 0xc7), mint, 0)
            : Gradient(Color.FromRgb(0x05, 0x96, 0x69), Color.FromRgb(0xa7, 0xf3, 0xd0), 0);
        var badgeFg = Frozen(new SolidColorBrush(
            analisar ? Color.FromRgb(0x05, 0x10, 0x1f) : Color.FromRgb(0x02, 0x2c, 0x22)));
        var titleFg = Frozen(new SolidColorBrush(analisar ? Colors.White : Color.FromRgb(0xec, 0xfd, 0xf5)));
        var sitFg = Frozen(new SolidColorBrush(analisar ? Color.FromRgb(0x7d, 0xd3, 0xfc) : Color.FromRgb(0x6e, 0xe7, 0xb7)));

        var root = new Grid
        {
            Width = width,
            Height = height,
            ClipToBounds = true,
            Tag = card,
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        root.Children.Add(new Border
        {
            Background = fill,
            BorderBrush = border,
            BorderThickness = new Thickness(1.5),
            CornerRadius = new CornerRadius(4),
        });

        Rectangle? stream = null;
        TranslateTransform? streamMove = null;
        if (!analisar)
        {
            streamMove = new TranslateTransform();
            stream = new Rectangle
            {
                Width = Math.Max(960, width * 3),
                Height = height,
                HorizontalAlignment = HorizontalAlignment.Left,
                IsHitTestVisible = false,
                Opacity = 0.85,
                RenderTransform = streamMove,
                Fill = new LinearGradientBrush
                {
                    StartPoint = new Point(0, 0),
                    EndPoint = new Point(1, 0.55),
                    GradientStops =
                    [
                        new GradientStop(Color.FromArgb(0, 0, 0, 0), 0),
                        new GradientStop(Color.FromArgb(0x22, 0x10, 0xb9, 0x81), 0.08),
                        new GradientStop(Color.FromArgb(0x28, 0x38, 0xbd, 0xf8), 0.14),
                        new GradientStop(Color.FromArgb(0, 0, 0, 0), 0.22),
                        new GradientStop(Color.FromArgb(0x22, 0x10, 0xb9, 0x81), 0.36),
                        new GradientStop(Color.FromArgb(0x28, 0x38, 0xbd, 0xf8), 0.42),
                        new GradientStop(Color.FromArgb(0, 0, 0, 0), 0.5),
                        new GradientStop(Color.FromArgb(0x22, 0x10, 0xb9, 0x81), 0.64),
                        new GradientStop(Color.FromArgb(0x28, 0x38, 0xbd, 0xf8), 0.7),
                        new GradientStop(Color.FromArgb(0, 0, 0, 0), 0.78),
                        new GradientStop(Color.FromArgb(0x22, 0x10, 0xb9, 0x81), 0.9),
                        new GradientStop(Color.FromArgb(0, 0, 0, 0), 1),
                    ],
                },
            };
            root.Children.Add(stream);
        }

        var badge = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            CornerRadius = new CornerRadius(999),
            BorderThickness = new Thickness(1),
            BorderBrush = Frozen(new SolidColorBrush(
                analisar ? Color.FromRgb(0xe0, 0xf2, 0xfe) : Color.FromRgb(0xd1, 0xfa, 0xe5))),
            Background = badgeBg,
            Padding = new Thickness(8, 1, 8, 1),
            Margin = new Thickness(0, 1, 0, 0),
            RenderTransformOrigin = new Point(0.5, 0.5),
        };
        var badgeScale = new ScaleTransform(1, 1);
        badge.RenderTransform = badgeScale;
        badge.Effect = new DropShadowEffect
        {
            Color = analisar ? cyan : green,
            BlurRadius = 10,
            ShadowDepth = 0,
            Opacity = 0.7,
            RenderingBias = RenderingBias.Performance,
        };
        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        ScaleTransform? dotScale = null;
        if (analisar)
        {
            dotScale = new ScaleTransform(0.8, 0.8);
            badgeRow.Children.Add(new Ellipse
            {
                Width = 6,
                Height = 6,
                Margin = new Thickness(0, 0, 5, 0),
                Fill = Frozen(new SolidColorBrush(Color.FromRgb(0x05, 0x10, 0x1f))),
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = dotScale,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }
        badgeRow.Children.Add(new TextBlock
        {
            Text = analisar ? "ANALISAR" : "DAR PROSSEGUIMENTO",
            FontFamily = new FontFamily("Segoe UI"),
            FontWeight = FontWeights.ExtraBold,
            FontSize = badgeSize,
            Foreground = badgeFg,
            VerticalAlignment = VerticalAlignment.Center,
        });
        TranslateTransform[] chevrons = [];
        TextBlock[] chevronBlocks = [];
        if (!analisar)
        {
            chevrons = [new TranslateTransform(), new TranslateTransform(), new TranslateTransform()];
            chevronBlocks =
            [
                Chevron(chevrons[0]),
                Chevron(chevrons[1]),
                Chevron(chevrons[2]),
            ];
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 0, 0, 0) };
            foreach (var item in chevronBlocks) row.Children.Add(item);
            badgeRow.Children.Add(row);
        }
        badge.Child = badgeRow;

        var label = Line(card.Label, titleFg, numSize, true);
        var sit = Line(situacao, sitFg, sitSize, false);
        var stack = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 8, 0),
        };
        stack.Children.Add(badge);
        stack.Children.Add(label);
        stack.Children.Add(sit);
        root.Children.Add(stack);

        TranslateTransform? magMove = null;
        RotateTransform? magRotate = null;
        ScaleTransform? magScale = null;
        if (analisar)
        {
            magMove = new TranslateTransform();
            magRotate = new RotateTransform(-8);
            magScale = new ScaleTransform(1, 1);
            var magSize = Math.Clamp(height * 0.55, 14, 22);
            var mag = Magnifier(magSize);
            mag.RenderTransformOrigin = new Point(0.5, 0.5);
            mag.RenderTransform = new TransformGroup
            {
                Children = { magScale, magRotate, magMove },
            };
            mag.HorizontalAlignment = HorizontalAlignment.Left;
            mag.VerticalAlignment = VerticalAlignment.Top;
            mag.Margin = new Thickness(4, 2, 0, 0);
            mag.IsHitTestVisible = false;
            root.Children.Add(mag);
        }

        var motion = BuildMotion(
            analisar, width, height, badgeScale, dotScale, magMove, magRotate, magScale,
            stream, streamMove, chevronBlocks, chevrons);
        motion.Begin(root, true);
        return new ActionTickerVisual
        {
            Root = root,
            Label = label,
            Situacao = sit,
            Kind = kind,
            Width = width,
            Height = height,
            Motion = motion,
        };
    }

    static Storyboard BuildMotion(
        bool analisar,
        double width,
        double height,
        ScaleTransform badgeScale,
        ScaleTransform? dotScale,
        TranslateTransform? magMove,
        RotateTransform? magRotate,
        ScaleTransform? magScale,
        Rectangle? stream,
        TranslateTransform? streamMove,
        TextBlock[] chevrons,
        TranslateTransform[] chevronMoves)
    {
        var sb = new Storyboard { RepeatBehavior = RepeatBehavior.Forever };
        PulseScale(sb, badgeScale, 6);
        if (analisar && magMove is not null && magRotate is not null && magScale is not null)
        {
            var magW = Math.Clamp(height * 0.55, 14, 22);
            var maxX = Math.Max(8, width - magW - 10);
            var maxY = Math.Max(4, height - magW - 4);
            DoubleFrames(sb, magMove, TranslateTransform.XProperty,
                (0, -8), (1.3, 8), (2.5, maxX * 0.92), (3.7, maxX * 0.7), (4.7, 12), (6, maxX));
            DoubleFrames(sb, magMove, TranslateTransform.YProperty,
                (0, -4), (1.3, 2), (2.5, 2), (3.7, maxY * 0.7), (4.7, maxY * 0.55), (6, -4));
            DoubleFrames(sb, magRotate, RotateTransform.AngleProperty,
                (0, -35), (1.3, -8), (2.5, 10), (3.7, -5), (4.7, 12), (6, 30));
            DoubleFrames(sb, magScale, ScaleTransform.ScaleXProperty,
                (0, 1.15), (1.3, 1), (2.5, 1.08), (3.7, 1), (4.7, 1.05), (6, 0.85));
            DoubleFrames(sb, magScale, ScaleTransform.ScaleYProperty,
                (0, 1.15), (1.3, 1), (2.5, 1.08), (3.7, 1), (4.7, 1.05), (6, 0.85));
            if (dotScale is not null)
            {
                DoubleFrames(sb, dotScale, ScaleTransform.ScaleXProperty, (0, 0.8), (0.6, 1.25), (1.2, 0.8));
                DoubleFrames(sb, dotScale, ScaleTransform.ScaleYProperty, (0, 0.8), (0.6, 1.25), (1.2, 0.8));
            }
        }
        else if (stream is not null && streamMove is not null)
        {
            var slide = new DoubleAnimation
            {
                From = 0,
                To = -width,
                Duration = TimeSpan.FromSeconds(12),
                RepeatBehavior = RepeatBehavior.Forever,
            };
            Storyboard.SetTarget(slide, streamMove);
            Storyboard.SetTargetProperty(slide, new PropertyPath(TranslateTransform.XProperty));
            sb.Children.Add(slide);
            for (var i = 0; i < chevrons.Length; i++)
            {
                var delay = TimeSpan.FromSeconds(i * 0.18);
                var opacity = new DoubleAnimation
                {
                    From = 0.3,
                    To = 1,
                    Duration = TimeSpan.FromSeconds(0.6),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    BeginTime = delay,
                };
                Storyboard.SetTarget(opacity, chevrons[i]);
                Storyboard.SetTargetProperty(opacity, new PropertyPath(UIElement.OpacityProperty));
                sb.Children.Add(opacity);
                var nudge = new DoubleAnimation
                {
                    From = -2,
                    To = 3,
                    Duration = TimeSpan.FromSeconds(0.6),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    BeginTime = delay,
                };
                Storyboard.SetTarget(nudge, chevronMoves[i]);
                Storyboard.SetTargetProperty(nudge, new PropertyPath(TranslateTransform.XProperty));
                sb.Children.Add(nudge);
            }
        }
        return sb;
    }

    static void PulseScale(Storyboard sb, ScaleTransform scale, double seconds)
    {
        DoubleFrames(sb, scale, ScaleTransform.ScaleXProperty, (0, 1), (seconds * 0.18, 1.08), (seconds * 0.3, 1), (seconds * 0.5, 1.05), (seconds * 0.7, 1), (seconds, 1));
        DoubleFrames(sb, scale, ScaleTransform.ScaleYProperty, (0, 1), (seconds * 0.18, 1.08), (seconds * 0.3, 1), (seconds * 0.5, 1.05), (seconds * 0.7, 1), (seconds, 1));
    }

    static void DoubleFrames(Storyboard sb, DependencyObject target, DependencyProperty property, params (double Seconds, double Value)[] frames)
    {
        var anim = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromSeconds(frames[^1].Seconds) };
        foreach (var (seconds, value) in frames)
            anim.KeyFrames.Add(new LinearDoubleKeyFrame(value, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(seconds))));
        Storyboard.SetTarget(anim, target);
        Storyboard.SetTargetProperty(anim, new PropertyPath(property));
        sb.Children.Add(anim);
    }

    static Canvas Magnifier(double size)
    {
        var lens = size;
        var canvas = new Canvas { Width = size + 10, Height = size + 12 };
        canvas.Children.Add(new Ellipse
        {
            Width = lens,
            Height = lens,
            Stroke = Frozen(new SolidColorBrush(Color.FromRgb(0xe2, 0xe8, 0xf0))),
            StrokeThickness = 2,
            Fill = new RadialGradientBrush
            {
                GradientOrigin = new Point(0.3, 0.3),
                Center = new Point(0.35, 0.35),
                GradientStops =
                [
                    new GradientStop(Color.FromArgb(0x52, 0xff, 0xff, 0xff), 0),
                    new GradientStop(Color.FromArgb(0x24, 0x38, 0xbd, 0xf8), 0.45),
                    new GradientStop(Color.FromArgb(0x10, 0x00, 0xff, 0xcc), 1),
                ],
            },
            Effect = new DropShadowEffect
            {
                Color = Color.FromRgb(0x38, 0xbd, 0xf8),
                BlurRadius = 8,
                ShadowDepth = 0,
                Opacity = 0.7,
                RenderingBias = RenderingBias.Performance,
            },
        });
        var handle = new Border
        {
            Width = 4,
            Height = Math.Max(8, size * 0.45),
            CornerRadius = new CornerRadius(2),
            Background = Frozen(new SolidColorBrush(Color.FromRgb(0x94, 0xa3, 0xb8))),
            RenderTransformOrigin = new Point(0.5, 0),
            RenderTransform = new RotateTransform(-42),
        };
        Canvas.SetLeft(handle, lens * 0.72);
        Canvas.SetTop(handle, lens * 0.72);
        canvas.Children.Add(handle);
        return canvas;
    }

    static TextBlock Chevron(TranslateTransform move) => new()
    {
        Text = "›",
        FontWeight = FontWeights.Black,
        FontSize = 11,
        Margin = new Thickness(0, 0, -3, 0),
        Opacity = 0.3,
        RenderTransform = move,
        VerticalAlignment = VerticalAlignment.Center,
    };

    static TextBlock Line(string text, Brush fg, double size, bool bold) => new()
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

    static LinearGradientBrush Gradient(Color a, Color b, double angle) =>
        Frozen(new LinearGradientBrush(a, b, angle));

    static T Frozen<T>(T value) where T : Freezable
    {
        if (value.CanFreeze) value.Freeze();
        return value;
    }
}
