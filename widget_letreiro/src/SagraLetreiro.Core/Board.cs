namespace SagraLetreiro;

public static class Board
{
    public static bool IsInboxColumn(BoardColumn col) =>
        col.Source == BoardConstants.InboxColumnSource;

    public static bool DashboardConfigHasInboxColumn(BoardConfig config) =>
        config.Columns.Any(IsInboxColumn);

    public static string? ResolvePriorityType(string? prioridade)
    {
        if (string.IsNullOrEmpty(prioridade)) return null;
        if (prioridade.Contains("Prometido", StringComparison.Ordinal)) return "priority-high";
        if (prioridade.Contains("Solicitado", StringComparison.Ordinal)) return "priority-medium";
        return null;
    }

    public static string ResolveDisplaySituacao(OsItem item)
    {
        var situacao = item.Situacao ?? "";
        var obs = (item.Observacao ?? "").ToLowerInvariant();
        if (situacao == "Em Execução" && obs.Contains("analis", StringComparison.Ordinal))
            return "Analisar arquivo";
        return situacao;
    }

    public static bool MatchesColumnStatus(string situacao, string statusFilter)
    {
        var value = (situacao ?? "").Trim();
        var filt = (statusFilter ?? "").Trim();
        if (filt.Length == 0) return false;
        if (value == filt) return true;
        if (filt.EndsWith('/')) return value.StartsWith(filt, StringComparison.Ordinal);
        return false;
    }

    public static int ToInt(object? value, int fallback = 0)
    {
        if (value is null) return fallback;
        if (value is int i) return i;
        if (value is long l) return (int)l;
        if (value is double d) return (int)d;
        return int.TryParse(Convert.ToString(value), out var parsed) ? parsed : fallback;
    }

    public static string FormatOsNumber(object? nrOs, object? ano)
    {
        var nr = ToInt(nrOs);
        var prefix = nr < 5000 ? "OS" : "SP";
        var year = Convert.ToString(ano) ?? "";
        var suffix = year.Length >= 2 ? year[^2..] : year;
        return $"{prefix} {nrOs}/{suffix}";
    }

    public static string FormatQueueDisplayLabel(OsItem item)
    {
        if (item.RowKind == "sub_os")
        {
            var nr = item.ParentNrOs ?? item.NrOs;
            var ano = item.ParentAno ?? item.Ano;
            return FormatOsNumber(nr, ano);
        }
        return FormatOsNumber(item.NrOs, item.Ano);
    }

    public static string FormatQueueDisplaySituacao(OsItem item)
    {
        var situacao = ResolveDisplaySituacao(item);
        if (item.RowKind != "sub_os") return situacao;
        var comp = (item.ComponenteNome ?? "").Trim();
        if (comp.Length == 0) return situacao;
        var prefix = $"[{comp}]";
        if (situacao.StartsWith(prefix, StringComparison.Ordinal)) return situacao;
        return situacao.Length > 0 ? $"{prefix} {situacao}" : prefix;
    }

    public static bool OsBelongsToDashboardSector(OsItem item, string sector)
    {
        var situacao = (item.Situacao ?? "").Trim();
        if (BoardConstants.FinishedSituacoes.Contains(situacao)) return false;
        if (sector == "Gravação") return BoardConstants.GravacaoSituacoes.Contains(situacao);
        return (item.Setor ?? "").Trim() == sector.Trim();
    }

    public static string ResolveColumnSector(BoardColumn col, string boardSector)
    {
        var overrideSector = (col.Sector ?? "").Trim();
        return overrideSector.Length > 0 ? overrideSector : (boardSector ?? "").Trim();
    }

    public static List<string> CollectDashboardSectors(BoardConfig config)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var sectors = new List<string>();
        void Push(string raw)
        {
            var sector = (raw ?? "").Trim();
            if (sector.Length == 0 || !seen.Add(sector)) return;
            sectors.Add(sector);
        }
        Push(config.Sector ?? "");
        foreach (var col in config.Columns)
        {
            if (IsInboxColumn(col)) continue;
            Push(ResolveColumnSector(col, config.Sector ?? ""));
        }
        return sectors;
    }

    public static string DashboardItemKey(OsItem item)
    {
        if (item.RowKind == "sub_os" && item.SubOsId is not null)
        {
            var parentNr = item.ParentNrOs ?? item.NrOs;
            var parentAno = item.ParentAno ?? item.Ano;
            return $"{parentNr}-{parentAno}-sub-{item.SubOsId}";
        }
        return $"{item.NrOs}-{item.Ano}";
    }

    public static List<OsItem> MergeDashboardQueueSources(List<OsItem> searchItems, List<OsItem> pcpItems)
    {
        var pcpMain = new Dictionary<string, OsItem>();
        foreach (var item in pcpItems)
        {
            if (item.RowKind == "sub_os") continue;
            pcpMain[DashboardItemKey(item)] = item;
        }

        var seen = new HashSet<string>();
        var merged = new List<OsItem>();
        foreach (var item in searchItems)
        {
            var key = DashboardItemKey(item);
            seen.Add(key);
            if (pcpMain.TryGetValue(key, out var pcp))
            {
                var row = item.Clone();
                row.PcpOrdem = pcp.PcpOrdem ?? item.PcpOrdem;
                row.PcpUltimaAtualizacao = pcp.PcpUltimaAtualizacao ?? item.PcpUltimaAtualizacao;
                merged.Add(row);
            }
            else
            {
                merged.Add(item);
            }
        }

        foreach (var item in pcpItems)
        {
            var key = DashboardItemKey(item);
            if (!seen.Add(key)) continue;
            merged.Add(item);
        }
        return merged;
    }

    public static List<OsItem> MergeDashboardSectorItemLists(IEnumerable<List<OsItem>> lists)
    {
        var seen = new HashSet<string>();
        var merged = new List<OsItem>();
        foreach (var list in lists)
        {
            foreach (var item in list)
            {
                var key = DashboardItemKey(item);
                if (!seen.Add(key)) continue;
                merged.Add(item);
            }
        }
        return merged;
    }

    public static int? ResolvePcpOrder(object? raw)
    {
        if (raw is null || raw is string s && s.Length == 0) return null;
        try
        {
            return ToInt(raw);
        }
        catch
        {
            return null;
        }
    }

    static int ProtocolGroup(OsItem os)
    {
        try
        {
            return ToInt(os.NrOs) < 5000 ? 0 : 1;
        }
        catch
        {
            return 1;
        }
    }

    static int SortWeight(OsItem os)
    {
        var prio = os.Prioridade ?? "";
        if (prio.Contains("Prometido p/", StringComparison.Ordinal)) return 0;
        if (prio.Contains("Solicitado p/", StringComparison.Ordinal)) return 1;
        try
        {
            return ToInt(os.NrOs) < 5000 ? 2 : 3;
        }
        catch
        {
            return 3;
        }
    }

    public static double ParseTime(object? value)
    {
        if (value is null) return 0;
        var text = Convert.ToString(value)?.Replace('T', ' ') ?? "";
        if (text.Length == 0) return 0;
        var slice = text.Length > 26 ? text[..26] : text;
        string[] formats = { "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm:ss.FFFFFFF" };
        foreach (var fmt in formats)
        {
            if (DateTime.TryParseExact(slice, fmt, null, System.Globalization.DateTimeStyles.None, out var dt))
                return new DateTimeOffset(dt).ToUnixTimeSeconds();
        }
        if (DateTime.TryParse(slice, out var parsed))
            return new DateTimeOffset(parsed).ToUnixTimeSeconds();
        return 0;
    }

    public static int SortByPcp(OsItem a, OsItem b)
    {
        var group = ProtocolGroup(a) - ProtocolGroup(b);
        if (group != 0) return group;

        static bool HasOrder(OsItem os, out int value)
        {
            value = 0;
            if (os.PcpOrdem is int i)
            {
                value = i;
                return true;
            }
            return false;
        }

        var hasA = HasOrder(a, out var oa);
        var hasB = HasOrder(b, out var ob);
        if (hasA || hasB)
        {
            if (hasA && hasB) return oa - ob;
            return hasA ? -1 : 1;
        }

        var w = SortWeight(a) - SortWeight(b);
        if (w != 0) return w;
        var da = ParseTime(a.LastUpdate);
        var db = ParseTime(b.LastUpdate);
        if (da < db) return -1;
        if (da > db) return 1;
        return 0;
    }

    public static void SortItemsPcp(List<OsItem> items) =>
        items.Sort(SortByPcp);

    public static string? FindColumnId(BoardConfig config, OsItem item)
    {
        var situacao = item.Situacao ?? "";
        var boardSector = config.Sector ?? "";
        foreach (var col in config.Columns)
        {
            if (IsInboxColumn(col)) continue;
            var columnSector = ResolveColumnSector(col, boardSector);
            if (!OsBelongsToDashboardSector(item, columnSector)) continue;
            if (col.Statuses.Any(status => MatchesColumnStatus(situacao, status)))
                return col.Id;
        }
        return null;
    }

    static string InboxItemKey(int os, int ano) => $"inbox:{os}-{ano}";

    static OsItem BuildInboxItem(InboxRef refer, OsItem? source)
    {
        var lastUpdate = refer.Date ?? source?.LastUpdate;
        if (source is not null)
        {
            var item = source.Clone();
            item.NrOs = refer.Os;
            item.Ano = refer.Ano;
            item.UniqueKey = InboxItemKey(refer.Os, refer.Ano);
            item.DisplaySituacao = BoardConstants.InboxDisplaySituacao;
            item.LastUpdate = lastUpdate;
            item.LastColumnId = null;
            item.IsNew = false;
            item.HighlightUntil = 0;
            item.RowKind = "main_os";
            item.SubOsId = null;
            item.ComponenteNome = null;
            return item;
        }
        return new OsItem
        {
            NrOs = refer.Os,
            Ano = refer.Ano,
            UniqueKey = InboxItemKey(refer.Os, refer.Ano),
            IsNew = false,
            DisplaySituacao = BoardConstants.InboxDisplaySituacao,
            LastUpdate = lastUpdate,
            Situacao = BoardConstants.InboxDisplaySituacao,
        };
    }

    static void FillInboxColumns(
        List<BoardColumn> columns,
        BoardConfig config,
        Dictionary<string, OsItem> master,
        IReadOnlyList<InboxRef>? inboxOs)
    {
        var refs = inboxOs ?? Array.Empty<InboxRef>();
        for (var i = 0; i < config.Columns.Count; i++)
        {
            if (!IsInboxColumn(config.Columns[i])) continue;
            var unique = new Dictionary<string, InboxRef>();
            foreach (var refer in refs)
            {
                if (refer.Os <= 0 || refer.Ano <= 0) continue;
                var pair = $"{refer.Os}-{refer.Ano}";
                if (unique.TryGetValue(pair, out var previous) &&
                    ParseTime(previous.Date) >= ParseTime(refer.Date))
                    continue;
                unique[pair] = refer;
            }
            var items = unique.Values
                .Select(r => BuildInboxItem(r, master.GetValueOrDefault($"{r.Os}-{r.Ano}")))
                .ToList();
            items.Sort((a, b) =>
            {
                var cmp = ParseTime(b.LastUpdate).CompareTo(ParseTime(a.LastUpdate));
                return cmp != 0 ? cmp : string.CompareOrdinal(a.UniqueKey, b.UniqueKey);
            });
            columns[i].Items = items;
        }
    }

    public static ProcessedBoard ProcessDashboardData(
        List<OsItem> rawData,
        BoardConfig config,
        Dictionary<string, OsItem> masterOpsMap,
        long? nowMs = null,
        bool isInitialLoad = false,
        IReadOnlyList<InboxRef>? inboxOs = null)
    {
        var now = nowMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var incoming = new HashSet<string>();
        var hasNew = false;
        var tempColumns = config.Columns.Select(col => new BoardColumn
        {
            Id = col.Id,
            Title = col.Title,
            Statuses = col.Statuses.ToList(),
            Sector = col.Sector,
            Source = col.Source,
            HideWhenEmpty = col.HideWhenEmpty,
            Items = new List<OsItem>(),
        }).ToList();
        var unmapped = new List<OsItem>();
        var hidden = 0;

        foreach (var os in rawData)
        {
            var uniqueKey = DashboardItemKey(os);
            incoming.Add(uniqueKey);
            var currentColumnId = FindColumnId(config, os);
            OsItem item;
            if (masterOpsMap.TryGetValue(uniqueKey, out var existing))
            {
                item = existing;
                Patch(item, os);
                item.IsNew = item.HighlightUntil > now;
            }
            else
            {
                item = os.Clone();
                item.UniqueKey = uniqueKey;
                item.PriorityType = ResolvePriorityType(os.Prioridade);
                item.IsNew = false;
                item.PcpOrdem = ResolvePcpOrder(os.PcpOrdem);
                item.DisplaySituacao = FormatQueueDisplaySituacao(os);
                item.LastColumnId = null;
                item.HighlightUntil = 0;
                if (!isInitialLoad)
                {
                    item.IsNew = true;
                    item.HighlightUntil = now + BoardConstants.DashboardNewHighlightMs;
                    hasNew = true;
                }
                masterOpsMap[uniqueKey] = item;
            }

            if (!isInitialLoad &&
                currentColumnId is not null &&
                !string.IsNullOrEmpty(item.LastColumnId) &&
                item.LastColumnId != currentColumnId)
            {
                item.IsNew = true;
                item.HighlightUntil = now + BoardConstants.DashboardNewHighlightMs;
                hasNew = true;
            }

            item.LastColumnId = currentColumnId;
            var colIndex = config.Columns.FindIndex(c => c.Id == currentColumnId);
            if (colIndex >= 0) tempColumns[colIndex].Items.Add(item);
            else
            {
                hidden++;
                unmapped.Add(item);
            }
        }

        foreach (var key in masterOpsMap.Keys.ToList())
        {
            if (!incoming.Contains(key)) masterOpsMap.Remove(key);
        }

        FillInboxColumns(tempColumns, config, masterOpsMap, inboxOs);
        foreach (var col in tempColumns)
        {
            if (IsInboxColumn(col)) continue;
            SortItemsPcp(col.Items);
        }
        SortItemsPcp(unmapped);

        return new ProcessedBoard
        {
            Columns = tempColumns,
            UnmappedItems = unmapped,
            HiddenCount = hidden,
            HasNewItems = hasNew,
        };
    }

    static void Patch(OsItem item, OsItem os)
    {
        item.Situacao = os.Situacao;
        item.Setor = os.Setor;
        item.Titulo = os.Titulo;
        item.Produto = os.Produto;
        item.Solicitante = os.Solicitante;
        item.Prioridade = os.Prioridade;
        item.LastUpdate = os.LastUpdate;
        item.AndamentoUsuario = os.AndamentoUsuario;
        item.Observacao = os.Observacao;
        item.DataEntrega = os.DataEntrega;
        item.EntregPeriodo = os.EntregPeriodo;
        item.PcpOrdem = ResolvePcpOrder(os.PcpOrdem);
        item.PcpUltimaAtualizacao = os.PcpUltimaAtualizacao;
        item.PriorityType = ResolvePriorityType(os.Prioridade);
        item.DisplaySituacao = FormatQueueDisplaySituacao(os);
        item.RowKind = os.RowKind;
        item.SubOsId = os.SubOsId;
        item.ComponenteNome = os.ComponenteNome;
        item.ParentNrOs = os.ParentNrOs;
        item.ParentAno = os.ParentAno;
        item.FornecedorPonto = os.FornecedorPonto;
        item.FornecedorNome = os.FornecedorNome;
        item.Fornecedores = os.Fornecedores;
    }

    public static List<BoardColumn> GetVisibleDashboardColumns(List<BoardColumn> columns) =>
        columns.Where(col => !col.HideWhenEmpty || col.Items.Count > 0).ToList();

    public static bool IsOsNumber(object? nrOs) => ToInt(nrOs) < 5000;

    public static bool MatchesProtocolFilter(OsItem item, bool showOs, bool showSp)
    {
        if (showOs && showSp) return true;
        var nr = item.RowKind == "sub_os" ? item.ParentNrOs ?? item.NrOs : item.NrOs;
        return IsOsNumber(nr) ? showOs : showSp;
    }

    public static string TickerOpKey(OsItem item)
    {
        if (item.RowKind == "sub_os")
        {
            var nr = item.ParentNrOs ?? item.NrOs;
            var ano = item.ParentAno ?? item.Ano;
            return $"{nr}-{ano}";
        }
        return $"{item.NrOs}-{item.Ano}";
    }

    public static List<TickerCard> FlattenTickerCards(List<BoardColumn> columns, BoardConfig? board = null)
    {
        var showOs = board?.ShowOs ?? true;
        var showSp = board?.ShowSp ?? true;
        if (!showOs && !showSp)
        {
            showOs = true;
            showSp = true;
        }
        var cards = new List<TickerCard>();
        var seen = new HashSet<string>();
        for (var origIdx = 0; origIdx < columns.Count; origIdx++)
        {
            var col = columns[origIdx];
            if (col.HideWhenEmpty && col.Items.Count == 0) continue;
            foreach (var item in col.Items)
            {
                if (!MatchesProtocolFilter(item, showOs, showSp)) continue;
                var opKey = TickerOpKey(item);
                if (!seen.Add(opKey)) continue;
                cards.Add(new TickerCard
                {
                    UniqueKey = item.UniqueKey ?? DashboardItemKey(item),
                    OpKey = opKey,
                    Label = FormatQueueDisplayLabel(item),
                    Situacao = item.DisplaySituacao ?? "",
                    Priority = item.PriorityType,
                    IsNew = item.IsNew,
                    IsSubOs = item.RowKind == "sub_os",
                    ColumnIndex = origIdx,
                    ColumnTitle = col.Title ?? "",
                    NrOs = item.NrOs,
                    Ano = item.Ano,
                    ParentNrOs = item.ParentNrOs,
                    ParentAno = item.ParentAno,
                    Titulo = item.Titulo,
                    Produto = item.Produto,
                    Solicitante = item.Solicitante,
                });
            }
        }
        return cards;
    }

    public static bool TickerContentOverflows(IReadOnlyList<double> cardWidths, double gap, double canvasWidth)
    {
        if (cardWidths.Count == 0 || canvasWidth <= 0) return false;
        var total = cardWidths.Sum() + gap * (cardWidths.Count - 1);
        return total > canvasWidth;
    }
}
