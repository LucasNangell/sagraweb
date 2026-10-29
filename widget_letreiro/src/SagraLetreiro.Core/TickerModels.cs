namespace SagraLetreiro;

public readonly record struct TickerCardModel(string Id, string Label);

public static class TickerModels
{
    public const string DefaultId = "fx-02-shimmer";
    public const string SolidId = "fx-01-solid";

    public static readonly TickerCardModel[] All =
    [
        new("fx-01-solid", "01. Sólido clássico"),
        new("fx-02-shimmer", "02. Shimmer"),
        new("fx-03-accent-scan", "03. Scanner na faixa"),
        new("fx-04-accent-pulse", "04. Pulso na faixa"),
        new("fx-05-inset-pulse", "05. Glow interno"),
        new("fx-06-laser-line", "06. Laser"),
        new("fx-07-diagonal-stream", "07. Stream diagonal"),
        new("fx-08-strobe", "08. Giroflex"),
        new("fx-09-sonar", "09. Sonar"),
        new("fx-10-metallic", "10. Varredura metálica"),
        new("fx-11-inspect-spot", "11. Holofote"),
        new("fx-12-enter-slide", "12. Entrada deslize"),
        new("fx-13-enter-wipe", "13. Entrada cortina"),
        new("fx-14-enter-crt", "14. Entrada CRT"),
        new("fx-15-bottom-progress", "15. Progresso"),
        new("fx-16-heartbeat-in", "16. Batimento"),
        new("fx-17-conic-border", "17. Borda cônica"),
        new("fx-18-stagger", "18. Cascata"),
        new("fx-19-tesla", "19. Tesla"),
        new("fx-20-siren", "20. Sirene"),
        new("fx-21-gold-vip", "21. Ouro VIP"),
        new("fx-22-nuclear", "22. Núcleo nuclear"),
        new("fx-23-twin-laser", "23. Laser duplo"),
        new("fx-24-forcefield", "24. Campo de força"),
        new("fx-25-crystal", "25. Cristal"),
        new("fx-26-solar", "26. Explosão solar"),
        new("fx-27-terminal", "27. Terminal"),
        new("fx-28-hud", "28. HUD"),
        new("fx-29-kinetic", "29. Gradiente cinético"),
        new("fx-30-stroke-wave", "30. Contorno pulsante"),
        new("fx-31-cyber", "31. Fatiamento cyber"),
        new("fx-32-inferno", "32. Inferno"),
        new("fx-33-neon", "33. Neon Vegas"),
        new("fx-34-matrix", "34. Matrix"),
        new("fx-35-xray", "35. Raio-X"),
        new("fx-36-glitch", "36. Glitch RGB"),
        new("fx-37-iris", "37. Íris portal"),
        new("fx-38-shutter", "38. Obturador"),
        new("fx-39-warp", "39. Dobra espacial"),
        new("fx-40-rubber", "40. Impacto elástico"),
        new("fx-41-carimbo", "41. Carimbo"),
        new("fx-42-aurora", "42. Aurora"),
    ];

    static readonly HashSet<string> Known = new(All.Select(m => m.Id), StringComparer.Ordinal);
    static readonly HashSet<string> Entry = new(StringComparer.Ordinal)
    {
        "fx-12-enter-slide", "fx-13-enter-wipe", "fx-14-enter-crt", "fx-18-stagger",
        "fx-37-iris", "fx-38-shutter", "fx-39-warp", "fx-40-rubber", "fx-41-carimbo",
    };

    public static bool IsEntry(string id) => Entry.Contains(id);

    public static string Clamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return DefaultId;
        var id = value.Trim();
        return Known.Contains(id) ? id : SolidId;
    }
}
