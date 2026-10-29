namespace SagraLetreiro;

/// <summary>
/// Medidas do mini-card: a fonte usada para medir tem de ser a mesma do desenho,
/// senão o texto da OS/situação corta dentro do retângulo.
/// </summary>
public static class CardMetrics
{
    public const double MaxWidth = 360;
    public const double PadX = 22;
    public const double MinInner = 80;
    public const double Accent = 4;
    public const double TextLeft = 12;
    public const double TextRight = 10;
    public const double MinActionWidth = 176;

    public static (double Label, double Situacao) FontSizes(double tickerHeight)
    {
        var innerH = Math.Max(18, tickerHeight - 6);
        return (Math.Max(9, innerH * 0.38), Math.Max(8, innerH * 0.28));
    }

    public static double Width(double labelWidth, double situacaoWidth)
    {
        var inner = Math.Max(Math.Max(labelWidth, situacaoWidth), MinInner);
        inner = Math.Min(MaxWidth - PadX, inner);
        return inner + PadX;
    }

    public static double TextInner(double cardWidth) =>
        Math.Max(0, cardWidth - PadX);
}
