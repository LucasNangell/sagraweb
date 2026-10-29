namespace SagraLetreiro;

public static class TickerHit
{
    public static TickerCard? At(
        IReadOnlyList<PlacedCard> placed,
        double x,
        double y,
        double canvasH)
    {
        var top = 3.0;
        var h = Math.Max(18, canvasH - 6);
        TickerCard? found = null;
        foreach (var item in placed)
        {
            if (x >= item.X && x <= item.X + item.Width && y >= top && y <= top + h)
                found = item.Card;
        }
        return found;
    }
}
