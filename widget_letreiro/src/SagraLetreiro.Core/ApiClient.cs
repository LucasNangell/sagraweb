using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace SagraLetreiro;

public sealed class LetreiroApiException : Exception
{
    public int? StatusCode { get; }
    public LetreiroApiException(string message, int? statusCode = null) : base(message) => StatusCode = statusCode;
}

public sealed class LetreiroApiClient : IDisposable
{
    readonly HttpClient _http;
    readonly CookieContainer _cookies = new();
    string _baseUrl;
    bool _sslVerify;

    public bool LoggedIn { get; private set; }

    public LetreiroApiClient(string baseUrl, bool sslVerify = false, TimeSpan? timeout = null)
    {
        _baseUrl = (baseUrl ?? "").TrimEnd('/');
        _sslVerify = sslVerify;
        var handler = new HttpClientHandler
        {
            CookieContainer = _cookies,
            UseCookies = true,
        };
        if (!sslVerify)
            handler.ServerCertificateCustomValidationCallback = static (_, _, _, _) => true;
        _http = new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(20) };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");
        _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "SAGRA-Letreiro/2.0");
    }

    public void Configure(string baseUrl, bool sslVerify)
    {
        var next = (baseUrl ?? "").TrimEnd('/');
        if (next != _baseUrl || sslVerify != _sslVerify) LoggedIn = false;
        _baseUrl = next;
        _sslVerify = sslVerify;
    }

    string Url(string path) => _baseUrl + (path.StartsWith('/') ? path : "/" + path);

    async Task<JsonElement> RequestAsync(HttpMethod method, string path, object? body = null, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(method, Url(path));
        if (path.StartsWith("/letreiro/", StringComparison.OrdinalIgnoreCase))
            req.Headers.TryAddWithoutValidation("X-Letreiro-Windows-User", LetreiroAdmin.CurrentWindowsUser());
        if (body is not null) req.Content = JsonContent.Create(body);
        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            throw new LetreiroApiException($"Falha de rede: {ex.Message}");
        }

        var code = (int)response.StatusCode;
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (code is 401 or 403)
        {
            LoggedIn = false;
            throw new LetreiroApiException(ExtractDetail(text) ?? "Sessão ausente ou inválida.", code);
        }
        if (code >= 400)
            throw new LetreiroApiException($"HTTP {code}: {ExtractDetail(text)}", code);
        if (string.IsNullOrWhiteSpace(text)) return default;
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new LetreiroApiException("Resposta inválida da API.");
        }
    }

    public readonly record struct ForwardedResponse(int StatusCode, string ContentType, byte[] Body);

    public async Task<ForwardedResponse> ForwardAsync(
        HttpMethod method,
        string pathAndQuery,
        byte[]? body = null,
        string? contentType = null,
        CancellationToken ct = default)
    {
        var path = pathAndQuery ?? "";
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            path = path[4..];
        if (!path.StartsWith("/letreiro", StringComparison.OrdinalIgnoreCase))
        {
            return new ForwardedResponse(
                404,
                "application/json; charset=utf-8",
                """{"detail":"not found"}"""u8.ToArray());
        }

        using var req = new HttpRequestMessage(method, Url(path));
        req.Headers.TryAddWithoutValidation("X-Letreiro-Windows-User", LetreiroAdmin.CurrentWindowsUser());
        if (body is { Length: > 0 })
        {
            req.Content = new ByteArrayContent(body);
            req.Content.Headers.TryAddWithoutValidation(
                "Content-Type",
                string.IsNullOrWhiteSpace(contentType) ? "application/json" : contentType);
        }

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            var detail = JsonSerializer.Serialize(new { detail = $"Falha de rede: {ex.Message}" });
            return new ForwardedResponse(502, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(detail));
        }

        using (response)
        {
            var bytes = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            var type = response.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";
            var code = (int)response.StatusCode;
            if (code is 401 or 403) LoggedIn = false;
            return new ForwardedResponse(code, type, bytes);
        }
    }

    public async Task LoginAsync(string ponto, string nome = "", string password = "", CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ponto)) return;
        var body = new Dictionary<string, string?>
        {
            ["ponto"] = ponto,
            ["nome"] = string.IsNullOrWhiteSpace(nome) ? null : nome,
        };
        if (!string.IsNullOrEmpty(password)) body["password"] = password;
        await RequestAsync(HttpMethod.Post, "/auth/session", body, ct).ConfigureAwait(false);
        LoggedIn = true;
    }

    public async Task<List<string>> FetchSetoresAsync(CancellationToken ct = default)
    {
        var rows = await RequestAsync(HttpMethod.Get, "/aux/setores", ct: ct).ConfigureAwait(false);
        var values = new List<string>();
        if (rows.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in rows.EnumerateArray())
            {
                if (row.ValueKind == JsonValueKind.Object &&
                    row.TryGetProperty("Setor", out var setor))
                {
                    var value = setor.GetString()?.Trim();
                    if (!string.IsNullOrEmpty(value)) values.Add(value);
                }
            }
        }
        if (!values.Contains("Gravação")) values.Add("Gravação");
        return values.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(s => s, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    public async Task<List<string>> FetchAndamentosAsync(CancellationToken ct = default)
    {
        JsonElement rows;
        try
        {
            rows = await RequestAsync(HttpMethod.Get, "/aux/andamentos", ct: ct).ConfigureAwait(false);
        }
        catch (LetreiroApiException)
        {
            rows = await RequestAsync(HttpMethod.Get, "/aux/situacoes", ct: ct).ConfigureAwait(false);
        }
        var values = new List<string>();
        if (rows.ValueKind != JsonValueKind.Array) return values;
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object && row.TryGetProperty("Situacao", out var sit))
            {
                var value = sit.GetString()?.Trim();
                if (!string.IsNullOrEmpty(value)) values.Add(value);
            }
        }
        return values;
    }

    public async Task<List<InboxRef>> FetchInboxOsAsync(CancellationToken ct = default)
    {
        var rows = await RequestAsync(HttpMethod.Get, "/email/inbox-os", ct: ct).ConfigureAwait(false);
        var list = new List<InboxRef>();
        if (rows.ValueKind != JsonValueKind.Array) return list;
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            list.Add(new InboxRef
            {
                Os = GetInt(row, "os"),
                Ano = GetInt(row, "ano"),
                Date = GetString(row, "date"),
            });
        }
        return list;
    }

    public async Task<List<OsItem>> FetchDashboardAsync(BoardConfig board, CancellationToken ct = default)
    {
        var sectors = Board.CollectDashboardSectors(board);
        if (sectors.Count == 0) return new();
        var lists = new List<List<OsItem>>();
        foreach (var sector in sectors)
        {
            var search = await FetchSearchAsync(sector, ct).ConfigureAwait(false);
            try
            {
                var pcp = await FetchPcpAsync(sector, ct).ConfigureAwait(false);
                lists.Add(Board.MergeDashboardQueueSources(search, pcp));
            }
            catch (LetreiroApiException)
            {
                lists.Add(search);
            }
        }
        return Board.MergeDashboardSectorItemLists(lists);
    }

    public async Task<OsDetails> FetchOsDetailsAsync(int ano, int id, CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, $"/os/{ano}/{id}/details", ct: ct).ConfigureAwait(false);
        if (row.ValueKind != JsonValueKind.Object)
            throw new LetreiroApiException("Resposta inválida da API.");
        return MapDetails(row);
    }

    public async Task<string> FetchOsPathAsync(int ano, int id, CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, $"/os/{ano}/{id}/path", ct: ct).ConfigureAwait(false);
        if (row.ValueKind == JsonValueKind.Object)
            return GetString(row, "path") ?? "";
        return row.ValueKind == JsonValueKind.String ? row.GetString() ?? "" : "";
    }

    async Task<List<OsItem>> FetchSearchAsync(string sector, CancellationToken ct)
    {
        var isGravacao = sector == "Gravação";
        var qs = Query(
            ("setor", isGravacao ? "SEFOC" : sector),
            ("include_finished", "false"),
            ("limit", "200"),
            ("painel", "1"));
        var result = await RequestAsync(HttpMethod.Get, "/os/search?" + qs, ct: ct).ConfigureAwait(false);
        var data = result.ValueKind == JsonValueKind.Object && result.TryGetProperty("data", out var d)
            ? d
            : default;
        var list = new List<OsItem>();
        if (data.ValueKind != JsonValueKind.Array) return list;
        foreach (var row in data.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            var item = MapSearchRow(row);
            if (isGravacao && !BoardConstants.GravacaoSituacoes.Contains(item.Situacao ?? ""))
                continue;
            list.Add(item);
        }
        return list;
    }

    async Task<List<OsItem>> FetchPcpAsync(string sector, CancellationToken ct)
    {
        var qs = Query(("setor", sector), ("painel", "1"));
        var result = await RequestAsync(HttpMethod.Get, "/pcp/queue?" + qs, ct: ct).ConfigureAwait(false);
        var items = result.ValueKind == JsonValueKind.Object && result.TryGetProperty("items", out var i)
            ? i
            : default;
        var list = new List<OsItem>();
        if (items.ValueKind != JsonValueKind.Array) return list;
        foreach (var row in items.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            list.Add(MapSearchRow(row));
        }
        return list;
    }

    static OsItem MapSearchRow(JsonElement row) => new()
    {
        NrOs = GetObject(row, "nr_os"),
        Ano = GetObject(row, "ano"),
        Titulo = GetString(row, "titulo"),
        Produto = GetString(row, "produto"),
        Solicitante = GetString(row, "solicitante"),
        Situacao = GetString(row, "situacao"),
        Setor = GetString(row, "setor"),
        DataEntrega = GetString(row, "data_entrega"),
        EntregPeriodo = GetString(row, "entreg_periodo"),
        Prioridade = GetString(row, "prioridade"),
        LastUpdate = GetString(row, "last_update"),
        AndamentoUsuario = GetString(row, "andamento_usuario"),
        AndamentoPonto = GetString(row, "andamento_ponto"),
        Observacao = GetString(row, "observacao"),
        PcpOrdem = GetObject(row, "pcp_ordem"),
        PcpUltimaAtualizacao = GetString(row, "pcp_ultima_atualizacao"),
        FornecedorPonto = GetString(row, "fornecedor_ponto"),
        FornecedorNome = GetString(row, "fornecedor_nome"),
        RowKind = GetString(row, "row_kind"),
        SubOsId = GetObject(row, "sub_os_id"),
        ComponenteNome = GetString(row, "componente_nome"),
        ParentNrOs = GetObject(row, "parent_nr_os"),
        ParentAno = GetObject(row, "parent_ano"),
    };

    static OsDetails MapDetails(JsonElement row) => new()
    {
        MaquinaLink = GetString(row, "MaquinaLink") ?? GetString(row, "maquinaLink"),
        Tiragem = GetObject(row, "Tiragem") ?? GetObject(row, "tiragem"),
        Pags = GetObject(row, "Pags") ?? GetObject(row, "pags"),
        ModelosArq = GetObject(row, "ModelosArq") ?? GetObject(row, "modelosArq"),
        FrenteVerso = GetObject(row, "FrenteVerso") ?? GetObject(row, "frenteVerso"),
        FormatoLink = GetString(row, "FormatoLink") ?? GetString(row, "formatoLink"),
        EntregPrazoLink = GetString(row, "EntregPrazoLink") ?? GetString(row, "entregPrazoLink"),
        EntregData = GetString(row, "EntregData") ?? GetString(row, "entregData"),
        EntregPeriodo = GetString(row, "EntregPeriodo") ?? GetString(row, "entregPeriodo"),
        ContatoTrab = GetString(row, "ContatoTrab") ?? GetString(row, "contatoTrab"),
        PapelLink = GetString(row, "PapelLink") ?? GetString(row, "papelLink"),
        PapelDescricao = GetString(row, "PapelDescricao") ?? GetString(row, "papelDescricao"),
        Cores = GetString(row, "Cores") ?? GetString(row, "cores"),
        CoresDescricao = GetString(row, "CoresDescricao") ?? GetString(row, "coresDescricao"),
        DescAcabamento = GetString(row, "DescAcabamento") ?? GetString(row, "descAcabamento"),
        Observ = GetString(row, "Observ") ?? GetString(row, "observ"),
    };

    static string Query(params (string, string)[] pairs) =>
        string.Join("&", pairs.Select(p => $"{Uri.EscapeDataString(p.Item1)}={Uri.EscapeDataString(p.Item2)}"));

    static string? ExtractDetail(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("detail", out var detail))
                return detail.ValueKind == JsonValueKind.String ? detail.GetString() : detail.ToString();
        }
        catch (JsonException)
        {
        }
        return text.Length > 300 ? text[..300] : text;
    }

    static string? GetString(JsonElement row, string name) =>
        row.TryGetProperty(name, out var el) && el.ValueKind != JsonValueKind.Null ? el.ToString() : null;

    static int GetInt(JsonElement row, string name) =>
        row.TryGetProperty(name, out var el) && el.TryGetInt32(out var n) ? n : 0;

    static object? GetObject(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el) || el.ValueKind == JsonValueKind.Null) return null;
        return el.ValueKind switch
        {
            JsonValueKind.Number when el.TryGetInt32(out var n) => n,
            JsonValueKind.Number when el.TryGetInt64(out var l) => l,
            JsonValueKind.String => el.GetString(),
            _ => el.ToString(),
        };
    }

    public async Task HeartbeatAsync(string host, string windowsUser, string version, string ponto, CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Post, "/letreiro/heartbeat", new
        {
            hostName = host,
            windowsUser,
            version,
            ponto,
        }, ct).ConfigureAwait(false);
    }

    public async Task<AppConfig?> FetchLetreiroConfigAsync(string host, string windowsUser, CancellationToken ct = default)
    {
        var qs = Query(("host", host), ("user", windowsUser));
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/config?" + qs, ct: ct).ConfigureAwait(false);
        if (row.ValueKind != JsonValueKind.Object) return null;
        if (!row.TryGetProperty("payload", out var payload) || payload.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        return ConfigStore.TryParseElement(payload);
    }

    public async Task<List<LetreiroInstance>> FetchLetreiroInstancesAsync(CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/instances", ct: ct).ConfigureAwait(false);
        var list = new List<LetreiroInstance>();
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty("instances", out var items)
            || items.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            DateTime? seen = null;
            if (item.TryGetProperty("lastSeen", out var last) && last.ValueKind == JsonValueKind.String
                && DateTime.TryParse(last.GetString(), out var parsed))
                seen = parsed;
            list.Add(new LetreiroInstance
            {
                HostName = GetString(item, "hostName") ?? "",
                WindowsUser = GetString(item, "windowsUser") ?? "",
                Nome = GetString(item, "nome") ?? "",
                Setor = GetString(item, "setor") ?? "",
                Version = GetString(item, "version") ?? "",
                Ponto = GetString(item, "ponto") ?? "",
                LastSeen = seen,
                Online = item.TryGetProperty("online", out var on) && on.ValueKind == JsonValueKind.True,
                HasConfig = item.TryGetProperty("hasConfig", out var hc) && hc.ValueKind == JsonValueKind.True,
            });
        }
        return list;
    }

    public async Task PutLetreiroConfigAsync(
        AppConfig payload,
        string? hostName,
        string? targetUser,
        bool applyToAll,
        CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Put, "/letreiro/config", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            hostName,
            targetUser,
            applyToAll,
            payload = ConfigStore.ForRemote(payload),
        }, ct).ConfigureAwait(false);
    }

    public async Task PutLetreiroInstanceProfileAsync(
        string hostName,
        string targetUser,
        string nome,
        string setor,
        CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Put, "/letreiro/instances", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            hostName,
            targetUser,
            nome,
            setor,
        }, ct).ConfigureAwait(false);
    }

    public async Task<List<LetreiroCommand>> FetchLetreiroCommandsAsync(CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/commands", ct: ct).ConfigureAwait(false);
        var list = new List<LetreiroCommand>();
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty("commands", out var items)
            || items.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var item in items.EnumerateArray())
        {
            var cmd = MapCommand(item);
            if (cmd is not null) list.Add(cmd);
        }
        return list;
    }

    public async Task<int> CreateLetreiroCommandAsync(LetreiroCommand command, CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Post, "/letreiro/commands", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            name = command.Name,
            kind = command.Kind,
            content = command.Content,
            timeoutSec = command.TimeoutSec,
        }, ct).ConfigureAwait(false);
        return GetInt(row, "id");
    }

    public async Task UpdateLetreiroCommandAsync(LetreiroCommand command, CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Put, $"/letreiro/commands/{command.Id}", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            name = command.Name,
            kind = command.Kind,
            content = command.Content,
            timeoutSec = command.TimeoutSec,
        }, ct).ConfigureAwait(false);
    }

    public async Task DeleteLetreiroCommandAsync(int commandId, CancellationToken ct = default)
    {
        var qs = Query(("windowsUser", LetreiroAdmin.CurrentWindowsUser()));
        await RequestAsync(HttpMethod.Delete, $"/letreiro/commands/{commandId}?{qs}", ct: ct).ConfigureAwait(false);
    }

    public async Task<int> RunLetreiroCommandAsync(
        int commandId,
        IEnumerable<LetreiroJobTarget> targets,
        bool allOnline,
        CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Post, $"/letreiro/commands/{commandId}/run", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            allOnline,
            targets = targets.Select(t => new { hostName = t.HostName, windowsUser = t.WindowsUser }).ToList(),
        }, ct).ConfigureAwait(false);
        return GetInt(row, "queued");
    }

    public async Task<int> RunLetreiroAdhocAsync(
        string kind,
        string content,
        string name,
        IEnumerable<LetreiroJobTarget> targets,
        bool allOnline,
        int timeoutSec = 60,
        CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Post, "/letreiro/jobs/run", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            allOnline,
            name,
            kind,
            content,
            timeoutSec,
            targets = targets.Select(t => new { hostName = t.HostName, windowsUser = t.WindowsUser }).ToList(),
        }, ct).ConfigureAwait(false);
        return GetInt(row, "queued");
    }

    public async Task<int> FetchLetreiroCommandPollIntervalAsync(CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/settings", ct: ct).ConfigureAwait(false);
        return LetreiroCommandPoll.Clamp(GetInt(row, "commandPollIntervalSec"));
    }

    public async Task PutLetreiroCommandPollIntervalAsync(int seconds, CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Put, "/letreiro/settings", new
        {
            windowsUser = LetreiroAdmin.CurrentWindowsUser(),
            commandPollIntervalSec = LetreiroCommandPoll.Clamp(seconds),
        }, ct).ConfigureAwait(false);
    }

    public async Task<(LetreiroJob? Job, int PollIntervalSec)> FetchPendingLetreiroJobAsync(
        string host, string windowsUser, CancellationToken ct = default)
    {
        var qs = Query(("host", host), ("user", windowsUser));
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/jobs/pending?" + qs, ct: ct).ConfigureAwait(false);
        var interval = LetreiroCommandPoll.DefaultSec;
        if (row.ValueKind == JsonValueKind.Object)
            interval = LetreiroCommandPoll.Clamp(GetInt(row, "pollIntervalSec"));
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty("job", out var job)
            || job.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined or JsonValueKind.False)
            return (null, interval);
        return (MapJob(job, includeContent: true), interval);
    }

    public async Task PostLetreiroJobResultAsync(
        int jobId,
        string host,
        string windowsUser,
        RemoteScriptOutcome outcome,
        CancellationToken ct = default)
    {
        await RequestAsync(HttpMethod.Post, $"/letreiro/jobs/{jobId}/result", new
        {
            hostName = host,
            windowsUser,
            exitCode = outcome.ExitCode,
            stdout = outcome.Stdout,
            stderr = outcome.Stderr,
            timedOut = outcome.TimedOut,
        }, ct).ConfigureAwait(false);
    }

    public async Task<List<LetreiroJob>> FetchLetreiroJobsAsync(CancellationToken ct = default)
    {
        var row = await RequestAsync(HttpMethod.Get, "/letreiro/jobs", ct: ct).ConfigureAwait(false);
        var list = new List<LetreiroJob>();
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty("jobs", out var items)
            || items.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var item in items.EnumerateArray())
        {
            var job = MapJob(item, includeContent: false);
            if (job is not null) list.Add(job);
        }
        return list;
    }

    static LetreiroCommand? MapCommand(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object) return null;
        return new LetreiroCommand
        {
            Id = GetInt(item, "id"),
            Name = GetString(item, "name") ?? "",
            Kind = GetString(item, "kind") ?? "bat",
            Content = GetString(item, "content") ?? "",
            TimeoutSec = GetInt(item, "timeoutSec") > 0 ? GetInt(item, "timeoutSec") : 60,
        };
    }

    static LetreiroJob? MapJob(JsonElement item, bool includeContent)
    {
        if (item.ValueKind != JsonValueKind.Object) return null;
        return new LetreiroJob
        {
            Id = GetInt(item, "id"),
            CommandId = GetNullableInt(item, "commandId"),
            Name = GetString(item, "name") ?? "",
            Kind = GetString(item, "kind") ?? "",
            Content = includeContent ? GetString(item, "content") ?? "" : "",
            TimeoutSec = GetInt(item, "timeoutSec") > 0 ? GetInt(item, "timeoutSec") : 60,
            HostName = GetString(item, "hostName") ?? "",
            WindowsUser = GetString(item, "windowsUser") ?? "",
            Status = GetString(item, "status") ?? "",
            ExitCode = GetNullableInt(item, "exitCode"),
            Stdout = GetString(item, "stdout") ?? "",
            Stderr = GetString(item, "stderr") ?? "",
            CreatedAt = GetDate(item, "createdAt"),
            StartedAt = GetDate(item, "startedAt"),
            FinishedAt = GetDate(item, "finishedAt"),
        };
    }

    static int? GetNullableInt(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el) || el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (el.TryGetInt32(out var n)) return n;
        return int.TryParse(el.ToString(), out var parsed) ? parsed : null;
    }

    static DateTime? GetDate(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el) || el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (el.ValueKind == JsonValueKind.String && DateTime.TryParse(el.GetString(), out var parsed))
            return parsed;
        return DateTime.TryParse(el.ToString(), out var fallback) ? fallback : null;
    }

    public void Dispose() => _http.Dispose();
}
