using System.Globalization;
using System.Text.RegularExpressions;

namespace SagraLetreiro;

public static class OsDisplay
{
    static readonly Regex CivilDate = new(@"^(\d{4})-(\d{2})-(\d{2})", RegexOptions.CultureInvariant);

    public static string Text(object? value)
    {
        if (value is null) return "";
        var text = Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? "";
        return text;
    }

    public static string JoinLines(params string?[] parts) =>
        string.Join("\n", parts.Select(Text).Where(s => s.Length > 0));

    public static string DateBr(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var text = value.Trim();
        var match = CivilDate.Match(text);
        if (match.Success)
            return $"{match.Groups[3].Value}/{match.Groups[2].Value}/{match.Groups[1].Value}";
        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ||
            DateTime.TryParse(text, new CultureInfo("pt-BR"), DateTimeStyles.None, out dt))
            return dt.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return text;
    }

    public static bool ToCheck(object? value)
    {
        if (value is bool b) return b;
        if (value is int i) return i == 1;
        if (value is long l) return l == 1;
        var text = Text(value).ToLowerInvariant();
        return text is "1" or "true" or "sim" or "s";
    }
}

public static class OsFolderPath
{
    public static bool IsUsable(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var lower = path.Trim().ToLowerInvariant();
        if (lower.StartsWith("erro", StringComparison.Ordinal)) return false;
        if (lower.Contains("não encontrada", StringComparison.Ordinal) ||
            lower.Contains("nao encontrada", StringComparison.Ordinal))
            return false;
        return true;
    }
}
