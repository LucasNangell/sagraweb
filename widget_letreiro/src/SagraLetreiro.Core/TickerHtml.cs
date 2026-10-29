using System.Globalization;
using System.Text;
using System.Text.Json;

namespace SagraLetreiro;

public readonly record struct TickerFrameItem(
    string Key,
    double X,
    double Width,
    string Label,
    string Situacao,
    string Priority,
    string Accent,
    string Model,
    bool Enter,
    bool Pinned);

public static class TickerHtml
{
    static readonly string[] CssFiles = ["ticker-shell.css", "bar-card.css", "bar-fx.css"];
    static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
    static string? _cachedCss;

    public static string Page()
    {
        return $$"""
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="utf-8" />
            <style>{{Css()}}</style>
            </head>
            <body>
            <div id="shell">
            <div id="rotating"></div>
            <div id="pinned"></div>
            <div id="empty"></div>
            </div>
            <script>
            const cards = new Map();
            const rotating = document.getElementById('rotating');
            const pinned = document.getElementById('pinned');
            const emptyEl = document.getElementById('empty');
            let lastFrame = '';
            function prioClass(p) {
              if (p === 'priority-high' || p === 'prio-high') return 'prio-high';
              if (p === 'priority-medium' || p === 'prio-med') return 'prio-med';
              return 'prio-norm';
            }
            function hostOf(item) { return item.pin ? pinned : rotating; }
            function ensureCard(item) {
              let el = cards.get(item.k);
              if (!el) {
                el = document.createElement('div');
                el.dataset.k = item.k;
                el.innerHTML = (item.fx === 'fx-03-accent-scan' ? '<span class="accent-runner"></span>' : '')
                  + '<div class="os-line"></div><div class="sit-line"></div>';
                hostOf(item).appendChild(el);
                cards.set(item.k, el);
              } else if (el.parentElement !== hostOf(item)) {
                hostOf(item).appendChild(el);
              }
              return el;
            }
            function applyItem(el, item) {
              const enter = !!item.enter && el.dataset.seen !== '1';
              el.style.left = item.x + 'px';
              el.style.width = item.w + 'px';
              el.style.setProperty('--card-accent', item.accent || '');
              el.className = 'wpf-bar-card ' + prioClass(item.prio) + ' ' + (item.fx || '') + (enter ? ' fx-enter-once' : '');
              el.querySelector('.os-line').textContent = item.label || '';
              el.querySelector('.sit-line').textContent = item.sit || '';
              if (enter) el.dataset.seen = '1';
            }
            function applyFrame(raw) {
              if (raw == null) return;
              const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
              if (!json || json === lastFrame) return;
              lastFrame = json;
              const frame = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const root = document.documentElement;
              if (frame.h) root.style.setProperty('--taskbar-h', frame.h + 'px');
              if (frame.cardH) root.style.setProperty('--card-h', frame.cardH + 'px');
              if (frame.fontOs) root.style.setProperty('--font-os', frame.fontOs + 'px');
              if (frame.fontSit) root.style.setProperty('--font-sit', frame.fontSit + 'px');
              rotating.style.width = (frame.clipW || frame.w || 0) + 'px';
              document.body.classList.toggle('paused', !!frame.paused);
              emptyEl.textContent = frame.empty || '';
              emptyEl.style.display = frame.empty ? 'block' : 'none';
              const keys = new Set();
              for (const item of frame.items || []) {
                keys.add(item.k);
                applyItem(ensureCard(item), item);
              }
              for (const [k, el] of [...cards]) {
                if (!keys.has(k)) { el.remove(); cards.delete(k); }
              }
            }
            function tick() {
              try {
                const host = chrome.webview.hostObjects.sync.ticker;
                applyFrame(host ? host.FrameJson : '');
              } catch (e) {}
              requestAnimationFrame(tick);
            }
            try {
              chrome.webview.addEventListener('message', (ev) => applyFrame(ev.data));
            } catch (e) {}
            requestAnimationFrame(tick);
            </script>
            </body>
            </html>
            """;
    }

    public static string Frame(
        IReadOnlyList<TickerFrameItem> items,
        double tickerH,
        double cardH,
        double fontOs,
        double fontSit,
        double clipW,
        bool paused,
        string empty)
    {
        var payload = new Dictionary<string, object?>
        {
            ["h"] = tickerH,
            ["cardH"] = cardH,
            ["fontOs"] = fontOs,
            ["fontSit"] = fontSit,
            ["clipW"] = clipW,
            ["paused"] = paused,
            ["empty"] = empty ?? "",
            ["items"] = items.Select(item => new Dictionary<string, object?>
            {
                ["k"] = item.Key,
                ["x"] = item.X,
                ["w"] = item.Width,
                ["label"] = item.Label,
                ["sit"] = item.Situacao,
                ["prio"] = item.Priority,
                ["accent"] = item.Accent,
                ["fx"] = item.Model,
                ["enter"] = item.Enter,
                ["pin"] = item.Pinned,
            }).ToList(),
        };
        return JsonSerializer.Serialize(payload, JsonOpts);
    }

    public static string Css()
    {
        if (_cachedCss is not null) return _cachedCss;
        var asm = typeof(TickerHtml).Assembly;
        var names = asm.GetManifestResourceNames();
        var buf = new StringBuilder();
        foreach (var file in CssFiles)
        {
            var name = names.FirstOrDefault(n => n.EndsWith(file, StringComparison.OrdinalIgnoreCase));
            if (name is null) continue;
            using var stream = asm.GetManifestResourceStream(name);
            if (stream is null) continue;
            using var reader = new StreamReader(stream);
            buf.AppendLine(reader.ReadToEnd());
        }
        _cachedCss = buf.ToString();
        return _cachedCss;
    }

    public static TickerFrameItem Item(
        PlacedCard placed,
        string situacao,
        string model,
        bool enter,
        bool pinned)
    {
        var card = placed.Card;
        return new TickerFrameItem(
            card.UniqueKey,
            Math.Round(placed.X, 2, MidpointRounding.AwayFromZero),
            placed.Width,
            card.Label ?? "",
            situacao ?? "",
            CardAccent.PriorityClass(card.Priority),
            CardAccent.Hex(card),
            TickerModels.Clamp(model),
            enter,
            pinned);
    }

    public static string Inv(double value) =>
        value.ToString("0.##", CultureInfo.InvariantCulture);
}
