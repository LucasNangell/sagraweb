namespace SagraLetreiro;

public static class ArrivalNotify
{
    public const string PreviewKey = "preview:0-0";
    public const double ToastWidth = 320;
    public const double ToastHeight = 96;
    public const double ToastEnterSlack = 60;
    public const double ToastExitSlack = 40;
    public const double ToastWindowHeight = ToastEnterSlack + ToastHeight + ToastExitSlack;
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(4);

    public static TickerCard PreviewCard() => new()
    {
        UniqueKey = PreviewKey,
        OpKey = "0-0",
        Label = "OS 0000/00",
        Situacao = "Teste de notificação",
        IsNew = true,
        ColumnIndex = 0,
        ColumnTitle = "Teste",
        NrOs = 0,
        Ano = 0,
    };

    public static List<TickerCard> VisibleOnTicker(
        IEnumerable<TickerCard> cards,
        IReadOnlyCollection<string> heldKeys)
    {
        if (heldKeys.Count == 0) return cards.ToList();
        return cards.Where(card => !heldKeys.Contains(card.UniqueKey)).ToList();
    }
}
