using System.Text.Json;
using System.Text.Json.Serialization;

namespace SagraLetreiro;

public sealed class ConfigProfile
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public AppConfig Payload { get; set; } = new();
}

public static class ConfigProfiles
{
    public const int MaxNameLength = 80;
    public const int MaxCount = 40;

    static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string ProfilesPath => Path.Combine(ConfigStore.ConfigDirectory, "profiles.json");

    public static string ClampName(string? value)
    {
        var name = (value ?? "").Trim();
        if (name.Length > MaxNameLength) name = name[..MaxNameLength].Trim();
        return name;
    }

    public static AppConfig Snapshot(AppConfig? config)
    {
        var remote = ConfigStore.ForRemote(config ?? new AppConfig());
        return new AppConfig
        {
            Window = remote.Window,
            Board = remote.Board,
        };
    }

    public static AppConfig Apply(AppConfig? target, AppConfig? profile)
    {
        var local = ConfigStore.Normalize(target);
        var snap = Snapshot(profile);
        var x = local.Window.X;
        local.Window = snap.Window;
        local.Window.X = x;
        local.Board = snap.Board;
        local.Window.NotificationsEnabled = snap.Board.Columns.Any(col => col.Notify);
        return ConfigStore.Normalize(local);
    }

    public static List<ConfigProfile> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            var file = JsonSerializer.Deserialize<ProfileFile>(json, Json);
            return NormalizeAll(file?.Profiles);
        }
        catch
        {
            return [];
        }
    }

    public static string Serialize(IReadOnlyList<ConfigProfile> items) =>
        JsonSerializer.Serialize(new ProfileFile { Profiles = NormalizeAll(items) }, Json);

    public static List<ConfigProfile> Load() => LoadFrom(ProfilesPath);

    public static List<ConfigProfile> LoadFrom(string path)
    {
        try
        {
            if (File.Exists(path))
                return Parse(File.ReadAllText(path));
        }
        catch
        {
            /* arquivo ausente ou inválido: começa vazio */
        }
        return [];
    }

    public static void Save(IReadOnlyList<ConfigProfile> items) => SaveTo(ProfilesPath, items);

    public static void SaveTo(string path, IReadOnlyList<ConfigProfile> items)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ConfigStore.ConfigDirectory);
        File.WriteAllText(path, Serialize(items));
    }

    public static ConfigProfile Upsert(List<ConfigProfile> items, string? name, AppConfig? source, int? id = null)
    {
        ArgumentNullException.ThrowIfNull(items);
        var clamped = ClampName(name);
        if (clamped.Length == 0)
            throw new ArgumentException("Nome do perfil é obrigatório.", nameof(name));

        ConfigProfile? row = null;
        if (id is int known and > 0)
            row = items.FirstOrDefault(item => item.Id == known);
        row ??= items.FirstOrDefault(item =>
            string.Equals(item.Name, clamped, StringComparison.OrdinalIgnoreCase));
        if (row is null)
        {
            if (items.Count >= MaxCount)
                throw new InvalidOperationException($"Limite de {MaxCount} perfis.");
            row = new ConfigProfile { Id = NextId(items) };
            items.Add(row);
        }

        row.Name = clamped;
        row.Payload = Snapshot(source);
        return row;
    }

    public static bool Remove(List<ConfigProfile> items, int id) =>
        items.RemoveAll(item => item.Id == id) > 0;

    static int NextId(IReadOnlyList<ConfigProfile> items) =>
        items.Count == 0 ? 1 : items.Max(item => item.Id) + 1;

    static List<ConfigProfile> NormalizeAll(IEnumerable<ConfigProfile>? items)
    {
        var seen = new HashSet<int>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<ConfigProfile>();
        foreach (var raw in items ?? [])
        {
            var name = ClampName(raw.Name);
            if (name.Length == 0 || !names.Add(name)) continue;
            var id = raw.Id > 0 && seen.Add(raw.Id) ? raw.Id : 0;
            list.Add(new ConfigProfile
            {
                Id = id,
                Name = name,
                Payload = Snapshot(raw.Payload),
            });
        }
        var next = 1;
        foreach (var item in list)
        {
            if (item.Id > 0) continue;
            while (seen.Contains(next)) next++;
            item.Id = next;
            seen.Add(next);
            next++;
        }
        list.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        return list;
    }

    sealed class ProfileFile
    {
        public List<ConfigProfile> Profiles { get; set; } = [];
    }
}
