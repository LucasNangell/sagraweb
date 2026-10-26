using System.IO;

namespace SagraLetreiro;

internal static class AppLog
{
    static readonly object Gate = new();
    static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SagraLetreiro",
        "letreiro.log");

    public static void Info(string message) => Write("INFO", message, null);

    public static void Warn(string message) => Write("WARN", message, null);

    public static void Error(string message, Exception? ex = null) => Write("ERROR", message, ex);

    static void Write(string level, string message, Exception? ex)
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {message}";
            if (ex is not null) line += Environment.NewLine + ex;
            lock (Gate)
            {
                File.AppendAllText(FilePath, line + Environment.NewLine);
            }
        }
        catch
        {
            // logging não pode derrubar o letreiro
        }
    }
}
