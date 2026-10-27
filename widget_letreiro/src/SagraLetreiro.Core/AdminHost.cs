using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SagraLetreiro;

public sealed class AdminHostOptions
{
    public required Func<LetreiroApiClient> Client { get; init; }
    public Func<AppConfig>? GetLocalConfig { get; init; }
    public Action<AppConfig, bool>? ApplyLocalConfig { get; init; }
    public bool IsAdmin { get; init; }
}

public sealed class AdminHost : IDisposable
{
    public const int PreferredPort = 17890;
    const int PortRange = 30;
    const int MaxProxyBody = 1024 * 1024;
    const string CookieName = "t";
    static readonly JsonSerializerOptions JsonCamel = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    readonly HttpListener _listener;
    readonly CancellationTokenSource _cts = new();
    readonly AdminHostOptions _options;
    readonly string _webRoot;
    readonly Task _loop;
    bool _disposed;

    public string Token { get; }
    public int Port { get; }
    public string Origin => $"http://127.0.0.1:{Port}";
    public string AdminUrl => $"{Origin}/?t={Uri.EscapeDataString(Token)}";

    AdminHost(HttpListener listener, int port, string token, string webRoot, AdminHostOptions options)
    {
        _listener = listener;
        Port = port;
        Token = token;
        _webRoot = webRoot;
        _options = options;
        _loop = Task.Run(() => ListenAsync(_cts.Token));
    }

    public static AdminHost Start(Func<LetreiroApiClient> client, string? webRoot = null) =>
        Start(new AdminHostOptions { Client = client }, webRoot);

    public static AdminHost Start(AdminHostOptions options, string? webRoot = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(options.Client);
        webRoot ??= ResolveWebRoot();
        if (!File.Exists(Path.Combine(webRoot, "index.html")))
            throw new InvalidOperationException($"Frontend de administração não encontrado em {webRoot}.");

        Exception? last = null;
        for (var port = PreferredPort; port < PreferredPort + PortRange; port++)
        {
            var listener = new HttpListener { IgnoreWriteExceptions = true };
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            try
            {
                listener.Start();
                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                return new AdminHost(listener, port, token, webRoot, options);
            }
            catch (Exception ex)
            {
                last = ex;
                try { listener.Close(); } catch { /* ignore */ }
            }
        }

        throw new InvalidOperationException(
            "Não foi possível abrir o servidor local de administração em 127.0.0.1.", last);
    }

    public void OpenBrowser(string? hash = null)
    {
        var url = AdminUrl;
        if (!string.IsNullOrWhiteSpace(hash))
            url += hash.StartsWith('#') ? hash : "#" + hash;
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        });
    }

    public static string ResolveWebRoot()
    {
        var dirs = new List<string>();
        var processDir = Path.GetDirectoryName(Environment.ProcessPath);
        if (!string.IsNullOrWhiteSpace(processDir))
            dirs.Add(Path.Combine(processDir, "admin-web"));
        dirs.Add(Path.Combine(AppContext.BaseDirectory, "admin-web"));
        foreach (var dir in dirs.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (File.Exists(Path.Combine(dir, "index.html")))
                return Path.GetFullPath(dir);
        }
        return Path.GetFullPath(dirs[0]);
    }

    public static bool TryMapProxyPath(string? rawPathAndQuery, out string apiPath)
    {
        apiPath = "";
        if (string.IsNullOrWhiteSpace(rawPathAndQuery)) return false;
        var path = rawPathAndQuery.Trim();
        var q = path.IndexOf('?', StringComparison.Ordinal);
        var pathOnly = q >= 0 ? path[..q] : path;
        if (!pathOnly.StartsWith('/')) pathOnly = "/" + pathOnly;
        if (!pathOnly.Equals("/api/letreiro", StringComparison.OrdinalIgnoreCase)
            && !pathOnly.StartsWith("/api/letreiro/", StringComparison.OrdinalIgnoreCase))
            return false;
        var mapped = pathOnly[4..] + (q >= 0 ? path[q..] : "");
        apiPath = mapped;
        return true;
    }

    public static bool TryMapLocalPath(string? rawPathAndQuery, out string localPath)
    {
        localPath = "";
        if (string.IsNullOrWhiteSpace(rawPathAndQuery)) return false;
        var path = rawPathAndQuery.Trim();
        var q = path.IndexOf('?', StringComparison.Ordinal);
        var pathOnly = q >= 0 ? path[..q] : path;
        if (!pathOnly.StartsWith('/')) pathOnly = "/" + pathOnly;
        if (!pathOnly.Equals("/local", StringComparison.OrdinalIgnoreCase)
            && !pathOnly.StartsWith("/local/", StringComparison.OrdinalIgnoreCase))
            return false;
        localPath = pathOnly;
        return true;
    }

    public static string? ResolveStaticPath(string webRoot, string? requestPath)
    {
        if (string.IsNullOrWhiteSpace(webRoot)) return null;
        var root = Path.GetFullPath(webRoot);
        var relative = (requestPath ?? "/").Split('#', '?')[0];
        relative = Uri.UnescapeDataString(relative).Replace('\\', '/');
        if (string.IsNullOrWhiteSpace(relative) || relative == "/") relative = "/index.html";
        if (!relative.StartsWith('/')) relative = "/" + relative;
        if (relative.Contains("..", StringComparison.Ordinal) || relative.Contains(':', StringComparison.Ordinal))
            return null;

        var candidate = Path.GetFullPath(Path.Combine(root, relative.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
        if (!IsUnderRoot(root, candidate)) return null;
        if (File.Exists(candidate)) return candidate;

        var ext = Path.GetExtension(relative);
        if (!string.IsNullOrEmpty(ext) && !ext.Equals(".html", StringComparison.OrdinalIgnoreCase))
            return null;

        var index = Path.Combine(root, "index.html");
        return File.Exists(index) ? index : null;
    }

    static bool IsUnderRoot(string root, string candidate)
    {
        var relative = Path.GetRelativePath(root, candidate);
        return relative != ".."
            && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            && !Path.IsPathRooted(relative);
    }

    async Task HandleLocalAsync(HttpListenerContext ctx, HttpListenerRequest req, string localPath, CancellationToken ct)
    {
        if (localPath.Equals("/local/me", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "GET")
        {
            await WriteJsonAsync(ctx, 200, new { isAdmin = _options.IsAdmin }).ConfigureAwait(false);
            return;
        }

        if (localPath.Equals("/local/config", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "GET")
        {
            if (_options.GetLocalConfig is null)
            {
                await WriteTextAsync(ctx, 501, """{"detail":"config local indisponível"}""").ConfigureAwait(false);
                return;
            }
            await WriteTextAsync(ctx, 200, ConfigStore.Serialize(_options.GetLocalConfig())).ConfigureAwait(false);
            return;
        }

        if (localPath.Equals("/local/config", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "PUT")
        {
            var body = await ReadBodyAsync(req, ctx, ct).ConfigureAwait(false);
            if (body is null && req.HasEntityBody) return;
            var parsed = ConfigStore.TryParse(body is null ? null : Encoding.UTF8.GetString(body));
            if (parsed is null)
            {
                await WriteTextAsync(ctx, 400, """{"detail":"config inválida"}""").ConfigureAwait(false);
                return;
            }
            var previous = _options.GetLocalConfig?.Invoke() ?? parsed;
            parsed = ConfigStore.RestrictConnectionToPrevious(parsed, previous, _options.IsAdmin);
            var relogin = parsed.ApiBaseUrl != previous.ApiBaseUrl || parsed.Ponto != previous.Ponto
                || parsed.Password != previous.Password || parsed.SslVerify != previous.SslVerify;
            _options.ApplyLocalConfig?.Invoke(parsed, relogin);
            var saved = _options.GetLocalConfig?.Invoke() ?? parsed;
            await WriteTextAsync(ctx, 200, ConfigStore.Serialize(saved)).ConfigureAwait(false);
            return;
        }

        if (localPath.Equals("/local/restore-board", StringComparison.OrdinalIgnoreCase)
            && req.HttpMethod == "POST")
        {
            var current = ConfigStore.TryParse(ConfigStore.Serialize(_options.GetLocalConfig?.Invoke() ?? new AppConfig()))
                ?? new AppConfig();
            var restored = ConfigStore.RestoreDefaultBoard(current);
            _options.ApplyLocalConfig?.Invoke(restored, false);
            await WriteTextAsync(ctx, 200, ConfigStore.Serialize(restored)).ConfigureAwait(false);
            return;
        }

        if (localPath.Equals("/local/setores", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "GET")
        {
            var setores = new List<string> { "SEFOC", "Papelaria", "Gravação" };
            try
            {
                var fetched = await _options.Client().FetchSetoresAsync(ct).ConfigureAwait(false);
                if (fetched.Count > 0) setores = fetched;
            }
            catch
            {
                /* usa a lista padrão */
            }
            await WriteJsonAsync(ctx, 200, new { setores }).ConfigureAwait(false);
            return;
        }

        if (localPath.Equals("/local/situacoes", StringComparison.OrdinalIgnoreCase) && req.HttpMethod == "GET")
        {
            var situacoes = new List<string>();
            try
            {
                situacoes = await _options.Client().FetchAndamentosAsync(ct).ConfigureAwait(false);
            }
            catch
            {
                /* lista fica vazia; o SPA usa o conjunto padrão */
            }
            await WriteJsonAsync(ctx, 200, new { situacoes }).ConfigureAwait(false);
            return;
        }

        await WriteTextAsync(ctx, 404, """{"detail":"não encontrado"}""").ConfigureAwait(false);
    }

    async Task<byte[]?> ReadBodyAsync(HttpListenerRequest req, HttpListenerContext ctx, CancellationToken ct)
    {
        if (!req.HasEntityBody) return [];
        if (req.ContentLength64 > MaxProxyBody)
        {
            await WriteTextAsync(ctx, 413, """{"detail":"corpo grande demais"}""").ConfigureAwait(false);
            return null;
        }
        await using var ms = new MemoryStream();
        await req.InputStream.CopyToAsync(ms, ct).ConfigureAwait(false);
        if (ms.Length > MaxProxyBody)
        {
            await WriteTextAsync(ctx, 413, """{"detail":"corpo grande demais"}""").ConfigureAwait(false);
            return null;
        }
        return ms.ToArray();
    }

    static Task WriteJsonAsync<T>(HttpListenerContext ctx, int status, T value) =>
        WriteTextAsync(ctx, status, JsonSerializer.Serialize(value, JsonCamel));

    async Task ListenAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync().WaitAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (HttpListenerException)
            {
                break;
            }

            _ = Task.Run(() => HandleAsync(ctx, ct), ct);
        }
    }

    async Task HandleAsync(HttpListenerContext ctx, CancellationToken ct)
    {
        try
        {
            var req = ctx.Request;
            var host = (req.Headers["Host"] ?? "").Split(':')[0];
            if (!host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
                && !host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            {
                await WriteTextAsync(ctx, 403, """{"detail":"somente loopback"}""").ConfigureAwait(false);
                return;
            }

            if (!IsAuthorized(req))
            {
                await WriteTextAsync(ctx, 401, """{"detail":"token ausente ou inválido"}""").ConfigureAwait(false);
                return;
            }

            IssueCookie(ctx.Response);

            var raw = req.RawUrl ?? "/";
            if (TryMapProxyPath(raw, out var apiPath))
            {
                var body = await ReadBodyAsync(req, ctx, ct).ConfigureAwait(false);
                if (body is null && req.HasEntityBody) return;
                var forwarded = await _options.Client().ForwardAsync(
                    new HttpMethod(req.HttpMethod),
                    apiPath,
                    body,
                    req.ContentType,
                    ct).ConfigureAwait(false);
                ctx.Response.StatusCode = forwarded.StatusCode;
                ctx.Response.ContentType = forwarded.ContentType;
                ctx.Response.ContentLength64 = forwarded.Body.Length;
                if (forwarded.Body.Length > 0)
                    await ctx.Response.OutputStream.WriteAsync(forwarded.Body, ct).ConfigureAwait(false);
                ctx.Response.Close();
                return;
            }

            if (TryMapLocalPath(raw, out var localPath))
            {
                await HandleLocalAsync(ctx, req, localPath, ct).ConfigureAwait(false);
                return;
            }

            var abs = (req.Url?.AbsolutePath ?? "/").ToLowerInvariant();
            if (abs.StartsWith("/api", StringComparison.Ordinal) || abs.StartsWith("/local", StringComparison.Ordinal))
            {
                await WriteTextAsync(ctx, 404, """{"detail":"não encontrado"}""").ConfigureAwait(false);
                return;
            }

            var file = ResolveStaticPath(_webRoot, req.Url?.AbsolutePath ?? "/");
            if (file is null)
            {
                await WriteTextAsync(ctx, 404, """{"detail":"não encontrado"}""").ConfigureAwait(false);
                return;
            }

            var bytes = await File.ReadAllBytesAsync(file, ct).ConfigureAwait(false);
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = Mime(file);
            ctx.Response.ContentLength64 = bytes.Length;
            await ctx.Response.OutputStream.WriteAsync(bytes, ct).ConfigureAwait(false);
            ctx.Response.Close();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            try
            {
                await WriteTextAsync(ctx, 500, """{"detail":"falha no servidor local"}""").ConfigureAwait(false);
            }
            catch
            {
                /* ignore */
            }
        }
    }

    bool IsAuthorized(HttpListenerRequest req)
    {
        if (TokenEquals(req.Headers["X-Letreiro-Admin-Token"])) return true;
        var cookie = req.Cookies[CookieName]?.Value;
        if (TokenEquals(cookie)) return true;
        return TokenEquals(req.QueryString.Get(CookieName));
    }

    bool TokenEquals(string? value) =>
        !string.IsNullOrEmpty(value)
        && value.Length == Token.Length
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(value), Encoding.ASCII.GetBytes(Token));

    void IssueCookie(HttpListenerResponse response)
    {
        response.Headers.Add("Set-Cookie", $"{CookieName}={Token}; Path=/; HttpOnly; SameSite=Strict");
    }

    static async Task WriteTextAsync(HttpListenerContext ctx, int status, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = bytes.Length;
        await ctx.Response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        ctx.Response.Close();
    }

    static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".map" => "application/json",
        _ => "application/octet-stream",
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _cts.Cancel(); } catch { /* ignore */ }
        try { _listener.Stop(); } catch { /* ignore */ }
        try { _listener.Close(); } catch { /* ignore */ }
        try { _loop.Wait(TimeSpan.FromSeconds(2)); } catch { /* ignore */ }
        _cts.Dispose();
    }
}
