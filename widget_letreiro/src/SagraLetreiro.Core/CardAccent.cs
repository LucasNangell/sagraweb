namespace SagraLetreiro;

public static class CardAccent
{
    public const string New = "#04d361";
    public const string SubOs = "#f59e0b";
    public static readonly string[] Columns =
    [
        "#b46d03", "#04618d", "#a30d0d", "#02461e", "#ff6b6b", "#202024",
    ];

    public static string Hex(TickerCard card)
    {
        if (card.IsNew) return New;
        if (card.IsSubOs) return SubOs;
        return Columns[Math.Abs(card.ColumnIndex) % Columns.Length];
    }

    public static string PriorityClass(string? priority) => priority switch
    {
        "priority-high" => "prio-high",
        "priority-medium" => "prio-med",
        _ => "prio-norm",
    };
}
