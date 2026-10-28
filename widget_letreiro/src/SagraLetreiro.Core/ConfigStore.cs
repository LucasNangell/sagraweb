using System.Text.Json;
using System.Text.Json.Serialization;

namespace SagraLetreiro;

public static class ConfigStore
{
    public const string ProductionApiBase = "https://cgrafsysvm.redecamara.camara.gov.br/sagra/api";
    public const string DefaultPonto = "654321";
    public const string DefaultNome = "usr_sefoc";
    public const string DefaultUpdateSourceDirectory =
        @"G:\PC Reinstall\Lucas Santos - Modelo de Configs\Configs - Software\Custom Sys (na Unidade C)\SEFOC Tools";
    public const string FallbackUpdateSourceDirectory = @"I:\Transferencia\_TempSys";

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string ConfigDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SagraLetreiro");

    public static string ConfigPath => Path.Combine(ConfigDirectory, "config.json");

    public static BoardConfig DefaultBoard() => new()
    {
        Sector = "SEFOC",
        ColumnCount = 4,
        Columns =
        [
            new BoardColumn
            {
                Id = "col_0",
                Title = "p/ Triagem",
                Statuses =
                [
                    "Saída p/", "Saída parcial p/", "Entrada Inicial",
                    "Tramit. de Prova p/", "Tramit. de Prévia p/", "Comentário",
                ],
            },
            new BoardColumn
            {
                Id = "col_1",
                Title = "p/ Execução",
                Statuses = ["Em Execução", "Recebido"],
            },
            new BoardColumn
            {
                Id = "col_2",
                Title = "Prob. Téc.",
                Statuses = ["Problemas Técnicos", "Problema Técnico"],
                HideWhenEmpty = true,
            },
            new BoardColumn
            {
                Id = "col_3",
                Title = "enviar E-mail",
                Statuses = ["Encam. de Docum."],
            },
        ],
    };

    public static string NormalizeApiBaseUrl(string? raw)
    {
        var url = (raw ?? "").Trim().TrimEnd('/');
        if (url.Length == 0) return ProductionApiBase;
        if (url.EndsWith("/sagra", StringComparison.OrdinalIgnoreCase)) return url + "/api";
        return url;
    }

    public static BoardColumn NormalizeColumn(BoardColumn? col, int index)
    {
        col ??= new BoardColumn();
        var sector = (col.Sector ?? "").Trim();
        var ponto = (col.Ponto ?? "").Trim();
        var observacao = (col.Observacao ?? "").Trim();
        var animation = ArrivalNotify.ClampColumnAnimation(col.Animation);
        var isInbox = col.Source == BoardConstants.InboxColumnSource;
        var outCol = new BoardColumn
        {
            Id = string.IsNullOrWhiteSpace(col.Id) ? $"col_{index}" : col.Id,
            Title = string.IsNullOrWhiteSpace(col.Title) ? $"Coluna {index + 1}" : col.Title,
            Statuses = col.Statuses?.Where(s => s is not null).Select(s => s.Trim()).ToList() ?? new(),
            HideWhenEmpty = col.HideWhenEmpty,
            Notify = col.Notify,
        };
        if (sector.Length > 0) outCol.Sector = sector;
        if (ponto.Length > 0) outCol.Ponto = ponto;
        if (observacao.Length > 0) outCol.Observacao = observacao;
        if (animation.Length > 0) outCol.Animation = animation;
        if (isInbox) outCol.Source = BoardConstants.InboxColumnSource;
        return outCol;
    }

    public static BoardConfig NormalizeBoard(BoardConfig? raw)
    {
        raw ??= new BoardConfig();
        var columnsRaw = raw.Columns is { Count: > 0 } ? raw.Columns : DefaultBoard().Columns;
        var columns = columnsRaw.Take(40).Select(NormalizeColumn).ToList();
        if (columns.Count == 0) columns = DefaultBoard().Columns.Select(NormalizeColumn).ToList();
        var showOs = raw.ShowOs;
        var showSp = raw.ShowSp;
        if (!showOs && !showSp)
        {
            showOs = true;
            showSp = true;
        }
        return new BoardConfig
        {
            Sector = string.IsNullOrWhiteSpace(raw.Sector) ? "SEFOC" : raw.Sector.Trim(),
            ColumnCount = columns.Count,
            Columns = columns,
            ShowOs = showOs,
            ShowSp = showSp,
        };
    }

    public static WindowConfig NormalizeWindow(WindowConfig? raw)
    {
        raw ??= new WindowConfig();
        return new WindowConfig
        {
            Width = Math.Clamp(raw.Width <= 0 ? 720 : raw.Width, OverlayBounds.MinWidth, OverlayBounds.MaxWidth),
            X = raw.X,
            Opacity = Math.Clamp(raw.Opacity <= 0 ? 0.95 : raw.Opacity, 0.4, 1.0),
            SpeedPxPerSec = Math.Clamp(raw.SpeedPxPerSec <= 0 ? 40 : raw.SpeedPxPerSec, 8, 160),
            TransparentBg = raw.TransparentBg,
            NotificationsEnabled = raw.NotificationsEnabled,
            NotificationWidth = ArrivalNotify.ClampCardWidth(raw.NotificationWidth),
            NotificationHeight = ArrivalNotify.ClampCardHeight(raw.NotificationHeight),
            NotificationTitleFontSize = ArrivalNotify.ClampTitleFontSize(raw.NotificationTitleFontSize),
            NotificationSituationFontSize = ArrivalNotify.ClampSituationFontSize(raw.NotificationSituationFontSize),
            NotificationPadX = ArrivalNotify.ClampPadX(raw.NotificationPadX),
            NotificationTextGap = ArrivalNotify.ClampTextGap(raw.NotificationTextGap),
            NotificationOffsetRight = ArrivalNotify.ClampOffsetRight(raw.NotificationOffsetRight),
            NotificationOffsetBottom = ArrivalNotify.ClampOffsetBottom(raw.NotificationOffsetBottom),
            NotificationAnimation = ArrivalNotify.ClampAnimation(raw.NotificationAnimation),
            NotificationVisual = ArrivalNotify.NormalizeVisual(raw.NotificationVisual),
        };
    }

    public static AppConfig Normalize(AppConfig? raw)
    {
        raw ??= new AppConfig();
        var window = NormalizeWindow(raw.Window);
        var board = NormalizeBoard(raw.Board);
        if (!board.Columns.Any(col => col.Notify) && window.NotificationsEnabled)
        {
            foreach (var col in board.Columns) col.Notify = true;
        }
        window.NotificationsEnabled = board.Columns.Any(col => col.Notify);
        return new AppConfig
        {
            ApiBaseUrl = NormalizeApiBaseUrl(raw.ApiBaseUrl),
            SslVerify = raw.SslVerify,
            Ponto = string.IsNullOrWhiteSpace(raw.Ponto) ? DefaultPonto : raw.Ponto.Trim(),
            Nome = string.IsNullOrWhiteSpace(raw.Nome) ? DefaultNome : raw.Nome.Trim(),
            Password = raw.Password ?? "",
            PollIntervalSec = Math.Clamp(raw.PollIntervalSec <= 0 ? 10 : raw.PollIntervalSec, 5, 120),
            Window = window,
            Board = board,
        };
    }

    public static AppConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var json = File.ReadAllText(ConfigPath);
                var parsed = JsonSerializer.Deserialize<AppConfig>(json, JsonOptions);
                return Normalize(parsed);
            }
        }
        catch
        {
            // primeira execução ou arquivo inválido: grava o padrão
        }

        var cfg = Normalize(new AppConfig { Board = DefaultBoard() });
        Save(cfg);
        return cfg;
    }

    public static void Save(AppConfig config)
    {
        Directory.CreateDirectory(ConfigDirectory);
        File.WriteAllText(ConfigPath, Serialize(config));
    }

    public static string Serialize(AppConfig config) =>
        JsonSerializer.Serialize(Normalize(config), JsonOptions);

    public static AppConfig RestoreDefaultBoard(AppConfig config)
    {
        config.Board = DefaultBoard();
        return Normalize(config);
    }

    public static AppConfig RestrictConnectionToPrevious(AppConfig incoming, AppConfig previous, bool allowConnectionEdit)
    {
        var next = Normalize(incoming);
        if (allowConnectionEdit) return next;
        var kept = Normalize(previous);
        next.ApiBaseUrl = kept.ApiBaseUrl;
        next.Ponto = kept.Ponto;
        next.Nome = kept.Nome;
        next.Password = kept.Password;
        next.SslVerify = kept.SslVerify;
        return next;
    }

    public static AppConfig ForRemote(AppConfig config)
    {
        var n = Normalize(config);
        n.Window = new WindowConfig
        {
            Width = n.Window.Width,
            Opacity = n.Window.Opacity,
            SpeedPxPerSec = n.Window.SpeedPxPerSec,
            TransparentBg = n.Window.TransparentBg,
            NotificationsEnabled = n.Window.NotificationsEnabled,
            NotificationWidth = n.Window.NotificationWidth,
            NotificationHeight = n.Window.NotificationHeight,
            NotificationTitleFontSize = n.Window.NotificationTitleFontSize,
            NotificationSituationFontSize = n.Window.NotificationSituationFontSize,
            NotificationPadX = n.Window.NotificationPadX,
            NotificationTextGap = n.Window.NotificationTextGap,
            NotificationOffsetRight = n.Window.NotificationOffsetRight,
            NotificationOffsetBottom = n.Window.NotificationOffsetBottom,
            NotificationAnimation = n.Window.NotificationAnimation,
            NotificationVisual = n.Window.NotificationVisual,
        };
        return n;
    }

    public static AppConfig MergeRemote(AppConfig local, AppConfig remote)
    {
        var merged = Normalize(remote);
        merged.Window.X = local.Window.X;
        return Normalize(merged);
    }

    public static string RemoteFingerprint(AppConfig config) =>
        JsonSerializer.Serialize(ForRemote(config), JsonOptions);

    public static AppConfig? TryParse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return Normalize(JsonSerializer.Deserialize<AppConfig>(json, JsonOptions));
        }
        catch
        {
            return null;
        }
    }

    public static AppConfig? TryParseElement(JsonElement element)
    {
        try
        {
            return Normalize(JsonSerializer.Deserialize<AppConfig>(element.GetRawText(), JsonOptions));
        }
        catch
        {
            return null;
        }
    }
}
