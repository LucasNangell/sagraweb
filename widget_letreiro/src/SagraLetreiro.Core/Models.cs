namespace SagraLetreiro;

public static class BoardConstants
{
    public const string InboxColumnSource = "inbox";
    public const string InboxDisplaySituacao = "Novo e-mail";
    public const int DashboardNewHighlightMs = 30_000;
    public static readonly HashSet<string> FinishedSituacoes = new(StringComparer.Ordinal)
    {
        "Entregue", "Cancelada", "Cancelado",
    };
    public static readonly HashSet<string> GravacaoSituacoes = new(StringComparer.Ordinal)
    {
        "Gravação", "Gravação Parcial",
    };
}

public sealed class OsItem
{
    public object? NrOs { get; set; }
    public object? Ano { get; set; }
    public string? Titulo { get; set; }
    public string? Produto { get; set; }
    public string? Solicitante { get; set; }
    public string? Situacao { get; set; }
    public string? Setor { get; set; }
    public string? DataEntrega { get; set; }
    public string? EntregPeriodo { get; set; }
    public string? Prioridade { get; set; }
    public string? LastUpdate { get; set; }
    public string? AndamentoUsuario { get; set; }
    public string? AndamentoPonto { get; set; }
    public string? Observacao { get; set; }
    public object? PcpOrdem { get; set; }
    public string? PcpUltimaAtualizacao { get; set; }
    public string? FornecedorPonto { get; set; }
    public string? FornecedorNome { get; set; }
    public object? Fornecedores { get; set; }
    public string? RowKind { get; set; }
    public object? SubOsId { get; set; }
    public string? ComponenteNome { get; set; }
    public object? ParentNrOs { get; set; }
    public object? ParentAno { get; set; }
    public string? UniqueKey { get; set; }
    public string? PriorityType { get; set; }
    public bool IsNew { get; set; }
    public string? DisplaySituacao { get; set; }
    public string? LastColumnId { get; set; }
    public long HighlightUntil { get; set; }

    public OsItem Clone()
    {
        return (OsItem)MemberwiseClone();
    }
}

public sealed class BoardColumn
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public List<string> Statuses { get; set; } = new();
    public string? Sector { get; set; }
    public string? Source { get; set; }
    public bool HideWhenEmpty { get; set; }
    public bool Notify { get; set; }
    public string? Ponto { get; set; }
    public string? Observacao { get; set; }
    public string? Animation { get; set; }
    public List<OsItem> Items { get; set; } = new();
}

public sealed class BoardConfig
{
    public string Sector { get; set; } = "SEFOC";
    public int ColumnCount { get; set; }
    public List<BoardColumn> Columns { get; set; } = new();
    public bool ShowOs { get; set; } = true;
    public bool ShowSp { get; set; } = true;
}

public sealed class WindowConfig
{
    public int Width { get; set; } = 720;
    public int? X { get; set; }
    public double Opacity { get; set; } = 0.95;
    public double SpeedPxPerSec { get; set; } = 40;
    public bool TransparentBg { get; set; }
    public bool NotificationsEnabled { get; set; }
    public int NotificationWidth { get; set; } = ArrivalNotify.DefaultCardWidth;
    public int NotificationHeight { get; set; } = ArrivalNotify.DefaultCardHeight;
    public int NotificationTitleFontSize { get; set; } = ArrivalNotify.DefaultTitleFontSize;
    public int NotificationSituationFontSize { get; set; } = ArrivalNotify.DefaultSituationFontSize;
    public int NotificationPadX { get; set; } = ArrivalNotify.DefaultPadX;
    public int? NotificationTextGap { get; set; }
    public int? NotificationOffsetRight { get; set; }
    public int? NotificationOffsetBottom { get; set; }
    public string NotificationAnimation { get; set; } = ArrivalNotify.DefaultAnimation;
    public NotificationVisual NotificationVisual { get; set; } = new();
    public bool TickerHtml { get; set; } = true;
    public string TickerCardModel { get; set; } = TickerModels.DefaultId;
}

public sealed class NotificationSlotStyle
{
    public string Bg { get; set; } = "";
    public string Border { get; set; } = "";
    public string Accent { get; set; } = "";
    public string Extra { get; set; } = "";
    public string Extra2 { get; set; } = "";
    public string Text { get; set; } = "";
    public string Title { get; set; } = "";
    public string Situation { get; set; } = "";
    public string Author { get; set; } = "";
    public string Timer { get; set; } = "";
    public string Effect { get; set; } = "";
    public string Highlight { get; set; } = "";
    public string HighlightAccent { get; set; } = "";
    public string HighlightExtra { get; set; } = "";
}

public sealed class NotificationVisual
{
    public int PresetId { get; set; }
    public string PresetName { get; set; } = "";
    public double FontScale { get; set; } = 1;
    public double TitleScale { get; set; } = 1;
    public double SituationScale { get; set; } = 1;
    public double? LetterSpacing { get; set; }
    public string FontFamily { get; set; } = "";
    public NotificationSlotStyle High { get; set; } = new();
    public NotificationSlotStyle Medium { get; set; } = new();
    public NotificationSlotStyle Normal { get; set; } = new();
}

public sealed class AppConfig
{
    public string ApiBaseUrl { get; set; } = ConfigStore.ProductionApiBase;
    public bool SslVerify { get; set; }
    public string Ponto { get; set; } = ConfigStore.DefaultPonto;
    public string Nome { get; set; } = ConfigStore.DefaultNome;
    public string Password { get; set; } = "";
    public int PollIntervalSec { get; set; } = 10;
    public WindowConfig Window { get; set; } = new();
    public BoardConfig Board { get; set; } = new();
}

public sealed class LetreiroInstance
{
    public string HostName { get; set; } = "";
    public string WindowsUser { get; set; } = "";
    public string Nome { get; set; } = "";
    public string Setor { get; set; } = "";
    public string Version { get; set; } = "";
    public string Ponto { get; set; } = "";
    public DateTime? LastSeen { get; set; }
    public bool Online { get; set; }
    public bool HasConfig { get; set; }
}

public sealed class LetreiroCommand
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "bat";
    public string Content { get; set; } = "";
    public int TimeoutSec { get; set; } = 60;
    public string KindBadge =>
        string.Equals(Kind, "ps1", StringComparison.OrdinalIgnoreCase) ? "PS1" : "BAT";
    public string TimeoutLabel => $"{Math.Max(5, TimeoutSec)}s";
    public string Summary
    {
        get
        {
            var line = (Content ?? "").Replace('\r', ' ').Replace('\n', ' ').Trim();
            if (string.IsNullOrEmpty(line)) return "Script vazio";
            return line.Length <= 72 ? line : line[..72] + "…";
        }
    }
    public override string ToString() => string.IsNullOrWhiteSpace(Name) ? $".{Kind}" : $"{Name} (.{Kind})";
}

public sealed class LetreiroJob
{
    public int Id { get; set; }
    public int? CommandId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Content { get; set; } = "";
    public int TimeoutSec { get; set; } = 60;
    public string HostName { get; set; } = "";
    public string WindowsUser { get; set; } = "";
    public string Status { get; set; } = "";
    public int? ExitCode { get; set; }
    public string Stdout { get; set; } = "";
    public string Stderr { get; set; } = "";
    public DateTime? CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public sealed class LetreiroJobTarget
{
    public string HostName { get; set; } = "";
    public string WindowsUser { get; set; } = "";
}

public static class LetreiroCommandPoll
{
    public const int DefaultSec = 10;
    public const int MinSec = 1;
    public const int MaxSec = 120;

    public static int Clamp(int value) =>
        Math.Clamp(value <= 0 ? DefaultSec : value, MinSec, MaxSec);
}

public sealed class TickerCard
{
    public string UniqueKey { get; set; } = "";
    public string OpKey { get; set; } = "";
    public string Label { get; set; } = "";
    public string Situacao { get; set; } = "";
    public string? Priority { get; set; }
    public bool IsNew { get; set; }
    public bool IsSubOs { get; set; }
    public int ColumnIndex { get; set; }
    public string ColumnTitle { get; set; } = "";
    public string? Animation { get; set; }
    public object? NrOs { get; set; }
    public object? Ano { get; set; }
    public object? ParentNrOs { get; set; }
    public object? ParentAno { get; set; }
    public string? Titulo { get; set; }
    public string? Produto { get; set; }
    public string? Solicitante { get; set; }

    public int FolderNr => Board.ToInt(IsSubOs ? ParentNrOs ?? NrOs : NrOs);
    public int FolderAno => Board.ToInt(IsSubOs ? ParentAno ?? Ano : Ano);
}

public sealed class OsDetails
{
    public string? MaquinaLink { get; set; }
    public object? Tiragem { get; set; }
    public object? Pags { get; set; }
    public object? ModelosArq { get; set; }
    public object? FrenteVerso { get; set; }
    public string? FormatoLink { get; set; }
    public string? EntregPrazoLink { get; set; }
    public string? EntregData { get; set; }
    public string? EntregPeriodo { get; set; }
    public string? ContatoTrab { get; set; }
    public string? PapelLink { get; set; }
    public string? PapelDescricao { get; set; }
    public string? Cores { get; set; }
    public string? CoresDescricao { get; set; }
    public string? DescAcabamento { get; set; }
    public string? Observ { get; set; }
}

public sealed class InboxRef
{
    public int Os { get; set; }
    public int Ano { get; set; }
    public string? Date { get; set; }
}

public sealed class ProcessedBoard
{
    public List<BoardColumn> Columns { get; set; } = new();
    public List<OsItem> UnmappedItems { get; set; } = new();
    public int HiddenCount { get; set; }
    public bool HasNewItems { get; set; }
    public List<string> NewArrivalKeys { get; set; } = new();
}

public readonly record struct PlacedCard(TickerCard Card, double X, double Width);
