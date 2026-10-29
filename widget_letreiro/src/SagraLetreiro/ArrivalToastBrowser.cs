using System.IO;
using Microsoft.Web.WebView2.Core;

namespace SagraLetreiro;

static class ArrivalToastBrowser
{
    public const string Host = "sagra-toast.local";
    static readonly string UserData = Path.Combine(Path.GetTempPath(), "sagra-letreiro-wv2");
    static Task<CoreWebView2Environment>? _env;

    public static Task<CoreWebView2Environment> Prewarm()
    {
        if (_env is not null) return _env;
        try { Directory.CreateDirectory(UserData); }
        catch { /* pasta temporária já existe */ }
        _env = CoreWebView2Environment.CreateAsync(userDataFolder: UserData);
        return _env;
    }

    public static Task<CoreWebView2Environment> EnvironmentAsync() => Prewarm();

    public static void MapHost(CoreWebView2 core) =>
        core.SetVirtualHostNameToFolderMapping(
            Host, UserData, CoreWebView2HostResourceAccessKind.Allow);

    public static Uri WritePage(string html)
    {
        Directory.CreateDirectory(UserData);
        var path = Path.Combine(UserData, "index.html");
        File.WriteAllText(path, html);
        return new Uri($"https://{Host}/index.html?t={DateTime.UtcNow.Ticks}");
    }

    public static Uri WriteTickerPage(string html)
    {
        Directory.CreateDirectory(UserData);
        var path = Path.Combine(UserData, "ticker.html");
        File.WriteAllText(path, html);
        return new Uri($"https://{Host}/ticker.html?t={DateTime.UtcNow.Ticks}");
    }
}
