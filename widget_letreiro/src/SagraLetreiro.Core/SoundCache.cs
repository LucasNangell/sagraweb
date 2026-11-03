namespace SagraLetreiro;

public static class SoundCache
{
    public static string CacheDirectory =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SagraLetreiro",
            "sounds");

    public static string PathFor(string soundId)
    {
        var id = ArrivalSound.Clamp(soundId);
        if (!ArrivalSound.IsPlayableId(id))
            throw new ArgumentException("Id de som inválido.", nameof(soundId));
        return Path.Combine(CacheDirectory, id + ".mp3");
    }

    public static bool IsCached(string soundId, long? expectedSize = null)
    {
        if (!ArrivalSound.IsPlayableId(soundId)) return false;
        var path = PathFor(soundId);
        if (!File.Exists(path)) return false;
        if (expectedSize is long size && size > 0)
        {
            try { return new FileInfo(path).Length == size; }
            catch { return false; }
        }
        return true;
    }

    public static async Task<string?> EnsureAsync(
        LetreiroApiClient client,
        string soundId,
        CancellationToken ct = default)
    {
        var id = ArrivalSound.Clamp(soundId);
        if (!ArrivalSound.IsPlayableId(id)) return null;
        var path = PathFor(id);
        if (IsCached(id)) return path;
        try
        {
            Directory.CreateDirectory(CacheDirectory);
            var bytes = await client.DownloadSoundAsync(id, ct).ConfigureAwait(false);
            if (bytes is null || bytes.Length == 0) return null;
            var tmp = path + ".tmp";
            await File.WriteAllBytesAsync(tmp, bytes, ct).ConfigureAwait(false);
            File.Copy(tmp, path, overwrite: true);
            try { File.Delete(tmp); } catch { /* ignore */ }
            return path;
        }
        catch
        {
            return File.Exists(path) ? path : null;
        }
    }
}
