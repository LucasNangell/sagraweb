using System.Text.Json;
using System.Text.Json.Serialization;

namespace SagraLetreiro;

public sealed class ConfigProfileAssignment
{
    public string HostName { get; set; } = "";
    public string WindowsUser { get; set; } = "";
    public int ProfileId { get; set; }
    public string ProfileName { get; set; } = "";
}

public static class ConfigProfileAssignments
{
    static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string AssignmentsPath =>
        Path.Combine(ConfigStore.ConfigDirectory, "profile-assignments.json");

    public static string KeyOf(string? hostName, string? windowsUser) =>
        $"{(hostName ?? "").Trim().ToUpperInvariant()}|{(windowsUser ?? "").Trim().ToUpperInvariant()}";

    public static List<ConfigProfileAssignment> Load() => LoadFrom(AssignmentsPath);

    public static List<ConfigProfileAssignment> LoadFrom(string path)
    {
        try
        {
            if (File.Exists(path))
                return Parse(File.ReadAllText(path));
        }
        catch
        {
            /* arquivo ausente ou inválido */
        }
        return [];
    }

    public static void Save(IReadOnlyList<ConfigProfileAssignment> items) =>
        SaveTo(AssignmentsPath, items);

    public static void SaveTo(string path, IReadOnlyList<ConfigProfileAssignment> items)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ConfigStore.ConfigDirectory);
        File.WriteAllText(path, Serialize(items));
    }

    public static List<ConfigProfileAssignment> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            var file = JsonSerializer.Deserialize<AssignmentFile>(json, Json);
            return NormalizeAll(file?.Assignments);
        }
        catch
        {
            return [];
        }
    }

    public static string Serialize(IReadOnlyList<ConfigProfileAssignment> items) =>
        JsonSerializer.Serialize(new AssignmentFile { Assignments = NormalizeAll(items) }, Json);

    public static ConfigProfileAssignment? Find(
        IReadOnlyList<ConfigProfileAssignment> items,
        string? hostName,
        string? windowsUser)
    {
        var key = KeyOf(hostName, windowsUser);
        return items.FirstOrDefault(item => KeyOf(item.HostName, item.WindowsUser) == key);
    }

    public static List<ConfigProfileAssignment> Set(
        List<ConfigProfileAssignment> items,
        string? hostName,
        string? windowsUser,
        int profileId,
        string? profileName)
    {
        ArgumentNullException.ThrowIfNull(items);
        var host = (hostName ?? "").Trim();
        var user = (windowsUser ?? "").Trim();
        if (host.Length == 0 || user.Length == 0)
            throw new ArgumentException("hostName e windowsUser são obrigatórios.");

        items.RemoveAll(item => KeyOf(item.HostName, item.WindowsUser) == KeyOf(host, user));
        if (profileId <= 0)
            return NormalizeAll(items);

        items.Add(new ConfigProfileAssignment
        {
            HostName = host,
            WindowsUser = user,
            ProfileId = profileId,
            ProfileName = ConfigProfiles.ClampName(profileName),
        });
        return NormalizeAll(items);
    }

    public static List<ConfigProfileAssignment> ClearProfile(
        List<ConfigProfileAssignment> items,
        int profileId)
    {
        ArgumentNullException.ThrowIfNull(items);
        if (profileId <= 0) return NormalizeAll(items);
        items.RemoveAll(item => item.ProfileId == profileId);
        return NormalizeAll(items);
    }

    public static List<ConfigProfileAssignment> ResolveNames(
        IReadOnlyList<ConfigProfileAssignment> items,
        IReadOnlyList<ConfigProfile> profiles)
    {
        var byId = profiles.ToDictionary(item => item.Id);
        var list = new List<ConfigProfileAssignment>();
        foreach (var raw in NormalizeAll(items))
        {
            if (!byId.TryGetValue(raw.ProfileId, out var profile))
                continue;
            list.Add(new ConfigProfileAssignment
            {
                HostName = raw.HostName,
                WindowsUser = raw.WindowsUser,
                ProfileId = profile.Id,
                ProfileName = profile.Name,
            });
        }
        return list;
    }

    static List<ConfigProfileAssignment> NormalizeAll(IEnumerable<ConfigProfileAssignment>? items)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<ConfigProfileAssignment>();
        foreach (var raw in items ?? [])
        {
            var host = (raw.HostName ?? "").Trim();
            var user = (raw.WindowsUser ?? "").Trim();
            if (host.Length == 0 || user.Length == 0 || raw.ProfileId <= 0) continue;
            var key = KeyOf(host, user);
            if (!seen.Add(key)) continue;
            list.Add(new ConfigProfileAssignment
            {
                HostName = host,
                WindowsUser = user,
                ProfileId = raw.ProfileId,
                ProfileName = ConfigProfiles.ClampName(raw.ProfileName),
            });
        }
        list.Sort((a, b) =>
        {
            var host = string.Compare(a.HostName, b.HostName, StringComparison.OrdinalIgnoreCase);
            return host != 0
                ? host
                : string.Compare(a.WindowsUser, b.WindowsUser, StringComparison.OrdinalIgnoreCase);
        });
        return list;
    }

    sealed class AssignmentFile
    {
        public List<ConfigProfileAssignment> Assignments { get; set; } = [];
    }
}
