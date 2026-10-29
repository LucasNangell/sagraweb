using System.Text.Json;

namespace SagraLetreiro;

public readonly record struct ArrivalToastLayout(
    int CardWidth,
    int CardHeight,
    double SidePad,
    double EnterSlack,
    double ExitSlack,
    double EnterTravel,
    double ExitTravel,
    double BlobRadius,
    double HoldRadius,
    double WindowWidth,
    double WindowHeight);

public readonly record struct ArrivalAnimation(string Id, string Label);

public readonly record struct ArrivalToastOrigin(double Left, double Top);

public readonly record struct ArrivalPreview(
    int Width,
    int Height,
    string Animation,
    NotificationVisual? Visual,
    int TitleFontSize,
    int SituationFontSize,
    int PadX,
    int? TextGap,
    string Priority,
    int? OffsetRight,
    int? OffsetBottom);

public static class ArrivalNotify
{
    public const string PreviewKey = "preview:0-0";
    public const string DefaultAnimation = "fx-iris";
    public const int DefaultCardWidth = 320;
    public const int DefaultCardHeight = 96;
    public const int MinCardWidth = 180;
    public const int MaxCardWidth = 900;
    public const int MinCardHeight = 56;
    public const int MaxCardHeight = 280;
    public const int DefaultTitleFontSize = 22;
    public const int DefaultSituationFontSize = 14;
    public const int MinTitleFontSize = 10;
    public const int MaxTitleFontSize = 72;
    public const int MinSituationFontSize = 8;
    public const int MaxSituationFontSize = 56;
    public const int DefaultPadX = 16;
    public const int MinPadX = 4;
    public const int MaxPadX = 48;
    public const int DefaultTextGap = 4;
    public const int MinTextGap = 0;
    public const int MaxTextGap = 40;
    public const int AccentWidth = 6;
    public const int DefaultOffsetRight = 24;
    public const int DefaultOffsetBottom = 24;
    public const int MinOffset = 0;
    public const int MaxOffset = 1200;
    public const string PriorityHigh = "priority-high";
    public const string PriorityMedium = "priority-medium";
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(4);

    public static readonly ArrivalAnimation[] ClassicEntries =
    [
        new("fx-iris", "25. Íris Portal"),
        new("fx-stage-build", "26. Construção 2 estágios"),
        new("fx-glitch", "27. Glitch RGB"),
        new("fx-rubber", "28. Impacto elástico"),
        new("fx-origami", "29. Corte diagonal"),
        new("fx-laser", "30. Laser reconstrutor"),
        new("fx-isometric", "31. Pouso isométrico"),
        new("fx-crt", "32. Ignição CRT"),
        new("fx-supernova", "33. Supernova"),
        new("fx-stagger", "34. Cascata interna"),
        new("fx-shutter", "35. Obturador"),
        new("fx-warp", "36. Dobra espacial"),
        new("fx-ufo", "12. Disco voador"),
        new("fx-analisar", "13. Analisar (lupa)"),
        new("fx-prosseguir", "13. Dar prosseguimento"),
    ];

    public static int ClampCardWidth(int value) =>
        Math.Clamp(value <= 0 ? DefaultCardWidth : value, MinCardWidth, MaxCardWidth);

    public static int ClampCardHeight(int value) =>
        Math.Clamp(value <= 0 ? DefaultCardHeight : value, MinCardHeight, MaxCardHeight);

    public static int ClampTitleFontSize(int value) =>
        Math.Clamp(value <= 0 ? DefaultTitleFontSize : value, MinTitleFontSize, MaxTitleFontSize);

    public static int ClampSituationFontSize(int value) =>
        Math.Clamp(value <= 0 ? DefaultSituationFontSize : value, MinSituationFontSize, MaxSituationFontSize);

    public static int ClampPadX(int value) =>
        Math.Clamp(value <= 0 ? DefaultPadX : value, MinPadX, MaxPadX);

    public static int ClampTextGap(int? value) =>
        value is null ? DefaultTextGap : Math.Clamp(value.Value, MinTextGap, MaxTextGap);

    public static int ClampOffsetRight(int? value) =>
        value is null ? DefaultOffsetRight : Math.Clamp(value.Value, MinOffset, MaxOffset);

    public static int ClampOffsetBottom(int? value) =>
        value is null ? DefaultOffsetBottom : Math.Clamp(value.Value, MinOffset, MaxOffset);

    public static string ClampPriority(string? value)
    {
        var id = (value ?? "").Trim();
        if (string.Equals(id, PriorityHigh, StringComparison.OrdinalIgnoreCase)) return PriorityHigh;
        if (string.Equals(id, PriorityMedium, StringComparison.OrdinalIgnoreCase)) return PriorityMedium;
        return "";
    }

    public static string ClampAnimation(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return DefaultAnimation;
        var id = value.Trim();
        foreach (var item in ClassicEntries)
        {
            if (string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase))
                return item.Id;
        }
        return DefaultAnimation;
    }

    public static string ClampColumnAnimation(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var id = value.Trim();
        foreach (var item in ClassicEntries)
        {
            if (string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase))
                return item.Id;
        }
        return "";
    }

    public static bool IsActionOverlay(string? animation)
    {
        var id = ClampColumnAnimation(animation);
        return id is "fx-analisar" or "fx-prosseguir";
    }

    public static ArrivalToastLayout Layout(int cardWidth, int cardHeight, string? animation = null)
    {
        var width = ClampCardWidth(cardWidth);
        var height = ClampCardHeight(cardHeight);
        var id = ClampAnimation(animation);
        var (sidePad, enterTravel, exitTravel, scaleExtra) = Slack(id, width, height);
        var vertOvershoot = Math.Max(8, height * scaleExtra / 2);
        var enterSlack = enterTravel + vertOvershoot;
        var exitSlack = exitTravel + vertOvershoot;
        return new ArrivalToastLayout(
            width,
            height,
            sidePad,
            enterSlack,
            exitSlack,
            enterTravel,
            exitTravel,
            height / 2.0,
            Math.Min(16, Math.Max(8, height * 0.17)),
            width + sidePad * 2,
            enterSlack + height + exitSlack);
    }

    public static ArrivalToastOrigin WindowOrigin(
        ArrivalToastLayout layout,
        int offsetRight,
        int offsetBottom,
        double monitorLeft,
        double monitorTop,
        double monitorRight,
        double monitorBottom,
        double dpiX = 1,
        double dpiY = 1)
    {
        dpiX = dpiX > 0 ? dpiX : 1;
        dpiY = dpiY > 0 ? dpiY : 1;
        var cardW = layout.CardWidth * dpiX;
        var cardH = layout.CardHeight * dpiY;
        var cardLeft = Anchor(monitorRight - ClampOffsetRight(offsetRight) - cardW, cardW, monitorLeft, monitorRight);
        var cardTop = Anchor(monitorBottom - ClampOffsetBottom(offsetBottom) - cardH, cardH, monitorTop, monitorBottom);
        return new ArrivalToastOrigin(
            cardLeft - layout.SidePad * dpiX,
            cardTop - layout.EnterSlack * dpiY);
    }

    static double Anchor(double desired, double size, double min, double max)
    {
        var limit = max - size;
        return limit < min ? min : Math.Clamp(desired, min, limit);
    }

    static (double SidePad, double EnterTravel, double ExitTravel, double ScaleExtra) Slack(
        string id, int width, int height)
    {
        return id switch
        {
            "fx-rubber" => (Math.Max(16, width * 0.16), 70, 50, 0.4),
            "fx-warp" => (Math.Min(64, Math.Max(28, width * 0.18)), 12, 12, 0.6),
            "fx-supernova" => (Math.Max(16, width * 0.18), 12, 12, 0.35),
            "fx-shutter" => (Math.Max(14, width * 0.08), 10, 10, 0.15),
            "fx-glitch" => (24, 12, 12, 0.1),
            "fx-stagger" => (40, 12, 12, 0),
            "fx-isometric" => (28, 20, 20, 0.12),
            "fx-crt" => (12, 8, 8, 0),
            "fx-ufo" => (Math.Max(88, width * 0.42), Math.Max(130, height * 1.25), 16, 0.12),
            "fx-analisar" => (Math.Max(96, width * 0.35), Math.Max(48, height * 0.28), 40, 0.22),
            "fx-prosseguir" => (Math.Max(72, width * 0.4), 110, 120, 0.12),
            _ => (12, 8, 8, 0),
        };
    }

    public static NotificationVisual NormalizeVisual(NotificationVisual? raw)
    {
        raw ??= new NotificationVisual();
        return new NotificationVisual
        {
            PresetId = raw.PresetId < 0 ? 0 : raw.PresetId,
            PresetName = (raw.PresetName ?? "").Trim(),
            FontScale = ClampScale(raw.FontScale),
            TitleScale = ClampScale(raw.TitleScale),
            SituationScale = ClampScale(raw.SituationScale),
            LetterSpacing = raw.LetterSpacing is >= -0.2 and <= 0.2 ? raw.LetterSpacing : null,
            FontFamily = Clip(raw.FontFamily, 160),
            High = NormalizeSlot(raw.High),
            Medium = NormalizeSlot(raw.Medium),
            Normal = NormalizeSlot(raw.Normal),
        };
    }

    public static NotificationVisual VisualFromPreset(JsonElement payload, int id = 0, string? name = null)
    {
        var models = ModelsRoot(payload);
        var typography = TypographyRoot(payload);
        return NormalizeVisual(new NotificationVisual
        {
            PresetId = id,
            PresetName = name ?? "",
            FontScale = Number(typography, "fontScale", 1),
            TitleScale = Number(typography, "titleScale", Number(typography, "fontScale", 1)),
            SituationScale = Number(typography, "situationScale", Number(typography, "fontScale", 1)),
            LetterSpacing = OptionalNumber(typography, "letterSpacing"),
            FontFamily = GetStr(typography, "fontFamily"),
            High = SlotFrom(models, typography, "high"),
            Medium = SlotFrom(models, typography, "medium"),
            Normal = SlotFrom(models, typography, "normal"),
        });
    }

    public static NotificationSlotStyle SlotFor(NotificationVisual? visual, string? priority) =>
        (priority, visual) switch
        {
            ("priority-high", { } v) => v.High,
            ("priority-medium", { } v) => v.Medium,
            (_, { } v) => v.Normal,
            _ => new NotificationSlotStyle(),
        };

    static NotificationSlotStyle NormalizeSlot(NotificationSlotStyle? raw) => new()
    {
        Bg = Hex(raw?.Bg),
        Border = Hex(raw?.Border),
        Accent = Hex(raw?.Accent),
        Extra = Hex(raw?.Extra),
        Extra2 = Hex(raw?.Extra2),
        Text = Hex(raw?.Text),
        Title = Hex(raw?.Title),
        Situation = Hex(raw?.Situation),
        Author = Hex(raw?.Author),
        Timer = Hex(raw?.Timer),
        Effect = Clip(raw?.Effect, 64),
        Highlight = Clip(raw?.Highlight, 64),
        HighlightAccent = Hex(raw?.HighlightAccent),
        HighlightExtra = Hex(raw?.HighlightExtra),
    };

    static NotificationSlotStyle SlotFrom(JsonElement models, JsonElement typography, string key)
    {
        var slot = new NotificationSlotStyle();
        var effect = "";
        JsonElement colors = default;
        JsonElement highlightColors = default;
        if (models.ValueKind == JsonValueKind.Object && models.TryGetProperty(key, out var raw))
        {
            if (raw.ValueKind == JsonValueKind.String)
                effect = raw.GetString() ?? "";
            else if (raw.ValueKind == JsonValueKind.Object)
            {
                effect = GetStr(raw, "effect");
                slot.Highlight = GetStr(raw, "highlight");
                if (raw.TryGetProperty("colors", out var nested) && nested.ValueKind == JsonValueKind.Object)
                    colors = nested;
                if (raw.TryGetProperty("highlightColors", out var fx) && fx.ValueKind == JsonValueKind.Object)
                    highlightColors = fx;
            }
        }
        var palette = CardModelPalettes.ForEffect(effect);
        slot.Effect = effect;
        slot.Bg = Hex(GetStr(colors, "bg"));
        slot.Border = Hex(GetStr(colors, "border"));
        slot.Accent = Hex(GetStr(colors, "accent"));
        slot.Extra = Hex(GetStr(colors, "extra"));
        slot.Extra2 = Hex(GetStr(colors, "extra2"));
        slot.Text = Hex(GetStr(colors, "text"));
        slot.HighlightAccent = Hex(GetStr(highlightColors, "accent"));
        slot.HighlightExtra = Hex(GetStr(highlightColors, "extra"));
        if (slot.Bg.Length == 0) slot.Bg = palette?.Bg ?? "";
        if (slot.Border.Length == 0) slot.Border = palette?.Border ?? "";
        if (slot.Accent.Length == 0) slot.Accent = palette?.Accent ?? "";
        if (typography.ValueKind == JsonValueKind.Object)
        {
            slot.Title = Hex(GetStr(typography, "titleColor"));
            slot.Situation = Hex(GetStr(typography, "situationColor"));
            if (typography.TryGetProperty("heading", out var heading) && heading.ValueKind == JsonValueKind.Object)
            {
                var headingColor = Hex(GetStr(heading, "color"));
                if (headingColor.Length > 0 && slot.Title.Length == 0) slot.Title = headingColor;
            }
            if (typography.TryGetProperty("priorities", out var pri)
                && pri.ValueKind == JsonValueKind.Object
                && pri.TryGetProperty(key, out var pcolors)
                && pcolors.ValueKind == JsonValueKind.Object)
            {
                var title = Hex(GetStr(pcolors, "titleColor"));
                var sit = Hex(GetStr(pcolors, "situationColor"));
                var author = Hex(GetStr(pcolors, "authorColor"));
                var timer = Hex(GetStr(pcolors, "timerColor"));
                if (title.Length > 0) slot.Title = title;
                if (sit.Length > 0) slot.Situation = sit;
                if (author.Length > 0) slot.Author = author;
                if (timer.Length > 0) slot.Timer = timer;
            }
        }
        return slot;
    }

    static JsonElement ModelsRoot(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return default;
        if (payload.TryGetProperty("cardStyle", out var style)
            && style.ValueKind == JsonValueKind.Object
            && style.TryGetProperty("models", out var nested))
            return nested;
        if (payload.TryGetProperty("models", out var models))
            return models;
        return default;
    }

    static JsonElement TypographyRoot(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return default;
        if (payload.TryGetProperty("cardStyle", out var style)
            && style.ValueKind == JsonValueKind.Object
            && style.TryGetProperty("typography", out var nested))
            return nested;
        if (payload.TryGetProperty("typography", out var direct))
            return direct;
        return default;
    }

    static string GetStr(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var el)
        && el.ValueKind == JsonValueKind.String
            ? el.GetString() ?? ""
            : "";

    static double Number(JsonElement obj, string name, double fallback)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var el))
            return fallback;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var n))
            return n;
        return fallback;
    }

    static double ClampScale(double value) =>
        value is > 0.7 and <= 1.8 ? Math.Round(value, 2) : 1;

    static string Clip(string? value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length <= max ? text : text[..max];
    }

    static double? OptionalNumber(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var el))
            return null;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var n))
            return n;
        return null;
    }

    public static bool UsesCatalog(NotificationVisual? visual) =>
        visual is not null
        && (visual.PresetId > 0
            || HasCatalog(visual.High)
            || HasCatalog(visual.Medium)
            || HasCatalog(visual.Normal));

    static bool HasCatalog(NotificationSlotStyle slot) =>
        slot.Effect.Length > 0 || slot.Highlight.Length > 0;

    public static string Hex(string? value)
    {
        var text = (value ?? "").Trim();
        return text.Length is 4 or 7 or 9 && text.StartsWith('#') ? text : "";
    }

    public static TickerCard PreviewCard(string? priority = null)
    {
        var slot = ClampPriority(priority);
        return new TickerCard
        {
            UniqueKey = PreviewKey,
            OpKey = "0-0",
            Label = "OS 0000/00",
            Situacao = slot switch
            {
                PriorityHigh => "Teste · alta",
                PriorityMedium => "Teste · média",
                _ => "Teste · normal",
            },
            Priority = slot.Length == 0 ? null : slot,
            IsNew = true,
            ColumnIndex = 0,
            ColumnTitle = "Teste",
            NrOs = 0,
            Ano = 0,
        };
    }

    public static List<TickerCard> VisibleOnTicker(
        IEnumerable<TickerCard> cards,
        IReadOnlyCollection<string> heldKeys)
    {
        if (heldKeys.Count == 0) return cards.ToList();
        return cards.Where(card => !heldKeys.Contains(card.UniqueKey)).ToList();
    }
}
