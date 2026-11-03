using System.Windows.Media;

namespace SagraLetreiro;

/// <summary>Toca MP3 local via MediaPlayer; falhas são silenciosas.</summary>
internal static class ArrivalSoundPlayer
{
    static MediaPlayer? _player;

    public static void PlayFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return;
        try
        {
            _player?.Stop();
            _player?.Close();
            var player = new MediaPlayer();
            player.MediaEnded += (_, _) =>
            {
                try { player.Close(); } catch { /* ignore */ }
                if (ReferenceEquals(_player, player)) _player = null;
            };
            player.MediaFailed += (_, _) =>
            {
                try { player.Close(); } catch { /* ignore */ }
                if (ReferenceEquals(_player, player)) _player = null;
            };
            _player = player;
            player.Open(new Uri(path, UriKind.Absolute));
            player.Volume = 1.0;
            player.Play();
        }
        catch
        {
            /* toast segue sem áudio */
        }
    }

    public static async Task PlayResolvedAsync(LetreiroApiClient client, string? resolvedId)
    {
        if (!ArrivalSound.IsPlayableId(resolvedId)) return;
        string? path = null;
        try
        {
            path = await SoundCache.EnsureAsync(client, resolvedId!).ConfigureAwait(true);
        }
        catch
        {
            return;
        }
        PlayFile(path);
    }
}
