using System.Text.RegularExpressions;

namespace SagraLetreiro;

public static class UpdateFinder
{
    public static readonly Regex SetupName = new(
        @"^SAGRA-Letreiro-Setup-(\d+\.\d+(?:\.\d+){0,2})\.exe$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static Version Normalize(Version v) =>
        new(v.Major, v.Minor, Math.Max(v.Build, 0), Math.Max(v.Revision, 0));

    public static bool TryFindNewerSetup(IEnumerable<string?> directories, Version current, out string path)
    {
        path = "";
        foreach (var directory in directories)
        {
            if (string.IsNullOrWhiteSpace(directory)) continue;
            bool available;
            try
            {
                available = Directory.Exists(directory);
            }
            catch
            {
                continue;
            }
            if (!available) continue;
            return TryFindNewerSetup(directory, current, out path);
        }
        return false;
    }

    public static bool TryFindNewerSetup(string? directory, Version current, out string path)
    {
        path = "";
        try
        {
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
                return false;

            var floor = Normalize(current);
            string? bestPath = null;
            Version? best = null;

            foreach (var file in Directory.EnumerateFiles(directory, "SAGRA-Letreiro-Setup-*.exe"))
            {
                var match = SetupName.Match(Path.GetFileName(file));
                if (!match.Success || !Version.TryParse(match.Groups[1].Value, out var parsed))
                    continue;

                parsed = Normalize(parsed);
                if (parsed <= floor) continue;
                if (best is not null && parsed <= best) continue;
                best = parsed;
                bestPath = file;
            }

            if (bestPath is null) return false;
            path = bestPath;
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            path = "";
            return false;
        }
    }
}
