namespace SagraLetreiro;

public static class TickerLayout
{
    public const double Pad = 8;
    public const double Gap = 8;

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
            var x = canvasWidth - Pad;
            var list = new List<PlacedCard>(cards.Count);
            for (var i = 0; i < cards.Count; i++)
            {
                x -= widths[i];
                list.Add(new PlacedCard(cards[i], x, widths[i]));
                x -= Gap;
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
                var x = right - w;
                if (x < canvasWidth && right > 0)
                    result.Add(new PlacedCard(cards[i], x, w));
                right = x - Gap;
                idx++;
                safety++;
            }
        }
        return result;
    }
}
