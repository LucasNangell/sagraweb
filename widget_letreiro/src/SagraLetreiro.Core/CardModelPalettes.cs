namespace SagraLetreiro;

public readonly record struct CardModelPalette(string Bg, string Border, string Accent);

public static class CardModelPalettes
{
    static readonly Dictionary<string, CardModelPalette> ByEffect = new(StringComparer.OrdinalIgnoreCase)
    {
        ["v79"] = new("#ff9d00", "#ffd166", "#fff0b3"),
        ["v77"] = new("#18181b", "#10b981", "#4ade80"),
        ["v80"] = new("#18181b", "#ffffff", "#10b981"),
        ["v81"] = new("#18181b", "#10b981", "#10b981"),
        ["v37"] = new("#0f172a", "#38bdf8", "#ffffff"),
        ["mod-conic-beam"] = new("#0f172a", "#00f2fe", "#4facfe"),
        ["mod-kinetic-grad"] = new("#0a0a0c", "#27272a", "#ff007f"),
        ["mod-3d-orbit"] = new("#0f172a", "#94a3b8", "#38bdf8"),
        ["mod-brutalist"] = new("#fde047", "#09090b", "#ec4899"),
        ["mod-terminal"] = new("#05100a", "#10b981", "#10b981"),
        ["mod-stroke-wave"] = new("#13111c", "#2e2640", "#a855f7"),
        ["mod-cinematic-serif"] = new("#0c0a09", "#78716c", "#fbbf24"),
        ["mod-3d-text-extrude"] = new("#31102f", "#db2777", "#f472b6"),
        ["mod-aurora"] = new("#ee7752", "#23a6d5", "#e73c7e"),
        ["mod-holo-prism"] = new("#1e293b", "#ffffff", "#00ffff"),
        ["mod-neumorph"] = new("#1e293b", "#2d3e59", "#38bdf8"),
        ["mod-hud"] = new("#06182a", "#06b6d4", "#22d3ee"),
        ["mod-slot-text"] = new("#18181b", "#3f3f46", "#fbbf24"),
        ["mod-water-mirror"] = new("#0b1030", "#312e81", "#818cf8"),
        ["mod-cube-spin"] = new("#4f46e5", "#7c3aed", "#db2777"),
        ["mod-liquid-blob"] = new("#10b981", "#047857", "#06b6d4"),
        ["mod-anaglyph"] = new("#09090b", "#27272a", "#ff0055"),
        ["mod-sonar"] = new("#0c192c", "#1e3a8a", "#3b82f6"),
        ["mod-spotlight"] = new("#050505", "#1f1f1f", "#3b82f6"),
        ["mod-maglev"] = new("#18181b", "#f43f5e", "#38bdf8"),
        ["txt-cyber-slice"] = new("#090a0f", "#1e293b", "#00f0ff"),
        ["txt-inferno"] = new("#0a0200", "#450a0a", "#ff8000"),
        ["txt-char-wave"] = new("#111827", "#374151", "#38bdf8"),
        ["txt-marquee"] = new("#090d16", "#eab308", "#facc15"),
        ["txt-vegas-neon"] = new("#0d0414", "#4a044e", "#d946ef"),
        ["txt-matrix"] = new("#000a00", "#00ff41", "#00ff41"),
        ["txt-ghost-smoke"] = new("#0f172a", "#1e293b", "#f1f5f9"),
        ["txt-slingshot"] = new("#1e1b4b", "#4338ca", "#f43f5e"),
        ["txt-3d-roller"] = new("#18181b", "#3f3f46", "#a855f7"),
        ["txt-xray"] = new("#090d16", "#1e293b", "#00ffcc"),
    };

    static readonly Dictionary<string, CardModelPalette> LegacySuffix = new(StringComparer.OrdinalIgnoreCase)
    {
        ["amber"] = new("#ff9d00", "#ffd166", "#fff0b3"),
        ["darkgray"] = new("#18181b", "#10b981", "#4ade80"),
        ["red"] = new("#b91c1c", "#fecaca", "#fde047"),
    };

    public static CardModelPalette? ForEffect(string? effect)
    {
        var id = (effect ?? "").Trim();
        if (id.Length == 0) return null;
        var legacy = System.Text.RegularExpressions.Regex.Match(id, @"^(v\d+)-(amber|darkgray|red)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (legacy.Success && LegacySuffix.TryGetValue(legacy.Groups[2].Value, out var suffix))
            return suffix;
        return ByEffect.TryGetValue(id, out var palette) ? palette : null;
    }
}
