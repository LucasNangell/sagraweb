using System.Text.RegularExpressions;

namespace SagraLetreiro;

public static class ArrivalSound
{
    public const string None = "none";
    static readonly Regex IdRe = new("^[A-Za-z0-9_-]{4,64}$", RegexOptions.Compiled);

    /// <summary>Normaliza valor de config: "" / "none" / id seguro.</summary>
    public static string Clamp(string? value)
    {
        var raw = (value ?? "").Trim();
        if (raw.Length == 0) return "";
        if (string.Equals(raw, None, StringComparison.OrdinalIgnoreCase)) return None;
        return IdRe.IsMatch(raw) ? raw : "";
    }

    /// <summary>Override de filtro: "" = herdar; "none" = silêncio; id = esse som.</summary>
    public static string ClampColumn(string? value) => Clamp(value);

    /// <summary>Id efetivo a baixar/tocar, ou null se silêncio.</summary>
    public static string? Resolve(string? cardSound, string? windowSound)
    {
        var column = ClampColumn(cardSound);
        if (column == None) return null;
        if (column.Length > 0) return column;
        var global = Clamp(windowSound);
        if (global.Length == 0 || global == None) return null;
        return global;
    }

    public static bool IsPlayableId(string? value)
    {
        var id = Clamp(value);
        return id.Length > 0 && id != None;
    }
}
