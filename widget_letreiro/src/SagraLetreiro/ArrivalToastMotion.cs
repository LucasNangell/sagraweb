using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;

namespace SagraLetreiro;

static class ArrivalToastMotion
{
    public static Storyboard Build(ArrivalToastLayout layout, string animation)
    {
        var sb = new Storyboard();
        switch (ArrivalNotify.ClampAnimation(animation))
        {
            case "fx-stage-build": Stage(sb, layout); break;
            case "fx-glitch": Glitch(sb, layout); break;
            case "fx-rubber": Rubber(sb, layout); break;
            case "fx-origami": Origami(sb, layout); break;
            case "fx-laser": Laser(sb, layout); break;
            case "fx-isometric": Isometric(sb); break;
            case "fx-crt": Crt(sb); break;
            case "fx-supernova": Supernova(sb); break;
            case "fx-stagger": Stagger(sb); break;
            case "fx-shutter": Shutter(sb, layout); break;
            case "fx-warp": Warp(sb, layout); break;
            default: Iris(sb, layout); break;
        }
        return sb;
    }

    static void Iris(Storyboard sb, ArrivalToastLayout layout)
    {
        var r = Math.Max(layout.CardWidth, layout.CardHeight) * 1.5;
        D(sb, "CardIris", "RadiusX", Discrete(0, 0), Eased(r, 1, EaseInOut()), Discrete(r, 3), Eased(0, 4, EaseInOut()));
        D(sb, "CardIris", "RadiusY", Discrete(0, 0), Eased(r, 1, EaseInOut()), Discrete(r, 3), Eased(0, 4, EaseInOut()));
        P(sb, "CardIris", "Center",
            new DiscretePointKeyFrame(new Point(0, layout.CardHeight / 2.0), At(0)),
            new DiscretePointKeyFrame(new Point(0, layout.CardHeight / 2.0), At(3)),
            new EasingPointKeyFrame(new Point(layout.CardWidth, layout.CardHeight / 2.0), At(4)) { EasingFunction = EaseInOut() });
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Stage(Storyboard sb, ArrivalToastLayout layout)
    {
        var w = layout.CardWidth;
        var h = layout.CardHeight;
        R(sb, "CardClip", "Rect",
            DiscreteRect(new Rect(0, 0, 0, 0), 0),
            LinearRect(new Rect(0, 0, Math.Max(4, w * 0.03), h), 0.48),
            EasedRect(new Rect(0, 0, w, h), 1.2, EaseOut()),
            DiscreteRect(new Rect(0, 0, w, h), 3),
            EasedRect(new Rect(w, 0, 0, h), 3.6, EaseIn()),
            DiscreteRect(new Rect(w, 0, 0, h), 4));
        Opacity(sb, 1, 1, 1, 0);
    }

    static void Glitch(Storyboard sb, ArrivalToastLayout layout)
    {
        D(sb, "CardMove", "X",
            Discrete(-20, 0), Linear(15, 0.16), Linear(-10, 0.32), Linear(5, 0.48), Linear(0, 0.64),
            Discrete(0, 3.12), Linear(-15, 3.28), Discrete(0, 3.44));
        D(sb, "CardSkew", "AngleX",
            Discrete(20, 0), Linear(-25, 0.16), Linear(0, 0.32), Linear(10, 0.48), Linear(0, 0.64),
            Discrete(0, 3.12), Linear(30, 3.28), Discrete(0, 3.44));
        D(sb, "CardScale", "ScaleY", Discrete(1, 0), Linear(1.1, 0.32), Linear(1, 0.64), Discrete(1, 3.28), Linear(0.05, 4));
        D(sb, "CardScale", "ScaleX", Discrete(1, 0), Discrete(1, 3.28), Linear(1.5, 4));
        D(sb, "CardBorder", "Opacity", Discrete(0, 0), Linear(1, 0.16), Discrete(1, 3.12), Linear(0.8, 3.28), Linear(0, 3.44));
        _ = layout;
    }

    static void Rubber(Storyboard sb, ArrivalToastLayout layout)
    {
        D(sb, "CardMove", "Y",
            Discrete(-layout.EnterTravel, 0), Linear(0, 0.48), Discrete(0, 3.4), Eased(layout.ExitTravel, 4, EaseIn()));
        D(sb, "CardScale", "ScaleY",
            Discrete(1.4, 0), Linear(0.65, 0.48), Linear(1.18, 0.8), Linear(0.92, 1.12), Linear(1, 1.44),
            Discrete(1, 3.4), Linear(1.3, 4));
        D(sb, "CardScale", "ScaleX",
            Discrete(0.7, 0), Linear(1.3, 0.48), Linear(0.88, 0.8), Linear(1.06, 1.12), Linear(1, 1.44),
            Discrete(1, 3.4), Linear(0.5, 4));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Origami(Storyboard sb, ArrivalToastLayout layout)
    {
        var w = layout.CardWidth;
        var h = layout.CardHeight;
        R(sb, "CardClip", "Rect",
            DiscreteRect(new Rect(0, 0, 0, h), 0),
            EasedRect(new Rect(0, 0, w, h), 1, EaseInOut()),
            DiscreteRect(new Rect(0, 0, w, h), 3),
            EasedRect(new Rect(w, 0, 0, h), 4, EaseInOut()));
        D(sb, "CardScale", "ScaleX", Discrete(0.92, 0), Eased(1, 1, EaseInOut()), Discrete(1, 3), Eased(0.92, 4, EaseInOut()));
        D(sb, "CardScale", "ScaleY", Discrete(0.92, 0), Eased(1, 1, EaseInOut()), Discrete(1, 3), Eased(0.92, 4, EaseInOut()));
        Opacity(sb, 1, 1, 1, 1);
    }

    static void Laser(Storyboard sb, ArrivalToastLayout layout)
    {
        var w = layout.CardWidth;
        var h = layout.CardHeight;
        R(sb, "CardClip", "Rect",
            DiscreteRect(new Rect(0, 0, 0, h), 0),
            EasedRect(new Rect(0, 0, w, h), 1, EaseOut()),
            DiscreteRect(new Rect(0, 0, w, h), 3.6),
            DiscreteRect(new Rect(0, 0, w, h), 4));
        D(sb, "LaserMove", "X", Discrete(0, 0), Eased(w, 1, EaseOut()), Discrete(w, 4));
        D(sb, "LaserBeam", "Opacity", Discrete(1, 0), Discrete(1, 1), Discrete(0, 1.04));
        D(sb, "CardBorder", "Opacity", Discrete(1, 0), Discrete(1, 3.6), Linear(0, 4));
        D(sb, "CardBlur", "Radius", Discrete(0, 0), Discrete(0, 3.6), Linear(6, 4));
    }

    static void Isometric(Storyboard sb)
    {
        D(sb, "CardRotate", "Angle", Discrete(-28, 0), Eased(0, 1, EaseOut()), Discrete(0, 3), Eased(22, 4, EaseIn()));
        D(sb, "CardScale", "ScaleX", Discrete(0.82, 0), Eased(1, 1, EaseOut()), Discrete(1, 3), Eased(0.85, 4, EaseIn()));
        D(sb, "CardScale", "ScaleY", Discrete(0.62, 0), Eased(1, 1, EaseOut()), Discrete(1, 3), Eased(0.7, 4, EaseIn()));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Crt(Storyboard sb)
    {
        D(sb, "CardScale", "ScaleX", Discrete(0.01, 0), Linear(1, 0.4), Discrete(1, 3.52), Linear(0, 4));
        D(sb, "CardScale", "ScaleY", Discrete(0.02, 0), Linear(0.03, 0.4), Eased(1, 0.88, EaseOut()), Discrete(1, 3), Linear(0.02, 3.52), Linear(0, 4));
        D(sb, "WhiteFlash", "Opacity", Discrete(0.85, 0), Linear(0.45, 0.4), Linear(0, 0.88), Discrete(0, 3.52), Linear(0.7, 4));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Supernova(Storyboard sb)
    {
        D(sb, "CardScale", "ScaleX", Discrete(1.35, 0), Eased(1, 0.8, EaseOut()), Discrete(1, 3), Linear(0.85, 4));
        D(sb, "CardScale", "ScaleY", Discrete(1.35, 0), Eased(1, 0.8, EaseOut()), Discrete(1, 3), Linear(0.85, 4));
        D(sb, "CardBlur", "Radius", Discrete(15, 0), Eased(0, 0.8, EaseOut()), Discrete(0, 3), Linear(10, 4));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Stagger(Storyboard sb)
    {
        D(sb, "CardMove", "X", Discrete(-40, 0), Eased(0, 0.48, EaseOut()), Discrete(0, 3.2), Eased(40, 4, EaseIn()));
        D(sb, "TitleMove", "Y", Discrete(20, 0), Discrete(20, 0.4), Eased(0, 0.96, EaseOut()), Discrete(0, 3.12), Eased(-15, 4, EaseIn()));
        D(sb, "LabelText", "Opacity", Discrete(0, 0), Discrete(0, 0.4), Eased(1, 0.96, EaseOut()), Discrete(1, 3.12), Eased(0, 4, EaseIn()));
        D(sb, "SubMove", "X", Discrete(-25, 0), Discrete(-25, 0.8), Eased(0, 1.36, EaseOut()), Discrete(0, 3), Eased(20, 4, EaseIn()));
        D(sb, "SituacaoText", "Opacity", Discrete(0, 0), Discrete(0, 0.8), Eased(1, 1.36, EaseOut()), Discrete(1, 3), Eased(0, 4, EaseIn()));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Shutter(Storyboard sb, ArrivalToastLayout layout)
    {
        var w = layout.CardWidth;
        var h = layout.CardHeight;
        R(sb, "CardClip", "Rect",
            DiscreteRect(new Rect(0, h / 2, w, 0), 0),
            EasedRect(new Rect(0, 0, w, h), 0.88, EaseInOut()),
            DiscreteRect(new Rect(0, 0, w, h), 3),
            EasedRect(new Rect(w / 2, 0, 0, h), 4, EaseInOut()));
        D(sb, "CardScale", "ScaleX", Discrete(1.15, 0), Eased(1, 0.88, EaseInOut()), Discrete(1, 3), Eased(0.9, 4, EaseInOut()));
        D(sb, "CardScale", "ScaleY", Discrete(1.15, 0), Eased(1, 0.88, EaseInOut()), Discrete(1, 3), Eased(0.9, 4, EaseInOut()));
        Opacity(sb, 1, 1, 1, 1);
    }

    static void Warp(Storyboard sb, ArrivalToastLayout layout)
    {
        var travel = Math.Min(layout.SidePad * 2, layout.CardWidth * 0.4);
        D(sb, "CardMove", "X",
            Discrete(-travel, 0), Linear(travel * 0.15, 0.56), Linear(0, 0.88), Discrete(0, 3.4), Linear(travel, 4));
        D(sb, "CardScale", "ScaleX", Discrete(1.8, 0), Linear(0.85, 0.56), Linear(1, 0.88), Discrete(1, 3.4), Linear(1.8, 4));
        D(sb, "CardScale", "ScaleY", Discrete(0.35, 0), Linear(1.1, 0.56), Linear(1, 0.88), Discrete(1, 3.4), Linear(0.35, 4));
        D(sb, "CardBlur", "Radius", Discrete(12, 0), Linear(0, 0.56), Discrete(0, 3.4), Linear(12, 4));
        Opacity(sb, 0, 1, 1, 0);
    }

    static void Opacity(Storyboard sb, double a, double b, double c, double d) =>
        D(sb, "CardBorder", "Opacity", Discrete(a, 0), Eased(b, 1, EaseOut()), Discrete(c, 3), Eased(d, 4, EaseIn()));

    static void D(Storyboard sb, string target, string property, params DoubleKeyFrame[] frames)
    {
        var anim = new DoubleAnimationUsingKeyFrames();
        Storyboard.SetTargetName(anim, target);
        Storyboard.SetTargetProperty(anim, new PropertyPath(property));
        foreach (var frame in frames) anim.KeyFrames.Add(frame);
        sb.Children.Add(anim);
    }

    static void R(Storyboard sb, string target, string property, params RectKeyFrame[] frames)
    {
        var anim = new RectAnimationUsingKeyFrames();
        Storyboard.SetTargetName(anim, target);
        Storyboard.SetTargetProperty(anim, new PropertyPath(property));
        foreach (var frame in frames) anim.KeyFrames.Add(frame);
        sb.Children.Add(anim);
    }

    static void P(Storyboard sb, string target, string property, params PointKeyFrame[] frames)
    {
        var anim = new PointAnimationUsingKeyFrames();
        Storyboard.SetTargetName(anim, target);
        Storyboard.SetTargetProperty(anim, new PropertyPath(property));
        foreach (var frame in frames) anim.KeyFrames.Add(frame);
        sb.Children.Add(anim);
    }

    static DiscreteDoubleKeyFrame Discrete(double value, double seconds) =>
        new(value, At(seconds));

    static LinearDoubleKeyFrame Linear(double value, double seconds) =>
        new(value, At(seconds));

    static EasingDoubleKeyFrame Eased(double value, double seconds, IEasingFunction easing) =>
        new(value, At(seconds)) { EasingFunction = easing };

    static DiscreteRectKeyFrame DiscreteRect(Rect value, double seconds) =>
        new(value, At(seconds));

    static LinearRectKeyFrame LinearRect(Rect value, double seconds) =>
        new(value, At(seconds));

    static EasingRectKeyFrame EasedRect(Rect value, double seconds, IEasingFunction easing) =>
        new(value, At(seconds)) { EasingFunction = easing };

    static KeyTime At(double seconds) => KeyTime.FromTimeSpan(TimeSpan.FromSeconds(seconds));

    static IEasingFunction EaseOut() => new CubicEase { EasingMode = EasingMode.EaseOut };
    static IEasingFunction EaseIn() => new CubicEase { EasingMode = EasingMode.EaseIn };
    static IEasingFunction EaseInOut() => new CubicEase { EasingMode = EasingMode.EaseInOut };

    public static void Prepare(ArrivalToastWindow window, ArrivalToastLayout layout, string animation)
    {
        var id = ArrivalNotify.ClampAnimation(animation);
        window.CardScale.ScaleX = 1;
        window.CardScale.ScaleY = 1;
        window.CardMove.X = 0;
        window.CardMove.Y = 0;
        window.CardSkew.AngleX = 0;
        window.CardRotate.Angle = 0;
        window.CardBorder.Opacity = 1;
        window.LaserBeam.Opacity = 0;
        window.WhiteFlash.Opacity = 0;
        window.LabelText.Opacity = 1;
        window.SituacaoText.Opacity = 1;
        window.CardBorder.RenderTransformOrigin = id switch
        {
            "fx-rubber" => new Point(0.5, 1),
            "fx-stage-build" => new Point(0, 0),
            _ => new Point(0.5, 0.5),
        };
        window.CardBorder.Effect = id is "fx-laser" or "fx-supernova" or "fx-warp"
            ? new BlurEffect { Radius = 0, RenderingBias = RenderingBias.Performance }
            : null;
        if (window.CardBorder.Effect is BlurEffect blur)
            window.RegisterName("CardBlur", blur);

        if (id == "fx-iris")
        {
            var iris = new EllipseGeometry
            {
                Center = new Point(0, layout.CardHeight / 2.0),
                RadiusX = 0,
                RadiusY = 0,
            };
            window.CardBorder.Clip = iris;
            window.RegisterName("CardIris", iris);
            return;
        }

        if (id is "fx-stage-build" or "fx-origami" or "fx-laser" or "fx-shutter")
        {
            window.CardClip.Rect = id == "fx-shutter"
                ? new Rect(0, layout.CardHeight / 2.0, layout.CardWidth, 0)
                : new Rect(0, 0, 0, layout.CardHeight);
            window.CardClip.RadiusX = 0;
            window.CardClip.RadiusY = 0;
            window.CardBorder.Clip = window.CardClip;
            return;
        }

        window.CardBorder.Clip = null;
    }
}
