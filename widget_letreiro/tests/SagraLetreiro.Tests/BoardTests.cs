using System.Text.Json;
using SagraLetreiro;

namespace SagraLetreiro.Tests;

public class BoardTests
{
    static readonly OsItem SubOs = new()
    {
        NrOs = 568,
        Ano = 2026,
        RowKind = "sub_os",
        SubOsId = 1,
        ParentNrOs = 568,
        ParentAno = 2026,
        ComponenteNome = "Miolo",
        Situacao = "Em Execução",
    };

    [Fact]
    public void FormatOsNumber_OsVsSp()
    {
        Assert.Equal("OS 1234/26", Board.FormatOsNumber(1234, 2026));
        Assert.Equal("SP 5123/26", Board.FormatOsNumber(5123, 2026));
    }

    [Fact]
    public void FormatQueueDisplayLabel_SubOsUsesParent()
    {
        Assert.Equal("OS 568/26", Board.FormatQueueDisplayLabel(SubOs));
        Assert.Equal("OS 568/26", Board.FormatQueueDisplayLabel(new OsItem { NrOs = 568, Ano = 2026, Situacao = "Em Execução" }));
    }

    [Fact]
    public void FormatQueueDisplaySituacao()
    {
        Assert.Equal("[Miolo] Em Execução", Board.FormatQueueDisplaySituacao(SubOs));
        var already = SubOs.Clone();
        already.Situacao = "[Miolo] Em Execução";
        Assert.Equal("[Miolo] Em Execução", Board.FormatQueueDisplaySituacao(already));
        Assert.Equal("Recebido", Board.FormatQueueDisplaySituacao(new OsItem { NrOs = 1, Ano = 2026, Situacao = "Recebido" }));
    }

    [Fact]
    public void AnalisarArquivoOverride()
    {
        var item = new OsItem { NrOs = 10, Ano = 2026, Situacao = "Em Execução", Observacao = "Analisar PDF enviado" };
        Assert.Equal("Analisar arquivo", Board.FormatQueueDisplaySituacao(item));
    }

    [Fact]
    public void MatchesColumnStatus_ExactAndPrefix()
    {
        Assert.True(Board.MatchesColumnStatus("Gravação", "Gravação"));
        Assert.False(Board.MatchesColumnStatus("Gravação Pendente", "Gravação"));
        Assert.False(Board.MatchesColumnStatus("Gravação Externa", "Gravação"));
        Assert.False(Board.MatchesColumnStatus("Gravação Parcial", "Gravação"));
        Assert.True(Board.MatchesColumnStatus("Saída p/", "Saída p/"));
        Assert.True(Board.MatchesColumnStatus("Saída p/ SEFOC", "Saída p/"));
        Assert.False(Board.MatchesColumnStatus("Recebido", "Saída p/"));
        Assert.False(Board.MatchesColumnStatus("Em Execução", "Em"));
    }

    [Fact]
    public void MatchesColumnPontoAndObservacao()
    {
        Assert.True(Board.MatchesColumnPonto("12345", ""));
        Assert.True(Board.MatchesColumnPonto("12.345", "12345"));
        Assert.True(Board.MatchesColumnPonto("12-345", "12345"));
        Assert.False(Board.MatchesColumnPonto("999", "12345"));
        Assert.False(Board.MatchesColumnPonto("", "12345"));
        Assert.True(Board.MatchesColumnObservacao("Analisar PDF enviado", "pdf"));
        Assert.True(Board.MatchesColumnObservacao("URGENTE na gráfica", "urgente"));
        Assert.False(Board.MatchesColumnObservacao("sem nota", "urgente"));
        Assert.True(Board.MatchesColumnObservacao("qualquer", ""));
    }

    [Fact]
    public void FindColumnIdRequiresPontoAndObservacaoWhenSet()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "ana", Title = "Ana", Statuses = ["Em Execução"], Ponto = "111" },
                new() { Id = "bruno", Title = "Bruno", Statuses = ["Em Execução"], Ponto = "222" },
                new() { Id = "obs", Title = "Obs", Statuses = ["Recebido"], Observacao = "urgente" },
                new() { Id = "any", Title = "Any", Statuses = ["Recebido"] },
            ],
        };
        Assert.Equal("ana", Board.FindColumnId(config, new OsItem { Situacao = "Em Execução", Setor = "SEFOC", AndamentoPonto = "111" }));
        Assert.Equal("bruno", Board.FindColumnId(config, new OsItem { Situacao = "Em Execução", Setor = "SEFOC", AndamentoPonto = "222" }));
        Assert.Null(Board.FindColumnId(config, new OsItem { Situacao = "Em Execução", Setor = "SEFOC", AndamentoPonto = "333" }));
        Assert.Equal("obs", Board.FindColumnId(config, new OsItem { Situacao = "Recebido", Setor = "SEFOC", Observacao = "Pedido URGENTE do gabinete" }));
        Assert.Equal("any", Board.FindColumnId(config, new OsItem { Situacao = "Recebido", Setor = "SEFOC", Observacao = "sem marca" }));
    }

    [Fact]
    public void InboxFilterAppliesPontoAndObservacao()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns = [new() { Id = "in", Title = "Inbox", Source = "inbox", Ponto = "111", Observacao = "pdf" }],
        };
        var processed = Board.ProcessDashboardData(
            [
                new OsItem { NrOs = 1, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC", AndamentoPonto = "111", Observacao = "Analisar PDF" },
                new OsItem { NrOs = 2, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC", AndamentoPonto = "111", Observacao = "sem arquivo" },
                new OsItem { NrOs = 3, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC", AndamentoPonto = "222", Observacao = "PDF enviado" },
            ],
            config, new Dictionary<string, OsItem>(), isInitialLoad: true,
            inboxOs:
            [
                new InboxRef { Os = 1, Ano = 2026 },
                new InboxRef { Os = 2, Ano = 2026 },
                new InboxRef { Os = 3, Ano = 2026 },
                new InboxRef { Os = 4, Ano = 2026 },
            ]);
        Assert.Equal(["inbox:1-2026"], processed.Columns[0].Items.Select(i => i.UniqueKey ?? "").ToArray());
    }

    [Fact]
    public void OsBelongsToDashboardSector()
    {
        Assert.False(Board.OsBelongsToDashboardSector(new OsItem { NrOs = 1, Ano = 2026, Situacao = "Entregue", Setor = "SEFOC" }, "SEFOC"));
        Assert.True(Board.OsBelongsToDashboardSector(new OsItem { NrOs = 1, Ano = 2026, Situacao = "Gravação", Setor = "SEFOC" }, "Gravação"));
        Assert.False(Board.OsBelongsToDashboardSector(new OsItem { NrOs = 1, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" }, "Gravação"));
    }

    [Fact]
    public void ResolveAndCollectSectors()
    {
        Assert.Equal("SEFOC", Board.ResolveColumnSector(new BoardColumn(), "SEFOC"));
        Assert.Equal("SEFOC", Board.ResolveColumnSector(new BoardColumn { Sector = "  " }, "SEFOC"));
        Assert.Equal("Papelaria", Board.ResolveColumnSector(new BoardColumn { Sector = "Papelaria" }, "SEFOC"));
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "a", Title = "A", Statuses = ["Recebido"] },
                new() { Id = "b", Title = "B", Statuses = ["Em Execução"], Sector = "Papelaria" },
                new() { Id = "c", Title = "C", Statuses = ["Pronto"], Sector = "SEFOC" },
                new() { Id = "inbox", Title = "Novo e-mail", Statuses = [], Source = "inbox", Sector = "Papelaria" },
            ],
        };
        Assert.Equal(["SEFOC", "Papelaria"], Board.CollectDashboardSectors(config));
    }

    [Fact]
    public void MergeSearchWinsAndKeepsSubOs()
    {
        var search = new List<OsItem>
        {
            new() { NrOs = 100, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" },
            new() { NrOs = 200, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" },
        };
        var pcp = new List<OsItem>
        {
            new() { NrOs = 100, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC", PcpOrdem = 2 },
            CloneSub(pcpOrdem: 1),
        };
        var merged = Board.MergeDashboardQueueSources(search, pcp);
        Assert.Equal(3, merged.Count);
        Assert.Equal(2, merged[0].PcpOrdem);
        Assert.Equal("sub_os", merged[2].RowKind);
    }

    [Fact]
    public void ProcessAssignsColumnsBySectorOverride()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "sefoca", Title = "Execução SEFOC", Statuses = ["Em Execução"] },
                new() { Id = "papelaria", Title = "Execução Papelaria", Statuses = ["Em Execução"], Sector = "Papelaria" },
            ],
        };
        var raw = new List<OsItem>
        {
            new() { NrOs = 1, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" },
            new() { NrOs = 2, Ano = 2026, Situacao = "Em Execução", Setor = "Papelaria" },
        };
        var processed = Board.ProcessDashboardData(raw, config, new(), isInitialLoad: true);
        Assert.Equal(new object[] { 1 }, processed.Columns[0].Items.Select(i => i.NrOs).ToArray());
        Assert.Equal(new object[] { 2 }, processed.Columns[1].Items.Select(i => i.NrOs).ToArray());
    }

    [Fact]
    public void OsBeforeSpEvenWithPcpAndPriority()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns = [new() { Id = "exec", Title = "Execução", Statuses = ["Em Execução"] }],
        };
        var raw = new List<OsItem>
        {
            new() { NrOs = 5100, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC", PcpOrdem = 0, Prioridade = "Prometido p/ 10/10" },
            new() { NrOs = 200, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC", PcpOrdem = 2 },
            new() { NrOs = 5300, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC", Prioridade = "Solicitado p/ 12/10" },
            new() { NrOs = 100, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC", PcpOrdem = 1 },
            new() { NrOs = 5400, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC", Prioridade = "Prometido p/ 11/10" },
        };
        var processed = Board.ProcessDashboardData(raw, config, new(), isInitialLoad: true);
        Assert.Equal(new object[] { 100, 200, 5100, 5400, 5300 }, processed.Columns[0].Items.Select(i => i.NrOs).ToArray());
    }

    [Fact]
    public void FlattenDedupesSameOp()
    {
        var columns = new List<BoardColumn>
        {
            new()
            {
                Id = "exec",
                Title = "Execução",
                Statuses = ["Em Execução"],
                Items =
                [
                    new OsItem { NrOs = 77, Ano = 2026, UniqueKey = "77-2026", DisplaySituacao = "Em Execução", RowKind = "main_os" },
                ],
            },
            new()
            {
                Id = "inbox",
                Title = "Novo e-mail",
                Source = "inbox",
                Items =
                [
                    new OsItem { NrOs = 77, Ano = 2026, UniqueKey = "inbox:77-2026", DisplaySituacao = "Novo e-mail", RowKind = "main_os" },
                ],
            },
            new()
            {
                Id = "sub",
                Title = "Sub",
                Statuses = ["Em Execução"],
                Items =
                [
                    new OsItem
                    {
                        NrOs = 77, Ano = 2026, RowKind = "sub_os", UniqueKey = "568-2026-sub-1",
                        DisplaySituacao = "[Miolo] Em Execução", ParentNrOs = 77, ParentAno = 2026,
                    },
                ],
            },
        };
        var cards = Board.FlattenTickerCards(columns);
        Assert.Equal(new[] { "OS 77/26" }, cards.Select(c => c.Label).ToArray());
        Assert.Equal("77-2026", Board.TickerOpKey(columns[0].Items[0]));
    }

    [Fact]
    public void FlattenKeepsHeaderFieldsAndParentForSubOs()
    {
        var columns = new List<BoardColumn>
        {
            new()
            {
                Id = "exec",
                Title = "Execução",
                Items =
                [
                    new OsItem
                    {
                        NrOs = 12, Ano = 2026, Titulo = "Ofício", Produto = "Cartaz", Solicitante = "Gabinete 4",
                        UniqueKey = "12-2026", DisplaySituacao = "Em Execução", RowKind = "main_os",
                    },
                ],
            },
        };
        var main = Board.FlattenTickerCards(columns).Single();
        Assert.Null(main.Animation);
        columns[0].Animation = "fx-ufo";
        main = Board.FlattenTickerCards(columns).Single();
        Assert.Equal("fx-ufo", main.Animation);
        Assert.Equal(12, main.FolderNr);
        Assert.Equal(2026, main.FolderAno);
        Assert.Equal("Ofício", main.Titulo);
        Assert.Equal("Cartaz", main.Produto);
        Assert.Equal("Gabinete 4", main.Solicitante);

        columns[0].Items =
        [
            new OsItem
            {
                NrOs = 99, Ano = 2026, RowKind = "sub_os", ParentNrOs = 568, ParentAno = 2026,
                Titulo = "Miolo", Produto = "Livro", Solicitante = "SECOM",
                UniqueKey = "568-2026-sub-1", DisplaySituacao = "[Miolo] Em Execução",
            },
        ];
        var sub = Board.FlattenTickerCards(columns).Single();
        Assert.True(sub.IsSubOs);
        Assert.Equal(568, sub.FolderNr);
        Assert.Equal(2026, sub.FolderAno);
        Assert.Equal("SECOM", sub.Solicitante);
    }

    [Fact]
    public void FlattenFiltersOsAndSpByNumber()
    {
        var columns = new List<BoardColumn>
        {
            new()
            {
                Id = "inbox",
                Title = "Inbox",
                Source = "inbox",
                Items =
                [
                    new OsItem { NrOs = 200, Ano = 2026, UniqueKey = "200-2026", DisplaySituacao = "Inbox OS" },
                    new OsItem { NrOs = 5000, Ano = 2026, UniqueKey = "5000-2026", DisplaySituacao = "Inbox SP" },
                ],
            },
            new()
            {
                Id = "exec",
                Title = "Execução",
                Items =
                [
                    new OsItem { NrOs = 100, Ano = 2026, UniqueKey = "100-2026", DisplaySituacao = "OS" },
                    new OsItem { NrOs = 5100, Ano = 2026, UniqueKey = "5100-2026", DisplaySituacao = "SP" },
                    new OsItem
                    {
                        NrOs = 1, Ano = 2026, RowKind = "sub_os", ParentNrOs = 5200, ParentAno = 2026,
                        UniqueKey = "5200-2026-sub-1", DisplaySituacao = "sub SP",
                    },
                ],
            },
        };
        var both = Board.FlattenTickerCards(columns, new BoardConfig { ShowOs = true, ShowSp = true });
        Assert.Equal(
            new[] { "OS 200/26", "SP 5000/26", "OS 100/26", "SP 5100/26", "SP 5200/26" },
            both.Select(c => c.Label).ToArray());

        var osOnly = Board.FlattenTickerCards(columns, new BoardConfig { ShowOs = true, ShowSp = false });
        Assert.Equal(new[] { "OS 200/26", "OS 100/26" }, osOnly.Select(c => c.Label).ToArray());

        var spOnly = Board.FlattenTickerCards(columns, new BoardConfig { ShowOs = false, ShowSp = true });
        Assert.Equal(
            new[] { "SP 5000/26", "SP 5100/26", "SP 5200/26" },
            spOnly.Select(c => c.Label).ToArray());
    }

    [Fact]
    public void NormalizeTreatsBothProtocolFiltersOffAsBothOn()
    {
        var cfg = ConfigStore.Normalize(new AppConfig
        {
            Board = new BoardConfig { ShowOs = false, ShowSp = false, Columns = ConfigStore.DefaultBoard().Columns },
        });
        Assert.True(cfg.Board.ShowOs);
        Assert.True(cfg.Board.ShowSp);

        var osOnly = ConfigStore.Normalize(new AppConfig
        {
            Board = new BoardConfig { ShowOs = true, ShowSp = false, Columns = ConfigStore.DefaultBoard().Columns },
        });
        Assert.True(osOnly.Board.ShowOs);
        Assert.False(osOnly.Board.ShowSp);
    }

    [Fact]
    public void FolderPathRejectsBackendErrorStrings()
    {
        Assert.True(OsFolderPath.IsUsable(@"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\01234 - x"));
        Assert.False(OsFolderPath.IsUsable(""));
        Assert.False(OsFolderPath.IsUsable("Pasta não encontrada na rede."));
        Assert.False(OsFolderPath.IsUsable("Erro: timeout"));
    }

    [Fact]
    public void DateBrMatchesHomePanel()
    {
        Assert.Equal("02/09/2026", OsDisplay.DateBr("2026-09-02"));
        Assert.Equal("02/09/2026", OsDisplay.DateBr("2026-09-02T00:00:00"));
        Assert.Equal("", OsDisplay.DateBr(null));
        Assert.True(OsDisplay.ToCheck(1));
        Assert.True(OsDisplay.ToCheck("Sim"));
        Assert.False(OsDisplay.ToCheck(0));
        Assert.Equal("Couché\n90g", OsDisplay.JoinLines("Couché", "90g"));
    }

    [Fact]
    public void TickerContentOverflowsOnlyWhenCardsDoNotFit()
    {
        Assert.False(Board.TickerContentOverflows([80, 80], 8, 720));
        Assert.True(Board.TickerContentOverflows([400, 400], 8, 720));
        Assert.False(Board.TickerContentOverflows([], 8, 720));
    }

    [Fact]
    public void FlattenKeepsOriginalColumnIndexWhenFirstHidden()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "empty", Title = "Vazia", Statuses = ["Recebido"], HideWhenEmpty = true },
                new() { Id = "exec", Title = "Execução", Statuses = ["Em Execução"] },
            ],
        };
        var raw = new List<OsItem> { new() { NrOs = 9, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" } };
        var processed = Board.ProcessDashboardData(raw, config, new(), isInitialLoad: true);
        var cards = Board.FlattenTickerCards(processed.Columns);
        Assert.Single(cards);
        Assert.Equal(1, cards[0].ColumnIndex);
        Assert.Equal("Execução", cards[0].ColumnTitle);
    }

    [Fact]
    public void ResolvePriorityTypeNone()
    {
        Assert.Null(Board.ResolvePriorityType(null));
        Assert.Null(Board.ResolvePriorityType("Normal"));
    }

    [Fact]
    public void NormalizeConfigDefaultsAndInbox()
    {
        var cfg = ConfigStore.Normalize(new AppConfig
        {
            Board = new BoardConfig
            {
                Sector = "Papelaria",
                Columns = [new BoardColumn { Title = "Inbox", Source = "inbox", Sector = "SEFOC", Statuses = [] }],
            },
        });
        Assert.Equal("Papelaria", cfg.Board.Sector);
        Assert.Equal(1, cfg.Board.ColumnCount);
        Assert.Equal("inbox", cfg.Board.Columns[0].Source);
        Assert.Equal("SEFOC", cfg.Board.Columns[0].Sector);
        Assert.Equal(720, cfg.Window.Width);
        Assert.False(cfg.Window.TransparentBg);
        Assert.False(cfg.Window.NotificationsEnabled);
        Assert.False(cfg.Board.Columns[0].Notify);
        Assert.True(string.IsNullOrEmpty(cfg.Board.Columns[0].Ponto));
        Assert.True(string.IsNullOrEmpty(cfg.Board.Columns[0].Observacao));
        Assert.True(string.IsNullOrEmpty(cfg.Board.Columns[0].Animation));
        Assert.Equal(ArrivalNotify.DefaultCardWidth, cfg.Window.NotificationWidth);
        Assert.Equal(ArrivalNotify.DefaultCardHeight, cfg.Window.NotificationHeight);
        Assert.Equal(ArrivalNotify.DefaultTitleFontSize, cfg.Window.NotificationTitleFontSize);
        Assert.Equal(ArrivalNotify.DefaultSituationFontSize, cfg.Window.NotificationSituationFontSize);
        Assert.Equal(ArrivalNotify.DefaultPadX, cfg.Window.NotificationPadX);
        Assert.Equal(ArrivalNotify.DefaultTextGap, cfg.Window.NotificationTextGap);
        Assert.Equal(ArrivalNotify.DefaultOffsetRight, cfg.Window.NotificationOffsetRight);
        Assert.Equal(ArrivalNotify.DefaultOffsetBottom, cfg.Window.NotificationOffsetBottom);
        Assert.Equal(ArrivalNotify.DefaultAnimation, cfg.Window.NotificationAnimation);
        Assert.Equal(ConfigStore.ProductionApiBase, cfg.ApiBaseUrl);
        Assert.Equal(ConfigStore.DefaultPonto, cfg.Ponto);
        Assert.Equal(ConfigStore.DefaultNome, cfg.Nome);
        Assert.True(cfg.Board.ShowOs);
        Assert.True(cfg.Board.ShowSp);
        Assert.True(ConfigStore.Normalize(new AppConfig { Window = new WindowConfig { TransparentBg = true } }).Window.TransparentBg);
    }

    [Fact]
    public void NormalizeColumnKeepsPontoObservacaoAndKnownAnimation()
    {
        var cfg = ConfigStore.Normalize(new AppConfig
        {
            Board = new BoardConfig
            {
                Columns =
                [
                    new BoardColumn
                    {
                        Title = "Execução",
                        Statuses = ["Em Execução"],
                        Notify = true,
                        Ponto = " 12.345 ",
                        Observacao = " urgente ",
                        Animation = "fx-ufo",
                    },
                    new BoardColumn { Title = "Outro", Statuses = ["Recebido"], Animation = "fx-mercury" },
                ],
            },
        });
        Assert.Equal("12.345", cfg.Board.Columns[0].Ponto);
        Assert.Equal("urgente", cfg.Board.Columns[0].Observacao);
        Assert.Equal("fx-ufo", cfg.Board.Columns[0].Animation);
        Assert.True(string.IsNullOrEmpty(cfg.Board.Columns[1].Animation));
    }

    [Fact]
    public void NormalizeApiBaseUrlAcceptsSiteRoot()
    {
        Assert.Equal(ConfigStore.ProductionApiBase, ConfigStore.NormalizeApiBaseUrl(""));
        Assert.Equal(ConfigStore.ProductionApiBase, ConfigStore.NormalizeApiBaseUrl("https://cgrafsysvm.redecamara.camara.gov.br/sagra"));
        Assert.Equal(ConfigStore.ProductionApiBase, ConfigStore.NormalizeApiBaseUrl("https://cgrafsysvm.redecamara.camara.gov.br/sagra/"));
        Assert.Equal(ConfigStore.ProductionApiBase, ConfigStore.NormalizeApiBaseUrl("https://cgrafsysvm.redecamara.camara.gov.br/sagra/api/"));
        Assert.Equal("http://127.0.0.1:8001/api", ConfigStore.NormalizeApiBaseUrl("http://127.0.0.1:8001/api"));
    }

    [Fact]
    public void NormalizeBoardKeepsManyFilters()
    {
        var columns = Enumerable.Range(0, 12)
            .Select(i => new BoardColumn { Id = $"col_{i}", Title = $"F{i}", Statuses = [$"S{i}"] })
            .ToList();
        var board = ConfigStore.NormalizeBoard(new BoardConfig { Columns = columns });
        Assert.Equal(12, board.Columns.Count);
    }

    [Fact]
    public void RestrictConnectionKeepsPreviousWhenUserCannotEdit()
    {
        var previous = ConfigStore.Normalize(new AppConfig { Ponto = "654321", Nome = "usr_sefoc" });
        var incoming = ConfigStore.Normalize(new AppConfig
        {
            Ponto = "999",
            Nome = "outro",
            ApiBaseUrl = "http://127.0.0.1:8001/api",
            Board = new BoardConfig { Sector = "Papelaria" },
        });
        var userSave = ConfigStore.RestrictConnectionToPrevious(incoming, previous, allowConnectionEdit: false);
        Assert.Equal(previous.Ponto, userSave.Ponto);
        Assert.Equal(previous.Nome, userSave.Nome);
        Assert.Equal(previous.ApiBaseUrl, userSave.ApiBaseUrl);
        Assert.Equal("Papelaria", userSave.Board.Sector);

        var adminSave = ConfigStore.RestrictConnectionToPrevious(incoming, previous, allowConnectionEdit: true);
        Assert.Equal("999", adminSave.Ponto);
        Assert.Equal("outro", adminSave.Nome);
    }

    [Fact]
    public void CardWidthFitsTheWiderLineAndKeepsPadding()
    {
        Assert.Equal(176, CardMetrics.MinActionWidth);
        var width = CardMetrics.Width(labelWidth: 90, situacaoWidth: 140);
        Assert.Equal(140 + CardMetrics.PadX, width, 3);
        Assert.Equal(140, CardMetrics.TextInner(width), 3);
        var capped = CardMetrics.Width(40, 800);
        Assert.Equal(CardMetrics.MaxWidth, capped, 3);
        Assert.True(CardMetrics.TextInner(capped) >= CardMetrics.MinInner);
    }

    [Fact]
    public void CardFontSizesStaySharedBetweenMeasureAndPaint()
    {
        var (label, sit) = CardMetrics.FontSizes(48);
        Assert.True(label >= sit);
        Assert.True(label < 48);
        Assert.True(sit >= 8);
    }

    [Fact]
    public void RtlPlacesFirstCardOnTheRightWhenNotScrolling()
    {
        var cards = new[]
        {
            new TickerCard { Label = "A" },
            new TickerCard { Label = "B" },
        };
        var placed = TickerLayout.PlaceRtl(cards, [40, 50], canvasWidth: 200, offset: 0, scroll: false);
        Assert.Equal(2, placed.Count);
        Assert.Equal("A", placed[0].Card.Label);
        Assert.True(placed[0].X > placed[1].X);
        Assert.Equal(200 - TickerLayout.Pad - 40, placed[0].X, 3);
    }

    [Fact]
    public void RtlMarqueeMovesLeftAsOffsetGrows()
    {
        var cards = new[] { new TickerCard { Label = "A" } };
        var a = TickerLayout.PlaceRtl(cards, [40], 200, offset: 0, scroll: true);
        var b = TickerLayout.PlaceRtl(cards, [40], 200, offset: 10, scroll: true);
        var firstA = a.First(p => p.Card.Label == "A" && p.X < 200);
        var firstB = b.First(p => p.Card.Label == "A" && p.X < 200);
        Assert.True(firstB.X < firstA.X);
    }

    [Fact]
    public void SplitByPriorityOrdersPrometidoThenSolicitadoThenNormal()
    {
        var cards = new[]
        {
            new TickerCard { Label = "N1", Priority = null },
            new TickerCard { Label = "S1", Priority = "priority-medium" },
            new TickerCard { Label = "P1", Priority = "priority-high" },
            new TickerCard { Label = "N2" },
            new TickerCard { Label = "S2", Priority = "priority-medium" },
            new TickerCard { Label = "P2", Priority = "priority-high" },
        };
        double[] widths = [10, 11, 12, 13, 14, 15];
        var split = TickerLayout.SplitByPriority(cards, widths);
        Assert.Equal(new[] { "P1", "P2", "S1", "S2" }, split.Pinned.Select(c => c.Label).ToArray());
        Assert.Equal(new[] { 12d, 15d, 11d, 14d }, split.PinnedWidths.ToArray());
        Assert.Equal(new[] { "N1", "N2" }, split.Rotating.Select(c => c.Label).ToArray());
        Assert.Equal(new[] { 10d, 13d }, split.RotatingWidths.ToArray());
    }

    [Fact]
    public void ActionOverlayCardsPinOnTheRightLikePriority()
    {
        Assert.True(ArrivalNotify.IsActionOverlay("fx-analisar"));
        Assert.True(ArrivalNotify.IsActionOverlay("fx-prosseguir"));
        Assert.False(ArrivalNotify.IsActionOverlay("fx-ufo"));
        Assert.False(ArrivalNotify.IsActionOverlay(null));
        var cards = new[]
        {
            new TickerCard { Label = "N" },
            new TickerCard { Label = "A", Animation = "fx-analisar" },
            new TickerCard { Label = "P", Priority = "priority-high" },
            new TickerCard { Label = "F", Animation = "fx-prosseguir" },
        };
        double[] widths = [40, 80, 50, 90];
        var split = TickerLayout.SplitByPriority(cards, widths);
        Assert.Equal(new[] { "P", "A", "F" }, split.Pinned.Select(c => c.Label).ToArray());
        Assert.Equal(new[] { "N" }, split.Rotating.Select(c => c.Label).ToArray());
        Assert.True(TickerLayout.IsPinnedPriority(cards[1]));
        Assert.True(TickerLayout.IsPinnedPriority(cards[3]));
        var placed = TickerLayout.PlaceCarousel(cards, widths, canvasWidth: 320, offset: 0, overflow: true);
        var p = placed.Single(c => c.Card.Label == "P");
        var a = placed.Single(c => c.Card.Label == "A");
        var f = placed.Single(c => c.Card.Label == "F");
        Assert.Equal(320 - TickerLayout.Pad - 50, p.X, 3);
        Assert.Equal(p.X - TickerLayout.Gap - 80, a.X, 3);
        Assert.Equal(a.X - TickerLayout.Gap - 90, f.X, 3);
        Assert.True(placed.Single(c => c.Card.Label == "N").X + 40 <= f.X + 0.01);
    }

    [Fact]
    public void CarouselPinsPriorityRightAndKeepsNormalsToTheLeft()
    {
        var cards = new[]
        {
            new TickerCard { Label = "N", Priority = null },
            new TickerCard { Label = "S", Priority = "priority-medium" },
            new TickerCard { Label = "P", Priority = "priority-high" },
        };
        double[] widths = [40, 50, 60];
        var placed = TickerLayout.PlaceCarousel(cards, widths, canvasWidth: 200, offset: 0, overflow: true);
        var p = placed.Single(c => c.Card.Label == "P");
        var s = placed.Single(c => c.Card.Label == "S");
        var n = placed.Single(c => c.Card.Label == "N");
        Assert.Equal(200 - TickerLayout.Pad - 60, p.X, 3);
        Assert.Equal(p.X - TickerLayout.Gap - 50, s.X, 3);
        Assert.True(n.X + n.Width <= s.X + 0.01);
        Assert.True(s.X + s.Width <= p.X + 0.01);
    }

    [Fact]
    public void CarouselOffsetMovesOnlyNormalCards()
    {
        var cards = new[]
        {
            new TickerCard { Label = "N1" },
            new TickerCard { Label = "N2" },
            new TickerCard { Label = "P", Priority = "priority-high" },
        };
        double[] widths = [80, 80, 50];
        var a = TickerLayout.PlaceCarousel(cards, widths, 200, offset: 0, overflow: true);
        var b = TickerLayout.PlaceCarousel(cards, widths, 200, offset: 20, overflow: true);
        Assert.Equal(a.Single(c => c.Card.Label == "P").X, b.Single(c => c.Card.Label == "P").X, 3);
        var nA = a.Where(c => c.Card.Label == "N1").Min(c => c.X);
        var nB = b.Where(c => c.Card.Label == "N1").Min(c => c.X);
        Assert.True(nB < nA);
    }

    [Fact]
    public void CarouselKeepsPartialRotatingCardsBehindPins()
    {
        var cards = new[]
        {
            new TickerCard { Label = "N1" },
            new TickerCard { Label = "N2" },
            new TickerCard { Label = "P", Priority = "priority-high" },
        };
        double[] widths = [80, 80, 50];
        var placed = TickerLayout.PlaceCarousel(cards, widths, 200, offset: 0, overflow: true);
        var remaining = 200 - TickerLayout.PinnedReserve([50]);
        var n1 = placed.Where(c => c.Card.Label == "N1").ToList();
        Assert.NotEmpty(n1);
        Assert.Contains(n1, p => p.X + p.Width > remaining);
        Assert.Contains(placed, c => c.Card.Label == "P" && TickerLayout.IsPinnedPriority(c.Card));
    }

    [Fact]
    public void CarouselWithoutOverflowKeepsRtlPack()
    {
        var cards = new[]
        {
            new TickerCard { Label = "A" },
            new TickerCard { Label = "B", Priority = "priority-high" },
        };
        var rtl = TickerLayout.PlaceRtl(cards, [40, 50], 200, 0, scroll: false);
        var carousel = TickerLayout.PlaceCarousel(cards, [40, 50], 200, 0, overflow: false);
        Assert.Equal(rtl.Select(c => (c.Card.Label, c.X)), carousel.Select(c => (c.Card.Label, c.X)));
    }

    [Fact]
    public void RotatingNeedsMarqueeIgnoresPinnedWidth()
    {
        var cards = new[]
        {
            new TickerCard { Label = "P", Priority = "priority-high" },
            new TickerCard { Label = "N" },
        };
        Assert.False(TickerLayout.RotatingNeedsMarquee(cards, [40, 40], 200));
        Assert.True(TickerLayout.RotatingNeedsMarquee(
            [
                new TickerCard { Label = "P", Priority = "priority-high" },
                new TickerCard { Label = "N1" },
                new TickerCard { Label = "N2" },
            ],
            [40, 90, 90],
            200));
    }

    static OsItem CloneSub(int pcpOrdem)
    {
        var item = SubOs.Clone();
        item.PcpOrdem = pcpOrdem;
        return item;
    }
}

public class LetreiroAdminTests
{
    [Fact]
    public void MatchesAdminSamWithOrWithoutDomain()
    {
        Assert.True(LetreiroAdmin.Matches("P_918713"));
        Assert.True(LetreiroAdmin.Matches(@"REDECAMARA\P_918713"));
        Assert.True(LetreiroAdmin.Matches("redecamara/p_918713"));
        Assert.False(LetreiroAdmin.Matches("outro"));
        Assert.True(LetreiroAdmin.IsAdmin("P_918713", @"REDECAMARA\P_918713"));
        Assert.False(LetreiroAdmin.IsAdmin("fulano", @"REDECAMARA\fulano"));
    }

    [Fact]
    public void RemoteScriptBatUsesCmd()
    {
        var launch = RemoteScript.BuildLaunch("bat");
        Assert.Equal("cmd.exe", launch.FileName);
        Assert.Equal(["/c"], launch.Arguments);
        Assert.Equal(".bat", launch.Extension);
    }

    [Fact]
    public void CommandPollClampUsesDefaultAndBounds()
    {
        Assert.Equal(10, LetreiroCommandPoll.Clamp(0));
        Assert.Equal(1, LetreiroCommandPoll.Clamp(1));
        Assert.Equal(120, LetreiroCommandPoll.Clamp(500));
    }

    [Fact]
    public void RemoteScriptPs1UsesPowerShellFile()
    {
        var launch = RemoteScript.BuildLaunch("ps1");
        Assert.Equal("powershell.exe", launch.FileName);
        Assert.Contains("-File", launch.Arguments);
        Assert.Contains("-NoProfile", launch.Arguments);
        Assert.Equal(".ps1", launch.Extension);
    }

    [Fact]
    public void MergeRemoteKeepsLocalPositionAndAppliesRemoteDisplay()
    {
        var local = ConfigStore.Normalize(new AppConfig
        {
            Ponto = "1",
            Window = new WindowConfig { X = 40, Width = 900, Opacity = 0.5, SpeedPxPerSec = 20 },
        });
        var remote = ConfigStore.Normalize(new AppConfig
        {
            Ponto = "99",
            Password = "segredo",
            Board = new BoardConfig
            {
                Sector = "Papelaria",
                ShowOs = true,
                ShowSp = false,
                Columns =
                [
                    new BoardColumn { Id = "col_0", Title = "Em Execução", Statuses = ["Em Execução"], Sector = "Papelaria" },
                ],
            },
            Window = new WindowConfig { X = 8, Width = 400, Opacity = 0.8, SpeedPxPerSec = 60, TransparentBg = true, NotificationsEnabled = true, NotificationWidth = 480, NotificationHeight = 120, NotificationTitleFontSize = 28, NotificationSituationFontSize = 16, NotificationPadX = 20, NotificationTextGap = 8, NotificationOffsetRight = 40, NotificationOffsetBottom = 64 },
        });
        var merged = ConfigStore.MergeRemote(local, remote);
        Assert.Equal(40, merged.Window.X);
        Assert.Equal(400, merged.Window.Width);
        Assert.Equal(0.8, merged.Window.Opacity);
        Assert.Equal(60, merged.Window.SpeedPxPerSec);
        Assert.True(merged.Window.TransparentBg);
        Assert.True(merged.Window.NotificationsEnabled);
        Assert.True(merged.Board.Columns[0].Notify);
        Assert.Equal(480, merged.Window.NotificationWidth);
        Assert.Equal(120, merged.Window.NotificationHeight);
        Assert.Equal(28, merged.Window.NotificationTitleFontSize);
        Assert.Equal(16, merged.Window.NotificationSituationFontSize);
        Assert.Equal(20, merged.Window.NotificationPadX);
        Assert.Equal(8, merged.Window.NotificationTextGap);
        Assert.Equal(40, merged.Window.NotificationOffsetRight);
        Assert.Equal(64, merged.Window.NotificationOffsetBottom);
        Assert.Equal("99", merged.Ponto);
        Assert.Equal("segredo", merged.Password);
        Assert.Equal("Papelaria", merged.Board.Sector);
        Assert.False(merged.Board.ShowSp);
        Assert.Single(merged.Board.Columns);
        Assert.Equal("Em Execução", merged.Board.Columns[0].Title);
        var remoteOnly = ConfigStore.ForRemote(merged);
        Assert.Null(remoteOnly.Window.X);
        Assert.Equal(400, remoteOnly.Window.Width);
        Assert.True(remoteOnly.Window.NotificationsEnabled);
        Assert.Equal(480, remoteOnly.Window.NotificationWidth);
        Assert.Equal(120, remoteOnly.Window.NotificationHeight);
        Assert.Equal(28, remoteOnly.Window.NotificationTitleFontSize);
        Assert.Equal(16, remoteOnly.Window.NotificationSituationFontSize);
        Assert.Equal(20, remoteOnly.Window.NotificationPadX);
        Assert.Equal(8, remoteOnly.Window.NotificationTextGap);
        Assert.Equal(40, remoteOnly.Window.NotificationOffsetRight);
        Assert.Equal(64, remoteOnly.Window.NotificationOffsetBottom);
    }

    [Fact]
    public void ProcessDashboardDataTracksFirstSeenArrivalsOnly()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "rec", Title = "Recebido", Statuses = ["Recebido"], Notify = true },
                new() { Id = "exec", Title = "Execução", Statuses = ["Em Execução"], Notify = true },
            ],
        };
        var master = new Dictionary<string, OsItem>();
        var first = new OsItem { NrOs = 10, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" };
        var initial = Board.ProcessDashboardData([first], config, master, isInitialLoad: true);
        Assert.Empty(initial.NewArrivalKeys);
        Assert.False(initial.HasNewItems);

        var same = Board.ProcessDashboardData([first], config, master, isInitialLoad: false);
        Assert.Empty(same.NewArrivalKeys);

        var extra = new OsItem { NrOs = 11, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" };
        var arrived = Board.ProcessDashboardData([first, extra], config, master, isInitialLoad: false);
        Assert.Equal(new[] { "11-2026" }, arrived.NewArrivalKeys);
        Assert.True(arrived.HasNewItems);

        var moved = new OsItem { NrOs = 10, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" };
        var columnChange = Board.ProcessDashboardData([moved, extra], config, master, isInitialLoad: false);
        Assert.Equal(new[] { "10-2026" }, columnChange.NewArrivalKeys);
        Assert.True(columnChange.HasNewItems);
    }

    [Fact]
    public void ProcessDashboardDataNotifiesOnlyMarkedFilters()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns =
            [
                new() { Id = "rec", Title = "Recebido", Statuses = ["Recebido"], Notify = false },
                new() { Id = "exec", Title = "Execução", Statuses = ["Em Execução"], Notify = true },
            ],
        };
        var master = new Dictionary<string, OsItem>();
        Board.ProcessDashboardData(
            [new OsItem { NrOs = 10, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" }],
            config, master, isInitialLoad: true);
        var quiet = Board.ProcessDashboardData(
            [
                new() { NrOs = 10, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" },
                new() { NrOs = 11, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" },
            ],
            config, master, isInitialLoad: false);
        Assert.Empty(quiet.NewArrivalKeys);

        var loud = Board.ProcessDashboardData(
            [
                new() { NrOs = 10, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" },
                new() { NrOs = 11, Ano = 2026, Situacao = "Recebido", Setor = "SEFOC" },
                new() { NrOs = 12, Ano = 2026, Situacao = "Em Execução", Setor = "SEFOC" },
            ],
            config, master, isInitialLoad: false);
        Assert.Equal(new[] { "12-2026" }, loud.NewArrivalKeys);
    }

    [Fact]
    public void ProcessDashboardDataNotifiesNewInboxWhenMarked()
    {
        var config = new BoardConfig
        {
            Sector = "SEFOC",
            Columns = [new() { Id = "in", Title = "Inbox", Source = "inbox", Notify = true }],
        };
        var seen = new HashSet<string>();
        var master = new Dictionary<string, OsItem>();
        var initial = Board.ProcessDashboardData(
            [], config, master, isInitialLoad: true,
            inboxOs: [new InboxRef { Os = 1, Ano = 2026 }], inboxSeen: seen);
        Assert.Empty(initial.NewArrivalKeys);

        var next = Board.ProcessDashboardData(
            [], config, master, isInitialLoad: false,
            inboxOs: [new InboxRef { Os = 1, Ano = 2026 }, new InboxRef { Os = 2, Ano = 2026 }],
            inboxSeen: seen);
        Assert.Equal(new[] { "inbox:2-2026" }, next.NewArrivalKeys);
    }

    [Fact]
    public void NormalizeMigratesLegacyNotificationsEnabledToColumnNotify()
    {
        var cfg = ConfigStore.Normalize(new AppConfig
        {
            Window = new WindowConfig { NotificationsEnabled = true },
            Board = new BoardConfig
            {
                Columns = [new BoardColumn { Title = "Recebido", Statuses = ["Recebido"] }],
            },
        });
        Assert.True(cfg.Board.Columns[0].Notify);
        Assert.True(cfg.Window.NotificationsEnabled);
    }

    [Fact]
    public void ArrivalNotifyHidesHeldKeysFromTicker()
    {
        var cards = new List<TickerCard>
        {
            new() { UniqueKey = "a-2026", Label = "A" },
            new() { UniqueKey = "b-2026", Label = "B" },
        };
        var visible = ArrivalNotify.VisibleOnTicker(cards, new HashSet<string> { "a-2026" });
        Assert.Single(visible);
        Assert.Equal("b-2026", visible[0].UniqueKey);
        Assert.Equal(ArrivalNotify.PreviewKey, ArrivalNotify.PreviewCard().UniqueKey);
        var layout = ArrivalNotify.Layout(320, 96);
        Assert.Equal(320, layout.CardWidth);
        Assert.Equal(96, layout.CardHeight);
        Assert.Equal(8, layout.EnterTravel);
        Assert.True(layout.SidePad <= 24);
        Assert.InRange(layout.WindowWidth - layout.CardWidth, 24, 48);
        Assert.True(layout.WindowHeight - layout.CardHeight < 130);
        var huge = ArrivalNotify.Layout(3200, 960);
        Assert.Equal(900, huge.CardWidth);
        Assert.Equal(280, huge.CardHeight);
        Assert.True(huge.WindowWidth < huge.CardWidth * 1.2);
        Assert.Equal(15, ArrivalNotify.ClassicEntries.Length);
        Assert.Equal("fx-iris", ArrivalNotify.ClampAnimation(null));
        Assert.Equal("fx-warp", ArrivalNotify.ClampAnimation("fx-warp"));
        Assert.Equal("fx-ufo", ArrivalNotify.ClampAnimation("fx-ufo"));
        Assert.Equal("fx-analisar", ArrivalNotify.ClampAnimation("fx-analisar"));
        Assert.Equal("fx-prosseguir", ArrivalNotify.ClampAnimation("fx-prosseguir"));
        Assert.Equal("fx-iris", ArrivalNotify.ClampAnimation("fx-mercury"));
        Assert.Equal("", ArrivalNotify.ClampColumnAnimation(null));
        Assert.Equal("", ArrivalNotify.ClampColumnAnimation("fx-mercury"));
        Assert.Equal("fx-ufo", ArrivalNotify.ClampColumnAnimation("fx-ufo"));
        Assert.Equal("fx-analisar", ArrivalNotify.ClampColumnAnimation("fx-analisar"));
        var ufo = ArrivalNotify.Layout(320, 96, "fx-ufo");
        Assert.True(ufo.EnterTravel >= 130);
        Assert.True(ufo.SidePad >= 88);
        Assert.True(ufo.WindowHeight > layout.WindowHeight);
        var analisar = ArrivalNotify.Layout(320, 96, "fx-analisar");
        Assert.True(analisar.SidePad >= 96);
        Assert.True(analisar.EnterTravel >= 48);
        var follow = ArrivalNotify.Layout(320, 96, "fx-prosseguir");
        Assert.True(follow.SidePad >= 72);
        Assert.Equal(110, follow.EnterTravel);
        Assert.Equal(120, follow.ExitTravel);
        Assert.Equal(180, ArrivalNotify.ClampCardWidth(10));
        Assert.Equal(900, ArrivalNotify.ClampCardWidth(9_999));
        Assert.Equal(56, ArrivalNotify.ClampCardHeight(1));
        Assert.Equal(280, ArrivalNotify.ClampCardHeight(9_999));
        Assert.Equal(320, ArrivalNotify.ClampCardWidth(0));
        Assert.Equal(96, ArrivalNotify.ClampCardHeight(0));
        Assert.Equal(22, ArrivalNotify.ClampTitleFontSize(0));
        Assert.Equal(14, ArrivalNotify.ClampSituationFontSize(0));
        Assert.Equal(10, ArrivalNotify.ClampTitleFontSize(1));
        Assert.Equal(72, ArrivalNotify.ClampTitleFontSize(9_999));
        Assert.Equal(8, ArrivalNotify.ClampSituationFontSize(1));
        Assert.Equal(56, ArrivalNotify.ClampSituationFontSize(9_999));
        Assert.Equal(28, ArrivalNotify.ClampTitleFontSize(28));
        Assert.Equal(16, ArrivalNotify.ClampSituationFontSize(16));
        Assert.Equal(16, ArrivalNotify.ClampPadX(0));
        Assert.Equal(4, ArrivalNotify.ClampPadX(1));
        Assert.Equal(48, ArrivalNotify.ClampPadX(9_999));
        Assert.Equal(4, ArrivalNotify.ClampTextGap(null));
        Assert.Equal(0, ArrivalNotify.ClampTextGap(0));
        Assert.Equal(40, ArrivalNotify.ClampTextGap(9_999));
        Assert.Equal(24, ArrivalNotify.ClampOffsetRight(null));
        Assert.Equal(0, ArrivalNotify.ClampOffsetRight(0));
        Assert.Equal(1200, ArrivalNotify.ClampOffsetBottom(9_999));
        Assert.Equal("", ArrivalNotify.ClampPriority(null));
        Assert.Equal("priority-high", ArrivalNotify.ClampPriority("priority-high"));
        Assert.Equal("priority-medium", ArrivalNotify.ClampPriority("priority-medium"));
        using var preset = JsonDocument.Parse("""
            {"cardStyle":{"entryAnimation":"fx-mercury","models":{"high":{"colors":{"bg":"#b91c1c","accent":"#fde047"}}},"typography":{"titleColor":"#fff7ed"}}}
            """);
        var visual = ArrivalNotify.VisualFromPreset(preset.RootElement, 7, "TV SEFOC");
        Assert.Equal(7, visual.PresetId);
        Assert.Equal("TV SEFOC", visual.PresetName);
        Assert.Equal("#b91c1c", visual.High.Bg);
        Assert.Equal("#fff7ed", visual.High.Title);
        Assert.Equal("", visual.Normal.Bg);
        using var effectOnly = JsonDocument.Parse("""
            {"cardStyle":{"models":{"high":{"effect":"v80"},"normal":{"effect":"mod-terminal"}}}}
            """);
        var fromEffect = ArrivalNotify.VisualFromPreset(effectOnly.RootElement, 2, "Giroflex");
        Assert.Equal("v80", fromEffect.High.Effect);
        Assert.Equal("#18181b", fromEffect.High.Bg);
        Assert.Equal("#ffffff", fromEffect.High.Border);
        Assert.Equal("#10b981", fromEffect.High.Accent);
        Assert.Equal("#05100a", fromEffect.Normal.Bg);
        Assert.True(ArrivalNotify.UsesCatalog(fromEffect));
        using var full = JsonDocument.Parse("""
            {"cardStyle":{"entryAnimation":"fx-mercury","models":{"high":{"effect":"v80","highlight":"fx-tesla","colors":{"bg":"#111111","extra":"#23d5ab"},"highlightColors":{"accent":"#00ffff"}}},"typography":{"fontFamily":"Orbitron, sans-serif","fontScale":1.2,"letterSpacing":-0.04}}}
            """);
        var catalog = ArrivalNotify.VisualFromPreset(full.RootElement, 9, "TV");
        Assert.Equal("v80", catalog.High.Effect);
        Assert.Equal("fx-tesla", catalog.High.Highlight);
        Assert.Equal("#23d5ab", catalog.High.Extra);
        Assert.Equal("#00ffff", catalog.High.HighlightAccent);
        Assert.Equal("Orbitron, sans-serif", catalog.FontFamily);
        Assert.Equal(1.2, catalog.FontScale);
        Assert.DoesNotContain("fx-mercury", catalog.High.Effect);
        var html = ArrivalToastHtml.Build(
            new TickerCard { Label = "OS 10/26", Situacao = "Em Execução", Priority = "priority-high" },
            catalog, 22, 14);
        Assert.Contains("data-model=\"v80\"", html);
        Assert.Contains("data-highlight=\"fx-tesla\"", html);
        Assert.Contains("--cm-extra:#23d5ab", html);
        Assert.Contains("Orbitron", html);
        Assert.Contains("fonts.googleapis.com", html);
        Assert.Contains("catalog-loop-ok", ArrivalToastHtml.Css());
        Assert.DoesNotContain(
            "container-type: size;\n  animation: none !important",
            ArrivalToastHtml.Css().Replace("\r\n", "\n"));
        var articleAt = html.IndexOf("<article", StringComparison.Ordinal);
        var articleEnd = html.IndexOf('>', articleAt);
        Assert.DoesNotContain("data-entry", html[articleAt..(articleEnd + 1)]);
        Assert.Contains("smc-strobe", ArrivalToastHtml.Css());
        Assert.Contains("fx-tesla", ArrivalToastHtml.Css());
        Assert.Null(ArrivalNotify.PreviewCard().Priority);
        Assert.Equal("Teste · normal", ArrivalNotify.PreviewCard().Situacao);
        Assert.Equal("priority-high", ArrivalNotify.PreviewCard("priority-high").Priority);
        Assert.Equal("Teste · alta", ArrivalNotify.PreviewCard("priority-high").Situacao);
        Assert.Equal("priority-medium", ArrivalNotify.PreviewCard("priority-medium").Priority);
        var placed = ArrivalNotify.WindowOrigin(layout, 24, 48, 0, 0, 1920, 1080);
        Assert.Equal(1920 - 24 - layout.CardWidth - layout.SidePad, placed.Left);
        Assert.Equal(1080 - 48 - layout.CardHeight - layout.EnterSlack, placed.Top);
        var flush = ArrivalNotify.WindowOrigin(layout, 0, 0, 0, 0, 1920, 1080);
        Assert.Equal(1920 - layout.CardWidth - layout.SidePad, flush.Left);
        Assert.Equal(1080 - layout.CardHeight - layout.EnterSlack, flush.Top);
        var clamped = ArrivalNotify.WindowOrigin(layout, 9_999, 9_999, 0, 0, 1280, 720);
        Assert.Equal(-layout.SidePad, clamped.Left);
        Assert.Equal(-layout.EnterSlack, clamped.Top);
    }
}

public class ConfigProfilesTests
{
    [Fact]
    public void SnapshotDropsConnectionAndKeepsBoardWindow()
    {
        var snap = ConfigProfiles.Snapshot(new AppConfig
        {
            Ponto = "segredo",
            Nome = "usr",
            Password = "pwd",
            ApiBaseUrl = "http://127.0.0.1:8001/api",
            Board = new BoardConfig
            {
                Sector = "Papelaria",
                Columns = [new BoardColumn { Title = "Recebido", Statuses = ["Recebido"], Notify = true }],
            },
            Window = new WindowConfig { Width = 900, X = 40, NotificationPadX = 20, NotificationOffsetRight = 48 },
        });
        Assert.Equal("", snap.Password);
        Assert.NotEqual("segredo", snap.Ponto);
        Assert.Equal(900, snap.Window.Width);
        Assert.Null(snap.Window.X);
        Assert.Equal(20, snap.Window.NotificationPadX);
        Assert.Equal(48, snap.Window.NotificationOffsetRight);
        Assert.Equal("Papelaria", snap.Board.Sector);
        Assert.True(snap.Board.Columns[0].Notify);
    }

    [Fact]
    public void ApplyKeepsTargetConnectionAndBarPosition()
    {
        var target = ConfigStore.Normalize(new AppConfig
        {
            Ponto = "99",
            Nome = "destino",
            Password = "local",
            Window = new WindowConfig { X = 40, Width = 720 },
        });
        var profile = ConfigProfiles.Snapshot(new AppConfig
        {
            Ponto = "1",
            Window = new WindowConfig { Width = 400, Opacity = 0.8, NotificationOffsetBottom = 80 },
            Board = new BoardConfig
            {
                Sector = "Gravação",
                Columns = [new BoardColumn { Title = "Inbox", Source = "inbox", Notify = true }],
            },
        });
        var merged = ConfigProfiles.Apply(target, profile);
        Assert.Equal("99", merged.Ponto);
        Assert.Equal("destino", merged.Nome);
        Assert.Equal("local", merged.Password);
        Assert.Equal(40, merged.Window.X);
        Assert.Equal(400, merged.Window.Width);
        Assert.Equal(0.8, merged.Window.Opacity);
        Assert.Equal(80, merged.Window.NotificationOffsetBottom);
        Assert.Equal("Gravação", merged.Board.Sector);
        Assert.True(merged.Window.NotificationsEnabled);
    }

    [Fact]
    public void UpsertReplacesSameNameAndPersists()
    {
        var list = new List<ConfigProfile>();
        var first = ConfigProfiles.Upsert(list, " TV SEFOC ", new AppConfig { Window = new WindowConfig { Width = 500 } });
        Assert.Equal(1, first.Id);
        Assert.Equal("TV SEFOC", first.Name);
        var again = ConfigProfiles.Upsert(list, "tv sefoc", new AppConfig { Window = new WindowConfig { Width = 800 } });
        Assert.Equal(first.Id, again.Id);
        Assert.Equal("tv sefoc", again.Name);
        Assert.Single(list);
        Assert.Equal(800, list[0].Payload.Window.Width);
        Assert.Throws<ArgumentException>(() => ConfigProfiles.Upsert(list, "  ", new AppConfig()));
        var dir = Path.Combine(Path.GetTempPath(), "letreiro-profiles-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(dir, "profiles.json");
        try
        {
            ConfigProfiles.SaveTo(path, list);
            var loaded = ConfigProfiles.LoadFrom(path);
            Assert.Single(loaded);
            Assert.Equal("tv sefoc", loaded[0].Name);
            Assert.Equal(800, loaded[0].Payload.Window.Width);
            Assert.True(ConfigProfiles.Remove(loaded, loaded[0].Id));
            Assert.Empty(loaded);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}

public class OverlayBoundsTests
{
    [Fact]
    public void RightBoundStopsBeforeSystray()
    {
        var right = OverlayBounds.RightBound(0, 1920, notifyLeft: 1700);
        Assert.Equal(1700 - OverlayBounds.TrayGap, right);
        var (x, width) = OverlayBounds.ClampX(1600, 720, 0, right);
        Assert.True(x + width <= right);
        Assert.Equal(right - 720, x);
    }

    [Fact]
    public void RightBoundIgnoresNotifyOnTheLeftHalf()
    {
        Assert.Equal(1920, OverlayBounds.RightBound(0, 1920, notifyLeft: 200));
        Assert.Equal(1920, OverlayBounds.RightBound(0, 1920, notifyLeft: null));
    }

    [Fact]
    public void ClampXShrinksToFitLeftOfTray()
    {
        var right = OverlayBounds.RightBound(0, 800, notifyLeft: 500);
        var (x, width) = OverlayBounds.ClampX(0, 720, 0, right);
        Assert.Equal(0, x);
        Assert.Equal(500 - OverlayBounds.TrayGap, width);
        Assert.True(x + width <= right);
    }

    [Fact]
    public void PinRightDocksAgainstSystray()
    {
        var right = OverlayBounds.RightBound(0, 1920, notifyLeft: 1700);
        var (x, width) = OverlayBounds.PinRight(720, 0, right);
        Assert.Equal(720, width);
        Assert.Equal(right - 720, x);
        Assert.Equal(right, x + width);
    }

    [Fact]
    public void PinRightShrinksWhenBarIsShorterThanWidth()
    {
        var right = OverlayBounds.RightBound(0, 800, notifyLeft: 500);
        var (x, width) = OverlayBounds.PinRight(720, 0, right);
        Assert.Equal(0, x);
        Assert.Equal(right, width);
        Assert.Equal(right, x + width);
    }

    [Fact]
    public void NormalizeWindowClampsTypedWidth()
    {
        Assert.Equal(OverlayBounds.MinWidth, ConfigStore.NormalizeWindow(new WindowConfig { Width = 10 }).Width);
        Assert.Equal(OverlayBounds.MaxWidth, ConfigStore.NormalizeWindow(new WindowConfig { Width = 99_999 }).Width);
        Assert.Equal(900, ConfigStore.NormalizeWindow(new WindowConfig { Width = 900 }).Width);
    }
}

public class UpdateFinderTests
{
    [Fact]
    public void SetupNameMatchesVersionedInstaller()
    {
        Assert.Matches(UpdateFinder.SetupName, "SAGRA-Letreiro-Setup-2.0.0.exe");
        Assert.Matches(UpdateFinder.SetupName, "SAGRA-Letreiro-Setup-1.2.exe");
        Assert.DoesNotMatch(UpdateFinder.SetupName, "SAGRA-Letreiro.exe");
        Assert.DoesNotMatch(UpdateFinder.SetupName, "DesktopWidgets-Setup-1.0.0.exe");
    }

    [Fact]
    public void TryFindNewerSetupPicksHighestSemVer()
    {
        var dir = Path.Combine(Path.GetTempPath(), "letreiro-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllBytes(Path.Combine(dir, "SAGRA-Letreiro-Setup-1.9.0.exe"), [0]);
            File.WriteAllBytes(Path.Combine(dir, "SAGRA-Letreiro-Setup-2.1.0.exe"), [0]);
            File.WriteAllBytes(Path.Combine(dir, "SAGRA-Letreiro-Setup-2.0.5.exe"), [0]);
            Assert.True(UpdateFinder.TryFindNewerSetup(dir, new Version(2, 0, 0), out var path));
            Assert.Equal("SAGRA-Letreiro-Setup-2.1.0.exe", Path.GetFileName(path));
            Assert.False(UpdateFinder.TryFindNewerSetup(dir, new Version(2, 1, 0), out _));
            Assert.False(UpdateFinder.TryFindNewerSetup(dir + "-missing", new Version(1, 0, 0), out _));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void TryFindNewerSetupUsesFallbackWhenPrimaryMissing()
    {
        var root = Path.Combine(Path.GetTempPath(), "letreiro-update-fb-" + Guid.NewGuid().ToString("N"));
        var primary = Path.Combine(root, "primary");
        var fallback = Path.Combine(root, "fallback");
        Directory.CreateDirectory(fallback);
        try
        {
            File.WriteAllBytes(Path.Combine(fallback, "SAGRA-Letreiro-Setup-2.2.0.exe"), [0]);
            Assert.True(UpdateFinder.TryFindNewerSetup([primary, fallback], new Version(2, 0, 0), out var path));
            Assert.Equal("SAGRA-Letreiro-Setup-2.2.0.exe", Path.GetFileName(path));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void TryFindNewerSetupKeepsPrimaryWhenItExists()
    {
        var root = Path.Combine(Path.GetTempPath(), "letreiro-update-pri-" + Guid.NewGuid().ToString("N"));
        var primary = Path.Combine(root, "primary");
        var fallback = Path.Combine(root, "fallback");
        Directory.CreateDirectory(primary);
        Directory.CreateDirectory(fallback);
        try
        {
            File.WriteAllBytes(Path.Combine(primary, "SAGRA-Letreiro-Setup-2.1.0.exe"), [0]);
            File.WriteAllBytes(Path.Combine(fallback, "SAGRA-Letreiro-Setup-9.9.9.exe"), [0]);
            Assert.True(UpdateFinder.TryFindNewerSetup([primary, fallback], new Version(2, 0, 0), out var path));
            Assert.Equal("SAGRA-Letreiro-Setup-2.1.0.exe", Path.GetFileName(path));
            Assert.False(UpdateFinder.TryFindNewerSetup([primary, fallback], new Version(2, 1, 0), out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
