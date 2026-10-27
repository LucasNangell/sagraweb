namespace SagraLetreiro;

public readonly record struct PrioritySplit(
    IReadOnlyList<TickerCard> Pinned,
    IReadOnlyList<double> PinnedWidths,
    IReadOnlyList<TickerCard> Rotating,
    IReadOnlyList<double> RotatingWidths);

public static class TickerLayout
{
    public const double Pad = 8;
    public const double Gap = 8;

    public static bool IsPinnedPriority(TickerCard card) =>
        card.Priority is "priority-high" or "priority-medium";

    public static PrioritySplit SplitByPriority(
        IReadOnlyList<TickerCard> cards,
        IReadOnlyList<double> widths)
    {
        var high = new List<TickerCard>();
        var highW = new List<double>();
        var medium = new List<TickerCard>();
        var mediumW = new List<double>();
        var rotating = new List<TickerCard>();
        var rotatingW = new List<double>();
        if (cards.Count != widths.Count) return new(high, highW, rotating, rotatingW);

        for (var i = 0; i < cards.Count; i++)
        {
            var card = cards[i];
            if (card.Priority == "priority-high")
            {
                high.Add(card);
                highW.Add(widths[i]);
            }
            else if (card.Priority == "priority-medium")
            {
                medium.Add(card);
                mediumW.Add(widths[i]);
            }
            else
            {
                rotating.Add(card);
                rotatingW.Add(widths[i]);
            }
        }
        high.AddRange(medium);
        highW.AddRange(mediumW);
        return new(high, highW, rotating, rotatingW);
    }

    public static double PinnedReserve(IReadOnlyList<double> pinnedWidths)
    {
        if (pinnedWidths.Count == 0) return 0;
        return Pad + pinnedWidths.Sum() + Gap * pinnedWidths.Count;
    }

    public static bool TotalOverflow(IReadOnlyList<double> widths, double canvasWidth) =>
        Board.TickerContentOverflows(widths, Gap, canvasWidth);

    public static bool RotatingNeedsMarquee(
        IReadOnlyList<TickerCard> cards,
        IReadOnlyList<double> widths,
        double canvasWidth)
    {
        if (!TotalOverflow(widths, canvasWidth)) return false;
        var split = SplitByPriority(cards, widths);
        if (split.Rotating.Count == 0) return false;
        var remaining = canvasWidth - PinnedReserve(split.PinnedWidths);
        if (remaining <= 0) return false;
        return Board.TickerContentOverflows(split.RotatingWidths, Gap, remaining);
    }

    public static double MarqueeWheelStep(IReadOnlyList<double> rotatingWidths)
    {
        if (rotatingWidths.Count == 0) return 48;
        return rotatingWidths.Average() + Gap;
    }

    public static IReadOnlyList<PlacedCard> PlaceCarousel(
        IReadOnlyList<TickerCard> cards,
        IReadOnlyList<double> widths,
        double canvasWidth,
        double offset,
        bool overflow)
    {
        if (!overflow) return PlaceRtl(cards, widths, canvasWidth, offset, scroll: false);
        var split = SplitByPriority(cards, widths);
        if (split.Pinned.Count == 0)
            return PlaceRtl(cards, widths, canvasWidth, offset, scroll: true);

        var placed = new List<PlacedCard>(split.Pinned.Count);
        var x = Pad;
        for (var i = 0; i < split.Pinned.Count; i++)
        {
            placed.Add(new PlacedCard(split.Pinned[i], x, split.PinnedWidths[i]));
            x += split.PinnedWidths[i] + Gap;
        }

        if (split.Rotating.Count == 0) return placed;
        var remainingWidth = canvasWidth - x;
        if (remainingWidth <= 0) return placed;

        var rotatingScroll = Board.TickerContentOverflows(split.RotatingWidths, Gap, remainingWidth);
        var rotatingPlaced = PlaceRtl(
            split.Rotating, split.RotatingWidths, remainingWidth, offset, rotatingScroll);
        foreach (var item in rotatingPlaced)
        {
            if (item.X < 0) continue;
            placed.Add(new PlacedCard(item.Card, item.X + x, item.Width));
        }
        return placed;
    }

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
