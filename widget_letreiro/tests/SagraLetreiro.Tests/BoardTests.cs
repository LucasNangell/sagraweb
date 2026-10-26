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
        Assert.Null(cfg.Board.Columns[0].Sector);
        Assert.Equal(720, cfg.Window.Width);
        Assert.False(cfg.Window.TransparentBg);
        Assert.Equal(ConfigStore.ProductionApiBase, cfg.ApiBaseUrl);
        Assert.True(ConfigStore.Normalize(new AppConfig { Window = new WindowConfig { TransparentBg = true } }).Window.TransparentBg);
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
    public void CardWidthFitsTheWiderLineAndKeepsPadding()
    {
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

    static OsItem CloneSub(int pcpOrdem)
    {
        var item = SubOs.Clone();
        item.PcpOrdem = pcpOrdem;
        return item;
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
}
