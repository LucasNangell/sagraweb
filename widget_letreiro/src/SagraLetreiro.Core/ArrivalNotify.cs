namespace SagraLetreiro;

public readonly record struct ArrivalToastLayout(
    int CardWidth,
    int CardHeight,
    double SidePad,
    double EnterSlack,
    double ExitSlack,
    double EnterTravel,
    double ExitTravel,
    double BlobRadius,
    double HoldRadius,
    double WindowWidth,
    double WindowHeight);

public static class ArrivalNotify
{
    public const string PreviewKey = "preview:0-0";
    public const int DefaultCardWidth = 320;
    public const int DefaultCardHeight = 96;
    public const int MinCardWidth = 180;
    public const int MaxCardWidth = 900;
    public const int MinCardHeight = 56;
    public const int MaxCardHeight = 280;
    public const double ScaleOvershoot = 1.12;
    public const double EnterTravel = 60;
    public const double ExitTravel = 40;
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(4);

    public static int ClampCardWidth(int value) =>
        Math.Clamp(value <= 0 ? DefaultCardWidth : value, MinCardWidth, MaxCardWidth);

    public static int ClampCardHeight(int value) =>
        Math.Clamp(value <= 0 ? DefaultCardHeight : value, MinCardHeight, MaxCardHeight);

    public static ArrivalToastLayout Layout(int cardWidth, int cardHeight)
    {
        var width = ClampCardWidth(cardWidth);
        var height = ClampCardHeight(cardHeight);
        var sidePad = Math.Max(12, width * (ScaleOvershoot - 1) / 2);
        var vertOvershoot = Math.Max(8, height * (ScaleOvershoot - 1) / 2);
        var enterSlack = EnterTravel + vertOvershoot;
        var exitSlack = ExitTravel + vertOvershoot;
        return new ArrivalToastLayout(
            width,
            height,
            sidePad,
            enterSlack,
            exitSlack,
            EnterTravel,
            ExitTravel,
            height / 2.0,
            Math.Min(16, Math.Max(8, height * 0.17)),
            width + sidePad * 2,
            enterSlack + height + exitSlack);
    }

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
