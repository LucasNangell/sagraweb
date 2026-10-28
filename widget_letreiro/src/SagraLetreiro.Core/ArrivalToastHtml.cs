using System.Globalization;
using System.Text;

namespace SagraLetreiro;

public static class ArrivalToastHtml
{
    static readonly string[] CssFiles =
    [
        "dashboard-setor-modern.css",
        "dashboard-setor-modern-cards.css",
        "dashboard-setor-modern-catalog.css",
        "toast-overlay.css",
    ];

    static string? _cachedCss;

    public static string Build(
        TickerCard card,
        NotificationVisual visual,
        int titleFontSize,
        int situationFontSize)
    {
        var slot = ArrivalNotify.SlotFor(visual, card.Priority);
        var label = Esc(card.Label);
        var situacao = Esc(card.Situacao);
        var priority = card.Priority switch
        {
            "priority-high" => "priority-high",
            "priority-medium" => "priority-medium",
            _ => "",
        };
        var rootVars = new StringBuilder();
        AppendVar(rootVars, "--sm-font-family", visual.FontFamily);
        AppendVar(rootVars, "--sm-font-scale", Scale(visual.FontScale));
        AppendVar(rootVars, "--sm-title-scale", Scale(visual.TitleScale));
        AppendVar(rootVars, "--sm-situation-scale", Scale(visual.SituationScale));
        if (visual.LetterSpacing is double spacing)
            AppendVar(rootVars, "--sm-letter-spacing", spacing.ToString("0.###", CultureInfo.InvariantCulture) + "em");
        AppendVar(rootVars, "--toast-title-px", $"{titleFontSize}px");
        AppendVar(rootVars, "--toast-situation-px", $"{situationFontSize}px");

        var cardVars = new StringBuilder();
        AppendVar(cardVars, "--cm-bg", slot.Bg);
        AppendVar(cardVars, "--cm-border", slot.Border);
        AppendVar(cardVars, "--cm-accent", slot.Accent);
        AppendVar(cardVars, "--cm-extra", slot.Extra);
        AppendVar(cardVars, "--cm-extra2", slot.Extra2);
        AppendVar(cardVars, "--cm-text", slot.Text);
        AppendVar(cardVars, "--fx-accent", slot.HighlightAccent);
        AppendVar(cardVars, "--fx-extra", slot.HighlightExtra);
        AppendVar(cardVars, "--sm-title-color", slot.Title);
        AppendVar(cardVars, "--sm-situation-color", slot.Situation);
        AppendVar(cardVars, "--sm-author-color", slot.Author);
        AppendVar(cardVars, "--sm-timer-color", slot.Timer);

        var model = ModelAttr(slot.Effect);
        var highlight = HighlightAttr(slot.Highlight);
        var titleFlag = slot.Title.Length > 0 ? " data-title-color=\"1\"" : "";
        var sitFlag = slot.Situation.Length > 0 ? " data-situation-color=\"1\"" : "";
        var authorFlag = slot.Author.Length > 0 ? " data-author-color=\"1\"" : "";
        var timerFlag = slot.Timer.Length > 0 ? " data-timer-color=\"1\"" : "";
        return $$"""
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="utf-8" />
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Orbitron:wght@700;900&family=Space+Grotesk:wght@500;700;900&family=Syne:wght@700;800&display=swap" />
            <style>{{Css()}}</style>
            </head>
            <body class="setor-modern setor-modern-board" style="{{rootVars}}">
            <div class="setor-modern-card-motion">
            <article class="setor-modern-card {{priority}}"{{model}}{{highlight}}{{titleFlag}}{{sitFlag}}{{authorFlag}}{{timerFlag}} style="{{cardVars}}">
            <div class="setor-modern-card-top"><h3 data-text="{{label}}">{{label}}</h3></div>
            <div class="setor-modern-situation"><span>{{situacao}}</span></div>
            </article>
            </div>
            </body>
            </html>
            """;
    }

    public static string Css()
    {
        if (_cachedCss is not null) return _cachedCss;
        var asm = typeof(ArrivalToastHtml).Assembly;
        var names = asm.GetManifestResourceNames();
        var buf = new StringBuilder();
        foreach (var file in CssFiles)
        {
            var name = names.FirstOrDefault(n => n.EndsWith(file, StringComparison.OrdinalIgnoreCase));
            if (name is null) continue;
            using var stream = asm.GetManifestResourceStream(name);
            if (stream is null) continue;
            using var reader = new StreamReader(stream);
            buf.AppendLine(reader.ReadToEnd());
        }
        _cachedCss = buf.ToString();
        return _cachedCss;
    }

    static string Scale(double value) =>
        (value is > 0.7 and <= 1.8 ? value : 1).ToString("0.##", CultureInfo.InvariantCulture);

    static void AppendVar(StringBuilder buf, string name, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        buf.Append(name).Append(':').Append(value).Append(';');
    }

    static string ModelAttr(string effect) =>
        string.IsNullOrWhiteSpace(effect) ? "" : $" data-model=\"{Esc(effect)}\"";

    static string HighlightAttr(string highlight) =>
        string.IsNullOrWhiteSpace(highlight) ? "" : $" data-highlight=\"{Esc(highlight)}\"";

    static string Esc(string? value)
    {
        var raw = value ?? "";
        return raw
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal);
    }
}
