namespace SagraLetreiro;

public static class LetreiroAdmin
{
    public const string AllowedSam = "P_918713";

    public static string NormalizeSam(string? value)
    {
        var raw = (value ?? "").Trim();
        var slash = raw.LastIndexOfAny(['\\', '/']);
        return slash >= 0 ? raw[(slash + 1)..].Trim() : raw;
    }

    public static bool Matches(string? value) =>
        NormalizeSam(value).Equals(AllowedSam, StringComparison.OrdinalIgnoreCase);

    public static bool IsAdmin(string? userName = null, string? domainUser = null)
    {
        userName ??= Environment.UserName;
        var domain = Environment.UserDomainName;
        domainUser ??= string.IsNullOrWhiteSpace(domain) ? userName : $"{domain}\\{userName}";
        return Matches(userName) || Matches(domainUser);
    }

    public static string CurrentWindowsUser()
    {
        var domain = Environment.UserDomainName;
        var user = Environment.UserName ?? "";
        return string.IsNullOrWhiteSpace(domain) ? user : $"{domain}\\{user}";
    }

    public static string CurrentHost() => Environment.MachineName ?? "";
}
