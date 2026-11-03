namespace SagraLetreiro;

public static class TickerLayout
{
    public const double Pad = 8;
    public const double Gap = 8;

    public static bool TotalOverflow(IReadOnlyList<double> widths, double canvasWidth) =>
        Board.TickerContentOverflows(widths, Gap, canvasWidth);

    public static bool NeedsMarquee(IReadOnlyList<double> widths, double canvasWidth) =>
        TotalOverflow(widths, canvasWidth);

    public static double MarqueeWheelStep(IReadOnlyList<double> widths)
    {
        if (widths.Count == 0) return 48;
        return widths.Average() + Gap;
    }

    public static IReadOnlyList<PlacedCard> PlaceCarousel(
        IReadOnlyList<TickerCard> cards,
        IReadOnlyList<double> widths,
        double canvasWidth,
        double offset,
        bool overflow) =>
        PlaceRtl(cards, widths, canvasWidth, offset, scroll: overflow);

    public static IReadOnlyList<PlacedCard> PlaceRtl(
        IReadOnlyList<TickerCard> cards,
        IReadOnlyList<double> widths,
        double canvasWidth,
        double offset,
        bool scroll)
    {
        if (cards.Count == 0 || widths.Count != cards.Count) return Array.Empty<PlacedCard>();

        if (!scroll)
        {
            var packX = canvasWidth - Pad;
            var list = new List<PlacedCard>(cards.Count);
            for (var i = 0; i < cards.Count; i++)
            {
                packX -= widths[i];
                list.Add(new PlacedCard(cards[i], packX, widths[i]));
                packX -= Gap;
            }
            return list;
        }

        var loop = widths.Sum() + Gap * cards.Count;
        if (loop <= 0) return Array.Empty<PlacedCard>();
        var shift = offset % loop;
        if (shift < 0) shift += loop;

        var result = new List<PlacedCard>();
        foreach (var startRight in new[] { canvasWidth - shift, canvasWidth - shift + loop })
        {
            var right = startRight;
            var idx = 0;
            var safety = 0;
            while (right > -8 && safety < cards.Count * 4)
            {
                var i = idx % cards.Count;
                var w = widths[i];
                var cardX = right - w;
                if (cardX < canvasWidth && right > 0)
                    result.Add(new PlacedCard(cards[i], cardX, w));
                right = cardX - Gap;
                idx++;
                safety++;
            }
        }
        return result;
    }
}
