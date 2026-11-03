import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookMarked,
  Clock3,
  Monitor,
  Settings2,
  TerminalSquare,
  Menu,
  X,
  RefreshCw,
  Send,
  Plus,
  Trash2,
  ChevronDown,
  ArrowRight,
  Bell,
  Check,
  CircleAlert,
  Layers3,
  LoaderCircle,
  Radio,
  Save,
  Search,
  SlidersHorizontal,
  Unplug,
} from "lucide-react";
import { ConfigPreview, SettingsSummary } from "./ui";
import ClientControlPanel from "./ClientControlPanel";
import { desktopJobLabel, desktopTargetKey, isDesktopJob } from "./desktop";
import {
  api,
  ApiError,
  type AppConfig,
  type BoardColumn,
  type Command,
  type ConfigProfile,
  type ConfigProfileAssignment,
  type Instance,
  type Job,
} from "./api";
import {
  CLASSIC_ENTRY_ANIMATIONS,
  clampColumnAnimation,
  clampEntryAnimation,
  visualFromPreset,
} from "./notificationStyle";
import {
  MUTE_SOUND,
  clampColumnSound,
  clampNotificationSound,
  resolveFilterAnimation,
  resolveFilterSound,
  type LetreiroSound,
} from "./notificationSounds";
import { TICKER_CARD_MODELS, clampTickerModel } from "./tickerModels";
import {
  applyCapturesFromJobs,
  applyCommandVars,
  capturedGroups,
  extractCommandVars,
  loadCapturedVars,
  readCaptureVar,
  saveCapturedVars,
  stripCaptureLine,
  writeCaptureVar,
  type CapturedVars,
} from "./commandVars";

type View = "computers" | "library" | "history" | "settings";
type SettingsSection = "bar" | "notifications" | "filters" | "profiles" | "connection";

const SETTINGS_NAV: { id: SettingsSection; label: string; icon: typeof Monitor }[] = [
  { id: "bar", label: "Barra do letreiro", icon: SlidersHorizontal },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "filters", label: "Filtros", icon: Layers3 },
  { id: "profiles", label: "Perfis", icon: BookMarked },
  { id: "connection", label: "Conexão", icon: Unplug },
];

const PAGE_INFO: Record<View, { title: string; description: string }> = {
  computers: { title: "Computadores", description: "Gerencie as estações conectadas e execute comandos à distância." },
  library: { title: "Biblioteca de scripts", description: "Organize seus comandos e reutilize rotinas de administração." },
  history: { title: "Histórico de comandos", description: "Acompanhe as execuções e consulte o retorno de cada computador." },
  settings: { title: "Ajustes do letreiro", description: "Personalize a exibição, os avisos e as informações que você acompanha." },
};

const NAV: { id: View; label: string; icon: typeof Monitor }[] = [
  { id: "computers", label: "Computadores", icon: Monitor },
  { id: "library", label: "Biblioteca", icon: BookMarked },
  { id: "history", label: "Histórico", icon: Clock3 },
  { id: "settings", label: "Ajustes", icon: Settings2 },
];

function normalizeSam(value: string) {
  const raw = (value ?? "").trim();
  const slash = Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/"));
  return (slash >= 0 ? raw.slice(slash + 1) : raw).toLowerCase();
}

function keyOf(row: Pick<Instance, "hostName" | "windowsUser">) {
  return `${row.hostName.trim().toLowerCase()}\n${normalizeSam(row.windowsUser)}`;
}

function uniqueInstances(rows: Instance[]) {
  const seen = new Map<string, Instance>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, row);
      continue;
    }
    const prevSeen = Date.parse(String(prev.lastSeen ?? "")) || 0;
    const nextSeen = Date.parse(String(row.lastSeen ?? "")) || 0;
    const newer = nextSeen >= prevSeen ? row : prev;
    const older = newer === row ? prev : row;
    seen.set(key, {
      ...newer,
      nome: newer.nome || older.nome,
      setor: newer.setor || older.setor,
      hasConfig: newer.hasConfig || older.hasConfig,
      online: newer.online,
    });
  }
  return [...seen.values()];
}

function foldText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function textMatches(haystack: string, needle: string) {
  const q = foldText(needle);
  if (!q) return true;
  return foldText(haystack).includes(q);
}

function compareInstancesByNome(a: Instance, b: Instance) {
  const an = (a.nome ?? "").trim();
  const bn = (b.nome ?? "").trim();
  if (!an && bn) return 1;
  if (an && !bn) return -1;
  const byNome = an.localeCompare(bn, "pt", { sensitivity: "base" });
  if (byNome) return byNome;
  const byHost = a.hostName.localeCompare(b.hostName, "pt", { sensitivity: "base" });
  if (byHost) return byHost;
  return a.windowsUser.localeCompare(b.windowsUser, "pt", { sensitivity: "base" });
}

function compareInstances(a: Instance, b: Instance) {
  if (a.online !== b.online) return a.online ? -1 : 1;
  return compareInstancesByNome(a, b);
}

function LibraryCombobox({
  commands,
  value,
  onChange,
}: {
  commands: Command[];
  value: number;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = commands.find((cmd) => cmd.id === value);
  const sorted = useMemo(
    () => [...commands].sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [commands],
  );
  const filtered = useMemo(() => {
    const q = foldText(query);
    if (!q) return sorted;
    return sorted.filter((cmd) => foldText(`${cmd.name} ${cmd.kind === "ps1" ? "ps1 powershell" : "bat cmd"}`).includes(q));
  }, [query, sorted]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(id: number) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative w-full min-w-0 sm:w-64">
      <div className="relative">
        <input
          aria-label="Comando da biblioteca"
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          className="w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-3 pr-8 text-sm text-slate-100 outline-none focus:border-sky-400"
          placeholder="Biblioteca…"
          value={open ? query : (selected?.name ?? "")}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              if (!open) return;
              e.preventDefault();
              e.stopPropagation();
              const cmd = filtered[active];
              pick(cmd ? cmd.id : 0);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              setQuery("");
            }
          }}
        />
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
      </div>
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            data-idx={-1}
            className="w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-800"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(0)}
          >
            Nenhum comando
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Nenhum resultado.</p>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                data-idx={index}
                aria-selected={cmd.id === value}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                  index === active ? "bg-slate-800 text-white" : "text-slate-200 hover:bg-slate-800"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(cmd.id)}
              >
                <span className="min-w-0 truncate">{cmd.name}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cmd.kind === "ps1" ? "bg-sky-400 text-slate-950" : "bg-amber-400 text-slate-950"}`}>
                  {cmd.kind === "ps1" ? "PS1" : "BAT"}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function errText(ex: unknown) {
  return ex instanceof Error ? ex.message : String(ex);
}

function currentHash() {
  return window.location.hash.replace(/^#/, "");
}

const JOB_DONE = new Set(["ok", "fail", "timeout"]);

function jobDone(job: Job) {
  return JOB_DONE.has((job.status ?? "").toLowerCase());
}

function formatJobReply(job: Job) {
  const who = [job.hostName, job.windowsUser].filter(Boolean).join("\\") || "destino";
  const stdout = (job.stdout ?? "").replace(/\s+$/g, "");
  const stderr = (job.stderr ?? "").replace(/\s+$/g, "");
  const status = (job.status ?? "").toLowerCase();
  const code = job.exitCode == null ? "" : ` exit ${job.exitCode}`;
  const lines = [`[${who}]`];
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(stderr);
  if (status === "timeout") {
    if (!stderr) lines.push("Tempo esgotado. Processo encerrado.");
    lines.push(`timeout${code}`);
  } else if (status === "fail") {
    if (!stderr) lines.push("Comando falhou.");
    lines.push(`fail${code}`);
  } else {
    lines.push(`${job.status}${code}`);
  }
  return `${lines.join("\n")}\n`;
}

type FilterFonte = "situacao" | "inbox";

type DisplayFilter = {
  key: string;
  setor: string;
  situacao: string;
  fonte: FilterFonte;
  notify: boolean;
  ponto: string;
  observacao: string;
  animation: string;
  sound: string;
};

const DEFAULT_SITUACOES = [
  "Saída p/",
  "Saída parcial p/",
  "Entrada Inicial",
  "Tramit. de Prova p/",
  "Tramit. de Prévia p/",
  "Comentário",
  "Em Execução",
  "Recebido",
  "Problemas Técnicos",
  "Problema Técnico",
  "Encam. de Docum.",
];

function filtersFromColumns(columns: BoardColumn[]): DisplayFilter[] {
  const rows: DisplayFilter[] = [];
  columns.forEach((col, colIndex) => {
    if (col.source === "inbox") {
      rows.push({
        key: col.id ?? `inbox-${colIndex}`,
        setor: col.sector ?? "",
        situacao: "",
        fonte: "inbox",
        notify: !!col.notify,
        ponto: col.ponto ?? "",
        observacao: col.observacao ?? "",
        animation: clampColumnAnimation(col.animation),
        sound: clampColumnSound(col.sound),
      });
      return;
    }
    const statuses = col.statuses?.length ? col.statuses : [""];
    statuses.forEach((situacao, i) => {
      rows.push({
        key: `${col.id ?? colIndex}:${i}:${situacao}`,
        setor: col.sector ?? "",
        situacao,
        fonte: "situacao",
        notify: !!col.notify,
        ponto: col.ponto ?? "",
        observacao: col.observacao ?? "",
        animation: clampColumnAnimation(col.animation),
        sound: clampColumnSound(col.sound),
      });
    });
  });
  return rows;
}

function columnsFromFilters(filters: DisplayFilter[]): BoardColumn[] {
  return filters.map((item, i) => {
    const ponto = item.ponto.trim();
    const observacao = item.observacao.trim();
    const animation = clampColumnAnimation(item.animation);
    const sound = clampColumnSound(item.sound);
    const extras = {
      ...(ponto ? { ponto } : {}),
      ...(observacao ? { observacao } : {}),
      ...(animation ? { animation } : {}),
      ...(sound ? { sound } : {}),
    };
    if (item.fonte === "inbox") {
      return {
        id: `col_${i}`,
        title: "Inbox",
        source: "inbox",
        statuses: [],
        sector: item.setor || undefined,
        notify: !!item.notify,
        ...extras,
      };
    }
    const situacao = item.situacao.trim();
    return {
      id: `col_${i}`,
      title: situacao || `Filtro ${i + 1}`,
      statuses: situacao ? [situacao] : [],
      sector: item.setor || undefined,
      notify: !!item.notify,
      ...extras,
    };
  });
}

const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "col_0", title: "p/ Triagem", statuses: ["Saída p/", "Saída parcial p/", "Entrada Inicial", "Tramit. de Prova p/", "Tramit. de Prévia p/", "Comentário"] },
  { id: "col_1", title: "p/ Execução", statuses: ["Em Execução", "Recebido"] },
  { id: "col_2", title: "Prob. Téc.", statuses: ["Problemas Técnicos", "Problema Técnico"] },
  { id: "col_3", title: "enviar E-mail", statuses: ["Encam. de Docum."] },
];

function withFreshPresetVisual(
  cfg: AppConfig,
  presets: { id: number; nome: string; payload: unknown }[],
): AppConfig {
  const id = cfg.window?.notificationVisual?.presetId;
  if (!id) return cfg;
  const preset = presets.find((item) => item.id === id);
  if (!preset) return cfg;
  return {
    ...cfg,
    window: {
      ...cfg.window,
      notificationVisual: visualFromPreset(preset.payload, preset.id, preset.nome),
    },
  };
}

function anyNotify(columns: BoardColumn[] | undefined): boolean {
  return (columns ?? []).some((col) => !!col.notify);
}

function withNotifyMigration(cfg: AppConfig): AppConfig {
  const columns = cfg.board?.columns ?? [];
  const migrated = anyNotify(columns)
    ? columns
    : cfg.window?.notificationsEnabled
      ? columns.map((col) => ({ ...col, notify: true }))
      : columns;
  return {
    ...cfg,
    board: { ...cfg.board, columns: migrated, columnCount: migrated.length },
    window: { ...cfg.window, notificationsEnabled: anyNotify(migrated) },
  };
}

function mergeProfile(base: AppConfig, profile: AppConfig): AppConfig {
  return withNotifyMigration({
    ...base,
    board: profile.board ?? base.board,
    window: {
      ...base.window,
      ...profile.window,
      x: base.window?.x,
    },
  });
}

function remoteWindow(cfg: AppConfig, columns: BoardColumn[]) {
  return {
    width: cfg.window?.width ?? 720,
    opacity: cfg.window?.opacity ?? 0.95,
    speedPxPerSec: cfg.window?.speedPxPerSec ?? 40,
    transparentBg: !!cfg.window?.transparentBg,
    notificationsEnabled: columns.some((col) => !!col.notify),
    notificationWidth: cfg.window?.notificationWidth ?? 320,
    notificationHeight: cfg.window?.notificationHeight ?? 96,
    notificationTitleFontSize: cfg.window?.notificationTitleFontSize ?? 22,
    notificationSituationFontSize: cfg.window?.notificationSituationFontSize ?? 14,
    notificationPadX: cfg.window?.notificationPadX ?? 16,
    notificationTextGap: cfg.window?.notificationTextGap ?? 4,
    notificationOffsetRight: cfg.window?.notificationOffsetRight ?? 24,
    notificationOffsetBottom: cfg.window?.notificationOffsetBottom ?? 24,
    notificationAnimation: clampEntryAnimation(cfg.window?.notificationAnimation),
    notificationSound: clampNotificationSound(cfg.window?.notificationSound),
    notificationVisual: cfg.window?.notificationVisual,
    tickerHtml: cfg.window?.tickerHtml !== false,
    tickerCardModel: clampTickerModel(cfg.window?.tickerCardModel),
  };
}

function remotePayload(cfg: AppConfig): AppConfig {
  const cols = cfg.board?.columns ?? [];
  return {
    ...cfg,
    board: { ...cfg.board, columns: cols, columnCount: cols.length },
    window: remoteWindow(cfg, cols),
  };
}

function seedClientConfig(row: Instance, payload: AppConfig | null): AppConfig {
  const base = payload ?? {};
  const columns = base.board?.columns?.length ? base.board.columns : DEFAULT_COLUMNS;
  return withNotifyMigration({
    ...base,
    ponto: base.ponto || "654321",
    nome: base.nome || "usr_sefoc",
    board: {
      sector: base.board?.sector || row.setor || "SEFOC",
      showOs: base.board?.showOs !== false,
      showSp: base.board?.showSp !== false,
      columns,
      columnCount: columns.length,
    },
    window: {
      width: base.window?.width ?? 720,
      opacity: base.window?.opacity ?? 0.95,
      speedPxPerSec: base.window?.speedPxPerSec ?? 40,
      transparentBg: !!base.window?.transparentBg,
      notificationsEnabled: !!base.window?.notificationsEnabled,
      notificationWidth: base.window?.notificationWidth ?? 320,
      notificationHeight: base.window?.notificationHeight ?? 96,
      notificationTitleFontSize: base.window?.notificationTitleFontSize ?? 22,
      notificationSituationFontSize: base.window?.notificationSituationFontSize ?? 14,
      notificationPadX: base.window?.notificationPadX ?? 16,
      notificationTextGap: base.window?.notificationTextGap ?? 4,
      notificationOffsetRight: base.window?.notificationOffsetRight ?? 24,
      notificationOffsetBottom: base.window?.notificationOffsetBottom ?? 24,
      notificationAnimation: clampEntryAnimation(base.window?.notificationAnimation),
      notificationVisual: base.window?.notificationVisual,
      tickerHtml: base.window?.tickerHtml !== false,
      tickerCardModel: clampTickerModel(base.window?.tickerCardModel),
    },
  });
}

function withFilters(cfg: AppConfig, next: DisplayFilter[]): AppConfig {
  const cols = columnsFromFilters(next);
  return {
    ...cfg,
    board: { ...cfg.board, columns: cols, columnCount: cols.length },
    window: { ...cfg.window, notificationsEnabled: cols.some((col) => !!col.notify) },
  };
}

function playCatalogSound(id: string) {
  const resolved = clampNotificationSound(id);
  if (resolved === MUTE_SOUND) return;
  try {
    const audio = new Audio(api.soundUrl(resolved));
    void audio.play();
  } catch {
    /* preview best-effort */
  }
}

function previewNotificationPayload(cfg: AppConfig, opts?: { animation?: string; sound?: string; priority?: string }) {
  return {
    width: cfg.window?.notificationWidth ?? 320,
    height: cfg.window?.notificationHeight ?? 96,
    titleFontSize: cfg.window?.notificationTitleFontSize ?? 22,
    situationFontSize: cfg.window?.notificationSituationFontSize ?? 14,
    padX: cfg.window?.notificationPadX ?? 16,
    textGap: cfg.window?.notificationTextGap ?? 4,
    priority: opts?.priority ?? "",
    offsetRight: cfg.window?.notificationOffsetRight ?? 24,
    offsetBottom: cfg.window?.notificationOffsetBottom ?? 24,
    animation: clampEntryAnimation(
      opts?.animation ?? cfg.window?.notificationAnimation,
    ),
    sound: opts?.sound ?? clampNotificationSound(cfg.window?.notificationSound),
    visual: cfg.window?.notificationVisual,
  };
}

function SoundUploadButton({
  onUploaded,
  onError,
}: {
  onUploaded: (sound: LetreiroSound, catalog: LetreiroSound[]) => void;
  onError?: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          void api.uploadSound(file)
            .then(async (res) => {
              const listed = await api.listSounds().catch(() => ({ sounds: [res.sound] }));
              const catalog = listed.sounds?.length ? listed.sounds : [res.sound];
              onUploaded(res.sound, catalog);
            })
            .catch((ex) => onError?.(ex instanceof Error ? ex.message : String(ex)))
            .finally(() => setBusy(false));
        }}
      />
      <button
        type="button"
        className="rounded-lg bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Enviando…" : "Enviar MP3"}
      </button>
    </>
  );
}

function LetreiroDisplayFields({
  cfg,
  onChange,
  setores,
  listId,
  onPreview,
  presets = [],
  sounds = [],
  onSoundsChange,
  onError,
  section = "all",
}: {
  cfg: AppConfig;
  onChange: (next: AppConfig) => void;
  setores: string[];
  listId: string;
  onPreview?: (priority: string) => void;
  presets?: { id: number; nome: string; payload: unknown }[];
  sounds?: LetreiroSound[];
  onSoundsChange?: (next: LetreiroSound[]) => void;
  onError?: (msg: string) => void;
  section?: "bar" | "notifications" | "all";
}) {
  const [previewPriority, setPreviewPriority] = useState("");
  const globalSound = clampNotificationSound(cfg.window?.notificationSound);
  return (
    <div className="display-fields">
      {section !== "notifications" ? <div className="bar-fields form-grid">
      <label className="mt-4 block min-w-0 text-sm text-slate-400">
        Setor padrão
        <input
          list={listId}
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          value={cfg.board?.sector ?? ""}
          onChange={(e) => onChange({ ...cfg, board: { ...cfg.board, sector: e.target.value } })}
        />
        <datalist id={listId}>{setores.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="mt-4 block min-w-0 text-sm text-slate-400">
        Largura da barra (px)
        <input
          type="number"
          min={320}
          max={4000}
          step={1}
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          value={cfg.window?.width ?? 720}
          onChange={(e) => {
            const width = Number(e.target.value);
            if (!Number.isFinite(width)) return;
            onChange({ ...cfg, window: { ...cfg.window, width } });
          }}
        />
        <span className="mt-1 block text-xs text-slate-500">Entre 320 e 4000. Arrastar a faixa só move a posição.</span>
      </label>
      <label className="mt-4 block text-sm text-slate-400">
        Velocidade do deslize ({Math.round(cfg.window?.speedPxPerSec ?? 40)} px/s)
        <input type="range" min={8} max={160} className="mt-2 w-full" value={cfg.window?.speedPxPerSec ?? 40} onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, speedPxPerSec: Number(e.target.value) } })} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cfg.window?.tickerHtml !== false}
          onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, tickerHtml: e.target.checked } })}
        />
        Cards HTML na barra
      </label>
      <label className="mt-3 block min-w-0 text-sm text-slate-400">
        Modelo do card da barra
        <select
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          value={clampTickerModel(cfg.window?.tickerCardModel)}
          disabled={cfg.window?.tickerHtml === false}
          onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, tickerCardModel: e.target.value } })}
        >
          {TICKER_CARD_MODELS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">Escolha o estilo dos cards exibidos na barra.</span>
      </label>
      <label className="mt-3 block text-sm text-slate-400">
        Opacidade ({Math.round((cfg.window?.opacity ?? 0.95) * 100)}%)
        <input type="range" min={0.4} max={1} step={0.01} className="mt-2 w-full" value={cfg.window?.opacity ?? 0.95} onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, opacity: Number(e.target.value) } })} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!cfg.window?.transparentBg} onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, transparentBg: e.target.checked } })} />
        Fundo transparente
      </label>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.board?.showOs !== false} onChange={(e) => onChange({ ...cfg, board: { ...cfg.board, showOs: e.target.checked } })} />
          Ordens de serviço · OS (nº &lt; 5000)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.board?.showSp !== false} onChange={(e) => onChange({ ...cfg, board: { ...cfg.board, showSp: e.target.checked } })} />
          Solicitações · SP (nº ≥ 5000)
        </label>
      </div>
      </div> : null}
      {section !== "bar" ? <div className="notification-fields">
      {section === "all" ? <h4 className="form-group-title"><Bell size={17} /> Notificações</h4> : null}
      {onPreview ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[10rem] text-sm text-slate-400">
            Prioridade do teste
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={previewPriority}
              onChange={(e) => setPreviewPriority(e.target.value)}
            >
              <option value="">Normal</option>
              <option value="priority-medium">Média</option>
              <option value="priority-high">Alta</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100"
            onClick={() => onPreview(previewPriority)}
          >
            Testar notificação
          </button>
        </div>
      ) : null}
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-slate-400">
          Largura do card (px)
          <input
            type="number"
            min={180}
            max={900}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationWidth ?? 320}
            onChange={(e) => {
              const notificationWidth = Number(e.target.value);
              if (!Number.isFinite(notificationWidth)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationWidth } });
            }}
          />
        </label>
        <label className="min-w-0 text-sm text-slate-400">
          Altura do card (px)
          <input
            type="number"
            min={56}
            max={280}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationHeight ?? 96}
            onChange={(e) => {
              const notificationHeight = Number(e.target.value);
              if (!Number.isFinite(notificationHeight)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationHeight } });
            }}
          />
        </label>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-slate-400">
          Fonte do nº da OS (px)
          <input
            type="number"
            min={10}
            max={72}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationTitleFontSize ?? 22}
            onChange={(e) => {
              const notificationTitleFontSize = Number(e.target.value);
              if (!Number.isFinite(notificationTitleFontSize)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationTitleFontSize } });
            }}
          />
        </label>
        <label className="min-w-0 text-sm text-slate-400">
          Fonte da situação (px)
          <input
            type="number"
            min={8}
            max={56}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationSituationFontSize ?? 14}
            onChange={(e) => {
              const notificationSituationFontSize = Number(e.target.value);
              if (!Number.isFinite(notificationSituationFontSize)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationSituationFontSize } });
            }}
          />
        </label>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-slate-400">
          Espaço interno lateral (px)
          <input
            type="number"
            min={4}
            max={48}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationPadX ?? 16}
            onChange={(e) => {
              const notificationPadX = Number(e.target.value);
              if (!Number.isFinite(notificationPadX)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationPadX } });
            }}
          />
        </label>
        <label className="min-w-0 text-sm text-slate-400">
          Espaço entre textos (px)
          <input
            type="number"
            min={0}
            max={40}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationTextGap ?? 4}
            onChange={(e) => {
              const notificationTextGap = Number(e.target.value);
              if (!Number.isFinite(notificationTextGap)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationTextGap } });
            }}
          />
        </label>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-slate-400">
          Distância da direita do monitor (px)
          <input
            type="number"
            min={0}
            max={1200}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationOffsetRight ?? 24}
            onChange={(e) => {
              const notificationOffsetRight = Number(e.target.value);
              if (!Number.isFinite(notificationOffsetRight)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationOffsetRight } });
            }}
          />
        </label>
        <label className="min-w-0 text-sm text-slate-400">
          Distância da borda inferior (px)
          <input
            type="number"
            min={0}
            max={1200}
            step={1}
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={cfg.window?.notificationOffsetBottom ?? 24}
            onChange={(e) => {
              const notificationOffsetBottom = Number(e.target.value);
              if (!Number.isFinite(notificationOffsetBottom)) return;
              onChange({ ...cfg, window: { ...cfg.window, notificationOffsetBottom } });
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">Do card até as bordas direita e inferior do monitor em que o letreiro está.</p>
      <label className="mt-3 block min-w-0 text-sm text-slate-400">
        Animação de entrada
        <select
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          value={clampEntryAnimation(cfg.window?.notificationAnimation)}
          onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, notificationAnimation: e.target.value } })}
        >
          {CLASSIC_ENTRY_ANIMATIONS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="min-w-0 text-sm text-slate-400">
          Som de notificação (global)
          <select
            className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={globalSound}
            onChange={(e) => onChange({ ...cfg, window: { ...cfg.window, notificationSound: e.target.value } })}
          >
            <option value={MUTE_SOUND}>Sem som</option>
            {sounds.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
          disabled={globalSound === MUTE_SOUND}
          onClick={() => playCatalogSound(globalSound)}
        >
          Ouvir
        </button>
        <SoundUploadButton
          onError={onError}
          onUploaded={(sound, catalog) => {
            onSoundsChange?.(catalog);
            onChange({ ...cfg, window: { ...cfg.window, notificationSound: sound.id } });
          }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        O som padrão é usado nos filtros com notificação. Você pode escolher um som específico em cada filtro.
      </p>
      <label className="mt-3 block min-w-0 text-sm text-slate-400">
        Estilo visual da notificação
        <select
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          value={cfg.window?.notificationVisual?.presetId ?? ""}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!id) {
              onChange({ ...cfg, window: { ...cfg.window, notificationVisual: {} } });
              return;
            }
            const preset = presets.find((item) => item.id === id);
            if (!preset) return;
            onChange({
              ...cfg,
              window: {
                ...cfg.window,
                notificationVisual: visualFromPreset(preset.payload, preset.id, preset.nome),
              },
            });
          }}
        >
          <option value="">Padrão do letreiro</option>
          {presets.map((item) => (
            <option key={item.id} value={item.id}>{item.nome}</option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-slate-500">
        Os estilos salvos nos painéis definem cores, fontes e efeitos. O tamanho e a animação seguem os ajustes desta página.
      </p>
      </div> : null}
    </div>
  );
}

function FilterListFields({
  cfg,
  onChange,
  onError,
  setores,
  situacoes,
  listId,
  actions,
  sounds = [],
  onPreviewFilter,
}: {
  cfg: AppConfig;
  onChange: (next: AppConfig) => void;
  onError?: (msg: string) => void;
  setores: string[];
  situacoes: string[];
  listId: string;
  actions?: ReactNode;
  sounds?: LetreiroSound[];
  onPreviewFilter?: (row: DisplayFilter) => void;
}) {
  const filters = filtersFromColumns(cfg.board?.columns ?? []);
  const situacaoOptions = [...new Set([...situacoes, ...filters.map((row) => row.situacao).filter(Boolean)])];

  function patchFilter(index: number, patch: Partial<DisplayFilter>) {
    onChange(withFilters(cfg, filters.map((row, i) => (i === index ? { ...row, ...patch } : row))));
  }

  function addFilter() {
    onChange(withFilters(cfg, [
      ...filters,
      { key: `new-${Date.now()}`, setor: cfg.board?.sector ?? "", situacao: "", fonte: "situacao", notify: false, ponto: "", observacao: "", animation: "", sound: "" },
    ]));
  }

  function removeFilter(index: number) {
    if (filters.length <= 1) return onError?.("É necessário pelo menos um filtro.");
    onChange(withFilters(cfg, filters.filter((_, i) => i !== index)));
  }

  return (
    <>
      <datalist id={listId}>{setores.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Filtros de exibição <span className="count-badge">{filters.length}</span></h2>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Escolha quais informações aparecem na barra. Ative Notificar para receber um aviso quando uma OS entrar na situação escolhida.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={addFilter}>
            <Plus size={16} /> Adicionar
          </button>
          {actions}
        </div>
      </div>
      {filters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
          Nenhum filtro. Adicione um para exibir cards no letreiro.
        </p>
      ) : (
        <div className="grid gap-2">
          {filters.map((row, index) => (
            <div
              key={row.key}
              className="filter-card"
            >
              <div className="filter-card-heading"><span className="filter-number">{String(index + 1).padStart(2, "0")}</span><strong>{row.fonte === "inbox" ? "Caixa de entrada" : row.situacao || "Novo filtro"}</strong><span className={row.notify ? "filter-notify is-enabled" : "filter-notify"}><Bell size={12} />{row.notify ? "Com aviso" : "Só na barra"}</span></div>
              <div className="filter-primary">
                <label className="min-w-0 text-xs text-slate-500">
                  Setor
                  <input
                    list={listId}
                    aria-label="Setor"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={row.setor}
                    placeholder={cfg.board?.sector || "Setor"}
                    onChange={(e) => patchFilter(index, { setor: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-xs text-slate-500">
                  Situação
                  <select
                    aria-label="Situação"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:text-slate-500"
                    value={row.fonte === "inbox" ? "" : row.situacao}
                    disabled={row.fonte === "inbox"}
                    onChange={(e) => patchFilter(index, { situacao: e.target.value })}
                  >
                    <option value="">{row.fonte === "inbox" ? "—" : "Selecione…"}</option>
                    {situacaoOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-xs text-slate-500">
                  Fonte
                  <select
                    aria-label="Fonte"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={row.fonte}
                    onChange={(e) => {
                      const fonte = e.target.value as FilterFonte;
                      patchFilter(index, { fonte, situacao: fonte === "inbox" ? "" : row.situacao });
                    }}
                  >
                    <option value="situacao">Situação</option>
                    <option value="inbox">Inbox</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col text-xs text-slate-500 lg:items-center">
                  Notificar
                  <input
                    type="checkbox"
                    className="mt-2 h-4 w-4 accent-sky-400"
                    checked={!!row.notify}
                    aria-label="Notificar nesta situação"
                    onChange={(e) => patchFilter(index, { notify: e.target.checked })}
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center justify-self-end rounded-lg text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                  title="Remover filtro"
                  aria-label={`Remover filtro ${index + 1}`}
                  onClick={() => removeFilter(index)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <details className="filter-details" open={!!(row.notify || row.ponto || row.observacao || row.animation || row.sound)}>
              <summary>Refinar filtro e personalizar aviso <ChevronDown size={14} /></summary>
              <div className="filter-advanced">
                <label className="min-w-0 text-xs text-slate-500">
                  Ponto
                  <input
                    aria-label="Ponto de quem registrou"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={row.ponto}
                    placeholder="Qualquer"
                    onChange={(e) => patchFilter(index, { ponto: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-xs text-slate-500">
                  Observação
                  <input
                    aria-label="Texto na observação da OS"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={row.observacao}
                    placeholder="Trecho em qualquer lugar"
                    onChange={(e) => patchFilter(index, { observacao: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-xs text-slate-500">
                  Animação
                  <select
                    aria-label="Animação deste filtro"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:text-slate-500"
                    value={clampColumnAnimation(row.animation)}
                    disabled={!row.notify}
                    onChange={(e) => patchFilter(index, { animation: e.target.value })}
                  >
                    <option value="">Padrão</option>
                    {CLASSIC_ENTRY_ANIMATIONS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-xs text-slate-500">
                  Som
                  <select
                    aria-label="Som deste filtro"
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:text-slate-500"
                    value={clampColumnSound(row.sound)}
                    disabled={!row.notify}
                    onChange={(e) => patchFilter(index, { sound: e.target.value })}
                  >
                    <option value="">Padrão</option>
                    <option value={MUTE_SOUND}>Sem som</option>
                    {sounds.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded-lg bg-violet-500/90 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  disabled={!row.notify || !onPreviewFilter}
                  title={!row.notify ? "Marque Notificar para testar" : "Testar notificação deste filtro"}
                  onClick={() => onPreviewFilter?.(row)}
                >
                  Testar
                </button>
              </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [view, setView] = useState<View>("computers");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("bar");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedConfig, setSavedConfig] = useState("");
  const [instanceSearch, setInstanceSearch] = useState("");
  const [instanceStatus, setInstanceStatus] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState("Carregando…");
  const [error, setError] = useState("");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commands, setCommands] = useState<Command[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pollSec, setPollSec] = useState(10);
  const [shell, setShell] = useState<"bat" | "ps1">("bat");
  const [libraryId, setLibraryId] = useState(0);
  const [libraryVars, setLibraryVars] = useState<Record<string, string>>({});
  const [capturedVars, setCapturedVars] = useState<CapturedVars>(loadCapturedVars);
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState("SAGRA Letreiro · terminal remoto\nSelecione computadores e digite um comando.\n");
  const typed = useRef<string[]>([]);
  const typedIndex = useRef(-1);
  const printedJobs = useRef(new Set<number>());
  const jobsPrimed = useRef(false);
  const burstUntil = useRef(0);
  const onClientJobQueued = useCallback(() => { burstUntil.current = Date.now() + 120_000; }, []);
  const commandsRef = useRef<Command[]>([]);
  const logEl = useRef<HTMLPreElement | null>(null);
  const [draft, setDraft] = useState<Command>({ id: 0, name: "", kind: "bat", content: "", timeoutSec: 60 });
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState({ nome: "", setor: "" });
  const [localCfg, setLocalCfg] = useState<AppConfig>({});
  const [clientEdit, setClientEdit] = useState<{ row: Instance; cfg: AppConfig } | null>(null);
  const clientDialogRef = useRef<HTMLDivElement>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const clickTimer = useRef(0);
  const [painelPresets, setPainelPresets] = useState<{ id: number; nome: string; payload: unknown }[]>([]);
  const [sounds, setSounds] = useState<LetreiroSound[]>([]);
  const [configProfiles, setConfigProfiles] = useState<ConfigProfile[]>([]);
  const [profileAssignments, setProfileAssignments] = useState<ConfigProfileAssignment[]>([]);
  const [assignBusyKey, setAssignBusyKey] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const [settingsProfileId, setSettingsProfileId] = useState(0);
  const [editingProfileId, setEditingProfileId] = useState(0);
  const profileReturnConfig = useRef<AppConfig | null>(null);
  const [applyProfileId, setApplyProfileId] = useState(0);
  const [setores, setSetores] = useState<string[]>(["SEFOC", "Papelaria", "Gravação"]);
  const [situacoes, setSituacoes] = useState<string[]>(DEFAULT_SITUACOES);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hash, setHash] = useState(currentHash);
  const [jobId, setJobId] = useState<number | null>(null);
  const userAjustes = !isAdmin || hash === "ajustes";

  const selectedRows = useMemo(
    () => instances.filter((row) => selected.has(keyOf(row))),
    [instances, selected],
  );
  const visibleInstances = useMemo(() => {
    const sorted = uniqueInstances(instances).sort(compareInstances);
    return sorted.filter((row) =>
      textMatches(`${row.nome} ${row.setor} ${row.hostName} ${row.windowsUser}`, instanceSearch)
      && (instanceStatus === "all" || (instanceStatus === "online" ? row.online : !row.online)),
    );
  }, [instances, instanceSearch, instanceStatus]);
  const settingsInstances = useMemo(
    () => uniqueInstances(instances).sort(compareInstances),
    [instances],
  );
  const assignmentByKey = useMemo(() => {
    const map = new Map<string, ConfigProfileAssignment>();
    for (const row of profileAssignments) map.set(keyOf(row), row);
    return map;
  }, [profileAssignments]);

  const applyJobs = useCallback((next: Job[]) => {
    setJobs(next);
    if (!jobsPrimed.current) {
      for (const job of next) printedJobs.current.add(job.id);
      jobsPrimed.current = true;
      return;
    }
    const chunks: string[] = [];
    const newly: Job[] = [];
    for (const job of [...next].sort((a, b) => a.id - b.id)) {
      if (printedJobs.current.has(job.id) || !jobDone(job)) continue;
      printedJobs.current.add(job.id);
      if (isDesktopJob(job)) continue;
      newly.push(job);
      chunks.push(formatJobReply(job));
    }
    if (chunks.length) setLog((prev) => `${prev}${chunks.join("")}`);
    if (newly.length) {
      const capturing = newly.filter((job) => {
        const cmd = commandsRef.current.find((item) => item.name === job.name);
        return !!cmd && !!readCaptureVar(cmd.content);
      });
      if (capturing.length) {
        setCapturedVars((prev) => applyCapturesFromJobs(prev, capturing, commandsRef.current));
        const names = [...new Set(capturing.map((job) => {
          const cmd = commandsRef.current.find((item) => item.name === job.name);
          return cmd ? readCaptureVar(cmd.content) : "";
        }).filter(Boolean))];
        if (names.length) setStatus(`Gravou ${names.map((name) => `{{${name}}}`).join(", ")} (a lista permanece até você limpar).`);
      }
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [inst, cmds, jobList, settings] = await Promise.all([
        api.instances(),
        api.commands(),
        api.jobs(),
        api.settings(),
      ]);
      setInstances(inst.instances ?? []);
      setCommands(cmds.commands ?? []);
      commandsRef.current = cmds.commands ?? [];
      applyJobs(jobList.jobs ?? []);
      setPollSec(settings.commandPollIntervalSec ?? 10);
      setError("");
      setStatus(`${inst.instances?.length ?? 0} computador(es)`);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : "Falha ao carregar a administração.");
      setStatus("Sem dados");
    }
  }, [applyJobs]);

  useEffect(() => {
    void (async () => {
      const pageHash = currentHash();
      setHash(pageHash);
      if (pageHash === "ajustes") setView("settings");
      try {
        const me = await api.me();
        setIsAdmin(me.isAdmin);
        const onlyAjustes = pageHash === "ajustes" || !me.isAdmin;
        if (onlyAjustes) setView("settings");
        const [local, setorList, situacaoList, presetList, profileList, assignmentList, soundList] = await Promise.all([
          api.localConfig(),
          api.setores(),
          api.situacoes().catch(() => ({ situacoes: [] as string[] })),
          api.painelPresets().catch(() => ({ presets: [] as { id: number; nome: string; payload: unknown }[] })),
          api.configProfiles().catch(() => ({ profiles: [] as ConfigProfile[] })),
          api.configProfileAssignments().catch(() => ({ assignments: [] as ConfigProfileAssignment[] })),
          api.listSounds().catch(() => ({ sounds: [] as LetreiroSound[] })),
        ]);
        setPainelPresets(presetList.presets ?? []);
        setSounds(soundList.sounds ?? []);
        const loadedConfig = withNotifyMigration(withFreshPresetVisual(local, presetList.presets ?? []));
        setLocalCfg(loadedConfig);
        setSavedConfig(JSON.stringify(loadedConfig));
        setConfigProfiles(profileList.profiles ?? []);
        setProfileAssignments(assignmentList.assignments ?? []);
        if (setorList.setores?.length) setSetores(setorList.setores);
        if (situacaoList.situacoes?.length) {
          setSituacoes([...new Set([...situacaoList.situacoes, ...DEFAULT_SITUACOES])]);
        }
        if (me.isAdmin && !onlyAjustes) await loadAll();
        else {
          setError("");
          setStatus("Ajustes deste computador");
        }
      } catch (ex) {
        setError(ex instanceof ApiError ? ex.message : "Falha ao carregar a administração.");
        setStatus("Sem dados");
        setView("settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll]);

  useEffect(() => {
    const onHash = () => {
      const pageHash = currentHash();
      setHash(pageHash);
      if (pageHash === "ajustes") setView("settings");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (view !== "settings" || !isAdmin || userAjustes) return;
    void (async () => {
      try {
        if (instances.length === 0) await loadAll();
        await refreshProfileAssignments();
      } catch (ex) {
        setError(errText(ex));
      }
    })();
  }, [view, isAdmin, userAjustes, instances.length, loadAll]);

  useEffect(() => {
    if (!isAdmin || userAjustes) return;
    let timer = 0;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const row = await api.jobs();
          applyJobs(row.jobs ?? []);
        } catch {
          /* mantém a lista anterior */
        }
      }
      const wait = Date.now() < burstUntil.current ? 1000 : 5000;
      timer = window.setTimeout(() => void loop(), wait);
    };
    void loop();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applyJobs, isAdmin, userAjustes]);

  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  useEffect(() => {
    saveCapturedVars(capturedVars);
  }, [capturedVars]);

  useEffect(() => {
    if (!clientEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !clientBusy) setClientEdit(null);
      if (e.key === "Tab") {
        const controls = [...(clientDialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), summary, textarea:not(:disabled), [tabindex='0']") ?? [])].filter(el => el.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clientEdit, clientBusy]);

  const clientDialogOpen = clientEdit !== null;
  useEffect(() => {
    if (!clientDialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    clientDialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [clientDialogOpen]);

  function syncProfileFromSelection(next: Set<string>, fallback?: Instance) {
    if (next.size === 0) {
      setProfile({ nome: "", setor: "" });
      return;
    }
    const current = fallback && next.has(keyOf(fallback))
      ? fallback
      : instances.find((item) => next.has(keyOf(item)));
    setProfile({ nome: current?.nome ?? "", setor: current?.setor ?? "" });
  }

  function selectRow(row: Instance, additive: boolean) {
    const id = keyOf(row);
    if (!additive) {
      setSelected(new Set([id]));
      setProfile({ nome: row.nome ?? "", setor: row.setor ?? "" });
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    syncProfileFromSelection(next, row);
  }

  async function saveProfile() {
    const row = selectedRows[0];
    if (!row) return setError("Selecione um computador.");
    await api.saveProfile(row.hostName, row.windowsUser, profile.nome, profile.setor);
    setStatus(`Dados de ${row.hostName} (${row.windowsUser}) gravados.`);
    await loadAll();
  }

  function patchLocal(next: AppConfig) {
    setLocalCfg(next);
  }

  function onRowClick(row: Instance, e: { ctrlKey: boolean; metaKey: boolean }) {
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    const additive = e.ctrlKey || e.metaKey;
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = 0;
      selectRow(row, additive);
    }, 280);
  }

  async function openClientConfig(row: Instance) {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = 0;
    }
    setError("");
    setSelected(new Set([keyOf(row)]));
    setProfile({ nome: row.nome ?? "", setor: row.setor ?? "" });
    try {
      const data = await api.getConfig(row.hostName, row.windowsUser);
      setClientEdit({ row, cfg: seedClientConfig(row, data.payload) });
    } catch (ex) {
      setError(errText(ex));
    }
  }

  async function applyClientConfig() {
    if (!clientEdit) return;
    const { row, cfg } = clientEdit;
    const cols = cfg.board?.columns ?? [];
    if (cols.length === 0) return setError("É necessário pelo menos um filtro.");
    setClientBusy(true);
    setError("");
    try {
      await api.putConfig(remotePayload(cfg), row.hostName, row.windowsUser, false);
      setStatus(`Filtros e exibição aplicados em ${row.hostName} (${row.windowsUser}).`);
      setClientEdit(null);
    } catch (ex) {
      setError(errText(ex));
    } finally {
      setClientBusy(false);
    }
  }

  async function saveLocal() {
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveLocalConfig(localCfg);
      setLocalCfg(saved);
      setSavedConfig(JSON.stringify(saved));
      setStatus("Ajustes deste computador gravados.");
    } finally {
      setSaving(false);
    }
  }

  async function restoreGroups() {
    if (!window.confirm("Restaurar a lista padrão de filtros (SEFOC)?")) return;
    const restored = await api.restoreBoard();
    setLocalCfg(restored);
    setSavedConfig(JSON.stringify(restored));
    setStatus("Filtros restaurados.");
  }

  async function refreshConfigProfiles() {
    const list = await api.configProfiles();
    setConfigProfiles(list.profiles ?? []);
  }

  async function refreshProfileAssignments() {
    const list = await api.configProfileAssignments();
    setProfileAssignments(list.assignments ?? []);
  }

  function selectSettingsProfile(id: number) {
    setSettingsProfileId(id);
    const row = configProfiles.find((item) => item.id === id);
    setProfileDraftName(row?.name ?? "");
  }

  async function saveConfigProfile() {
    const name = profileDraftName.trim();
    if (!name) return setError("Informe o nome do perfil.");
    if (configProfiles.some((item) => item.id !== settingsProfileId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      return setError("Já existe um perfil com este nome.");
    setError("");
    setSaving(true);
    try {
      const saved = settingsProfileId
        ? await api.updateConfigProfile(settingsProfileId, name, localCfg)
        : await api.saveConfigProfile(name, localCfg);
      setConfigProfiles((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      setSettingsProfileId(saved.id);
      setProfileDraftName(saved.name);
      setApplyProfileId(saved.id);
      if (editingProfileId) {
        if (profileReturnConfig.current) setLocalCfg(profileReturnConfig.current);
        profileReturnConfig.current = null;
        setEditingProfileId(0);
        setSettingsSection("profiles");
      }
      setStatus(`Perfil “${saved.name}” gravado.`);
    } finally {
      setSaving(false);
    }
  }

  function loadConfigProfile() {
    const row = configProfiles.find((item) => item.id === settingsProfileId);
    if (!row) return setError("Selecione um perfil para carregar.");
    setError("");
    profileReturnConfig.current = structuredClone(localCfg);
    setEditingProfileId(row.id);
    setLocalCfg(mergeProfile(localCfg, row.payload ?? {}));
    setProfileDraftName(row.name);
    setSettingsSection("bar");
    setStatus(`Editando o perfil “${row.name}”. Altere os ajustes e clique em Salvar perfil.`);
  }

  function cancelProfileEdit() {
    if (profileReturnConfig.current) setLocalCfg(profileReturnConfig.current);
    profileReturnConfig.current = null;
    setEditingProfileId(0);
    setError("");
    setSettingsSection("profiles");
    setStatus("Edição do perfil cancelada.");
  }

  async function deleteConfigProfile() {
    const row = configProfiles.find((item) => item.id === settingsProfileId);
    if (!row) return setError("Selecione um perfil para excluir.");
    if (!window.confirm(`Excluir o perfil “${row.name}”?`)) return;
    await api.deleteConfigProfile(row.id);
    await refreshConfigProfiles();
    await refreshProfileAssignments().catch(() => undefined);
    setSettingsProfileId(0);
    setProfileDraftName("");
    if (applyProfileId === row.id) setApplyProfileId(0);
    setStatus(`Perfil “${row.name}” excluído.`);
  }

  async function applyConfigProfileToSelected() {
    const row = configProfiles.find((item) => item.id === applyProfileId);
    if (!row) return setError("Selecione um perfil de configuração.");
    if (selectedRows.length === 0) return setError("Selecione pelo menos um usuário.");
    setClientBusy(true);
    setError("");
    try {
      for (const target of selectedRows) {
        const data = await api.getConfig(target.hostName, target.windowsUser);
        const merged = mergeProfile(seedClientConfig(target, data.payload), row.payload ?? {});
        const cols = merged.board?.columns ?? [];
        if (cols.length === 0) throw new Error(`O perfil “${row.name}” não tem filtros.`);
        await api.putConfig(remotePayload(merged), target.hostName, target.windowsUser, false);
        await api.setConfigProfileAssignment(target.hostName, target.windowsUser, row.id);
      }
      await refreshProfileAssignments().catch(() => undefined);
      setStatus(`Perfil “${row.name}” aplicado em ${selectedRows.length} usuário(s). A posição da faixa permanece em cada PC.`);
    } catch (ex) {
      setError(errText(ex));
    } finally {
      setClientBusy(false);
    }
  }

  async function assignProfileFromSettings(row: Instance, profileId: number) {
    const busy = keyOf(row);
    setAssignBusyKey(busy);
    setError("");
    try {
      if (profileId <= 0) {
        await api.setConfigProfileAssignment(row.hostName, row.windowsUser, 0);
        await refreshProfileAssignments();
        setStatus(`Perfil removido de ${row.hostName} (${row.windowsUser}).`);
        return;
      }
      const profileRow = configProfiles.find((item) => item.id === profileId);
      if (!profileRow) throw new Error("Perfil não encontrado.");
      const data = await api.getConfig(row.hostName, row.windowsUser);
      const merged = mergeProfile(seedClientConfig(row, data.payload), profileRow.payload ?? {});
      const cols = merged.board?.columns ?? [];
      if (cols.length === 0) throw new Error(`O perfil “${profileRow.name}” não tem filtros.`);
      await api.putConfig(remotePayload(merged), row.hostName, row.windowsUser, false);
      await api.setConfigProfileAssignment(row.hostName, row.windowsUser, profileRow.id);
      await refreshProfileAssignments();
      setStatus(`Perfil “${profileRow.name}” aplicado em ${row.hostName} (${row.windowsUser}).`);
    } catch (ex) {
      setError(errText(ex));
    } finally {
      setAssignBusyKey("");
    }
  }

  function fillClientEditFromProfile(id: number) {
    const row = configProfiles.find((item) => item.id === id);
    if (!row || !clientEdit) return;
    setClientEdit({ ...clientEdit, cfg: mergeProfile(clientEdit.cfg, row.payload ?? {}) });
    setStatus(`Perfil “${row.name}” carregado. Clique em Aplicar configurações para gravar neste usuário.`);
  }

  async function watchQueued(queued: number, echo: string) {
    setStatus(queued === 1 ? "1 comando enfileirado." : `${queued} comandos enfileirados.`);
    burstUntil.current = Date.now() + 120_000;
    setLog((prev) => `${prev}${echo}aguardando resposta (${queued})…\n`);
    const jobList = await api.jobs();
    applyJobs(jobList.jobs ?? []);
  }

  function chooseLibrary(id: number) {
    setLibraryId(id);
    setLibraryVars({});
    const cmd = commands.find((item) => item.id === id);
    if (cmd) setShell(cmd.kind === "ps1" ? "ps1" : "bat");
  }

  async function sendTerminal(allOnline: boolean) {
    if (!allOnline && selectedRows.length === 0) return setError("Selecione computadores ou envie a todos os online.");
    const targets = selectedRows.map((row) => ({ hostName: row.hostName, windowsUser: row.windowsUser }));
    const catalog = commands.find((cmd) => cmd.id === libraryId);
    if (catalog) {
      const varNames = extractCommandVars(catalog.content);
      const rendered = applyCommandVars(catalog.content, libraryVars);
      if (!rendered.ok) return setError(`Preencha: ${rendered.missing.join(", ")}`);
      const marker = catalog.kind === "ps1" ? "PS>" : "C:\\>";
      const preview = varNames.length
        ? `${catalog.name} ${varNames.map((name) => `${name}=${libraryVars[name] ?? ""}`).join(" ")}`
        : catalog.name;
      setLog((prev) => `${prev}${marker} ${preview}\n`);
      const queued = varNames.length
        ? await api.runAdhoc(catalog.kind === "ps1" ? "ps1" : "bat", rendered.content, catalog.name, targets, allOnline, catalog.timeoutSec)
        : await api.runCommand(catalog.id, targets, allOnline);
      await watchQueued(queued.queued, "");
      return;
    }
    const text = prompt.trimEnd();
    if (!text.trim()) return setError("Digite um comando ou escolha um da biblioteca.");
    if (typed.current.at(-1) !== text) typed.current.push(text);
    typedIndex.current = typed.current.length;
    const name = text.replace(/\s+/g, " ").slice(0, 40);
    const marker = shell === "ps1" ? "PS>" : "C:\\>";
    setLog((prev) => `${prev}${marker} ${text.trim()}\n`);
    const queued = await api.runAdhoc(shell, text, name, targets, allOnline);
    setPrompt("");
    await watchQueued(queued.queued, "");
  }

  async function saveCommand() {
    if (!draft.name.trim() || !stripCaptureLine(draft.content).trim()) return setError("Nome e conteúdo são obrigatórios.");
    if (draft.id > 0) await api.updateCommand(draft);
    else {
      const created = await api.createCommand(draft);
      setDraft((cur) => ({ ...cur, id: created.id }));
    }
    setStatus("Script gravado.");
    const cmds = await api.commands();
    setCommands(cmds.commands ?? []);
  }

  const filteredCommands = commands.filter((cmd) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${cmd.name} ${cmd.kind} ${cmd.content}`.toLowerCase().includes(q);
  });

  const activeJob = jobs.find((job) => job.id === jobId) ?? jobs[0];
  const libraryCmd = commands.find((cmd) => cmd.id === libraryId);
  const libraryVarNames = useMemo(() => extractCommandVars(libraryCmd?.content ?? ""), [libraryCmd?.content]);
  const draftVarNames = useMemo(() => extractCommandVars(draft.content), [draft.content]);
  const draftCapture = readCaptureVar(draft.content);
  const savedGroups = useMemo(() => capturedGroups(capturedVars), [capturedVars]);

  function clearCapturedVar(name: string) {
    setCapturedVars((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setStatus(`Lista {{${name}}} limpa.`);
  }

  function clearAllCapturedVars() {
    setCapturedVars({});
    setStatus("Listas de variáveis limpas.");
  }

  const fillView = view === "computers" || view === "library" || view === "history";
  const dirty = !!savedConfig && savedConfig !== JSON.stringify(localCfg);
  const onlineCount = settingsInstances.filter(row => row.online).length;
  const pageInfo = PAGE_INFO[userAjustes ? "settings" : view];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Ir para o conteúdo</a>
      <header className="mobile-header">
        <div className="brand"><span className="brand-mark"><Radio size={20} /></span><div><strong>SAGRA <span>Letreiro</span></strong><small>{userAjustes ? "Meu espaço" : "Administração"}</small></div></div>
        <button className="icon-button" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="app-navigation">
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      <aside
        id="app-navigation"
        className={`app-sidebar ${menuOpen ? "is-open" : ""}`}
      >
        <div className="brand sidebar-brand"><span className="brand-mark"><Radio size={22} /></span><div><strong>SAGRA <span>Letreiro</span></strong><small>Central de {userAjustes ? "ajustes" : "administração"}</small></div></div>
        <p className="eyebrow sidebar-label">{userAjustes ? "Personalização" : "Gerenciamento"}</p>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {(userAjustes ? NAV.filter((item) => item.id === "settings") : NAV).map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setMenuOpen(false);
                }}
                aria-current={active ? "page" : undefined}
                className={`sidebar-link ${active ? "is-active" : ""}`}
              >
                <Icon size={18} />
                {item.label}
                {item.id === "computers" ? <span className="nav-count">{settingsInstances.length}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
        <div className="sidebar-context"><span className="context-icon"><Monitor size={18} /></span><div><strong>{userAjustes ? "Este computador" : "Gestão centralizada"}</strong><span>{userAjustes ? localCfg.board?.sector || "Ajustes locais" : `${onlineCount} ${onlineCount === 1 ? "estação" : "estações"} online`}</span></div></div>
        <button
          onClick={() => {
            if (userAjustes) void api.localConfig().then(cfg => { const next = withNotifyMigration(withFreshPresetVisual(cfg, painelPresets)); setLocalCfg(next); setSavedConfig(JSON.stringify(next)); }).catch((ex) => setError(errText(ex)));
            else void loadAll();
          }}
          disabled={loading || saving}
          className="refresh-button"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
        <p className="sidebar-version">SAGRA Letreiro <span>v{__APP_VERSION__}</span></p>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className={`app-main ${fillView && !userAjustes ? "app-main--workspace" : ""}`}>
        <div className="page-heading">
          <div className="min-w-0"><p className="eyebrow">{userAjustes ? "Meu letreiro" : "Administração"}<span className="breadcrumb-separator">/</span>{view === "settings" ? "Preferências" : NAV.find(item => item.id === view)?.label}</p><h1>{pageInfo.title}</h1><p className="page-description">{pageInfo.description}</p></div>
          {view === "settings" ? <span className="scope-badge"><Monitor size={14} /> Este computador</span> : <span className="scope-badge"><span className="status-dot online" />{onlineCount} online</span>}
        </div>
        <div role="status" aria-live="polite" className="feedback-status"><Check size={14} /><span>{status}</span></div>
        {error ? (
          <div role="alert" className="feedback-error"><CircleAlert size={18} /><span>{error}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setError("")}><X size={16} /></button></div>
        ) : null}
        {loading ? <div className="loading-state"><LoaderCircle className="animate-spin" size={24} /><strong>Carregando seu letreiro</strong><span>Preparando configurações e informações…</span></div> : <>

        {view === "computers" ? (
          <>
          <div className="overview-metrics">
            <div><span className="metric-icon"><Monitor size={18} /></span><div><span>Estações registradas</span><strong>{settingsInstances.length}</strong></div></div>
            <div><span className="metric-icon metric-icon--green"><Radio size={18} /></span><div><span>Online agora</span><strong>{onlineCount}<small>disponíveis</small></strong></div></div>
            <div><span className="metric-icon"><Unplug size={18} /></span><div><span>Offline</span><strong>{settingsInstances.length - onlineCount}</strong></div></div>
            <div><span className="metric-icon"><Check size={18} /></span><div><span>Selecionadas</span><strong>{selectedRows.length}<small>para ações</small></strong></div></div>
          </div>
          <section className="computers-workspace">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-card">
              <div className="shrink-0 border-b border-slate-800 px-3 py-3 sm:px-4">
                <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Estações de trabalho</h2><span className="count-badge">{visibleInstances.length}</span></div>
                <div className="search-field"><Search size={16} /><input aria-label="Buscar computadores" placeholder="Buscar nome, setor ou computador…" value={instanceSearch} onChange={e => setInstanceSearch(e.target.value)} /></div>
                <div className="instance-list-toolbar"><div className="status-filters">{[["all", "Todos"], ["online", "Online"], ["offline", "Offline"]].map(([value, label]) => <button type="button" key={value} aria-pressed={instanceStatus === value} className={instanceStatus === value ? "is-active" : ""} onClick={() => setInstanceStatus(value)}>{label}</button>)}</div>{selected.size ? <button type="button" className="text-xs text-sky-300" onClick={() => { setSelected(new Set()); syncProfileFromSelection(new Set()); }}>Limpar seleção</button> : null}</div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="instance-list">
                    {visibleInstances.length === 0 ? (
                      <div className="empty-state"><Monitor size={28} /><strong>{instances.length === 0 ? "Nenhuma estação conectada" : "Nenhum resultado"}</strong><p>{instances.length === 0 ? "Os computadores aparecerão aqui quando o letreiro se conectar." : "Tente outro nome, setor ou estado de conexão."}</p></div>
                    ) : null}
                    {visibleInstances.map((row) => {
                      const on = selected.has(keyOf(row));
                      return (
                        <div
                          key={keyOf(row)}
                          className={`instance-card ${on ? "is-selected" : ""}`}
                          onClick={(e) => onRowClick(row, e)}
                          onDoubleClick={() => void openClientConfig(row)}
                        >
                          <input type="checkbox" checked={on} aria-label={`Selecionar ${row.nome || row.windowsUser} em ${row.hostName}`} onClick={e => e.stopPropagation()} onChange={() => selectRow(row, true)} />
                          <div className="instance-card-content"><div className="instance-card-title"><strong>{row.nome || row.windowsUser}</strong><span className={`connection-badge ${row.online ? "is-online" : ""}`}><i />{row.online ? "Online" : "Offline"}</span></div><span className="instance-user">{row.windowsUser}</span><div className="instance-meta"><span><Monitor size={12} />{row.hostName}</span><span>{row.setor || "Sem setor"}</span></div></div>
                          <button type="button" className="icon-button" aria-label={`Editar filtros de ${row.nome || row.windowsUser}`} onClick={e => { e.stopPropagation(); void openClientConfig(row); }}><Settings2 size={16} /></button>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <ClientControlPanel
              key={selectedRows.length === 1 ? desktopTargetKey(selectedRows[0]) : "no-single-target"}
              target={selectedRows.length === 1 ? selectedRows[0] : null}
              selectionCount={selectedRows.length}
              commands={commands}
              jobs={jobs}
              onQueued={onClientJobQueued}
              onJobs={applyJobs}
              onOpenLibrary={() => setView("library")}
            />

            <div className="computer-detail">
              <div className="selection-panel">
              <div className="selection-heading"><div><h2>{selectedRows.length ? `${selectedRows.length} ${selectedRows.length === 1 ? "estação selecionada" : "estações selecionadas"}` : "Selecione uma estação"}</h2><p>{selectedRows.length ? "Aplique um perfil ou use o terminal para enviar comandos." : "Use as caixas de seleção da lista para escolher os destinos."}</p></div><ArrowRight size={18} /></div>
              <div className="grid shrink-0 gap-2 sm:grid-cols-2">
                <label className="min-w-0 text-sm text-slate-400">
                  Nome
                  <input
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={profile.nome}
                    disabled={selectedRows.length !== 1}
                    placeholder="Nome de exibição"
                    onChange={(e) => setProfile((p) => ({ ...p, nome: e.target.value }))}
                  />
                </label>
                <label className="min-w-0 text-sm text-slate-400">
                  Setor
                  <input
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={profile.setor}
                    disabled={selectedRows.length !== 1}
                    placeholder="Setor de trabalho"
                    onChange={(e) => setProfile((p) => ({ ...p, setor: e.target.value }))}
                  />
                </label>
              </div>
              <div className="flex shrink-0 flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-sm text-slate-400">
                  Perfil de configuração
                  <select
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={applyProfileId}
                    onChange={(e) => setApplyProfileId(Number(e.target.value))}
                  >
                    <option value={0}>Escolher perfil…</option>
                    {configProfiles.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="whitespace-nowrap rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                  disabled={clientBusy || !selectedRows.length || !applyProfileId}
                  onClick={() => void applyConfigProfileToSelected().catch((ex) => setError(errText(ex)))}
                >
                  {clientBusy ? "Aplicando…" : "Aplicar aos selecionados"}
                </button>
                <button
                  type="button"
                  className="whitespace-nowrap rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100"
                  disabled={selectedRows.length !== 1}
                  onClick={() => void saveProfile().catch(ex => setError(errText(ex)))}
                >
                  Salvar nome/setor
                </button>
              </div>
              </div>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible rounded-2xl border border-slate-800 bg-slate-950 shadow-card">
              <div className="relative z-20 flex shrink-0 flex-col gap-3 border-b border-slate-800 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <TerminalSquare size={16} className="shrink-0 text-sky-400" />
                  <div className="min-w-0">
                    <h2 className="font-semibold">Terminal remoto</h2>
                    <p className="text-xs text-slate-400">{selectedRows.length} {selectedRows.length === 1 ? "destino selecionado" : "destinos selecionados"}</p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex rounded-lg bg-slate-900 p-1">
                    <button type="button" className={`rounded-md px-3 py-1 text-sm ${shell === "bat" ? "bg-slate-800 text-white" : "text-slate-400"}`} onClick={() => { setShell("bat"); chooseLibrary(0); }}>CMD</button>
                    <button type="button" className={`rounded-md px-3 py-1 text-sm ${shell === "ps1" ? "bg-slate-800 text-white" : "text-slate-400"}`} onClick={() => { setShell("ps1"); chooseLibrary(0); }}>PowerShell</button>
                  </div>
                  <LibraryCombobox commands={commands} value={libraryId} onChange={chooseLibrary} />
                </div>
              </div>
              <pre ref={logEl} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm text-emerald-300">{log}</pre>
              <form
                className="flex max-h-[48%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-slate-800 bg-slate-900 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendTerminal(false).catch((ex) => setError(errText(ex)));
                }}
              >
                {savedGroups.length ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2">
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">Salvas</span>
                    {savedGroups.map((group) => (
                      <span key={group.name} className="inline-flex items-center gap-1 rounded-full bg-slate-800 pl-2 text-[11px] text-slate-200">
                        <span className="font-mono">{`{{${group.name}}}`}</span>
                        <span className="text-slate-400">{group.options.length}</span>
                        <button
                          type="button"
                          className="rounded-full p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-300"
                          title={`Limpar {{${group.name}}}`}
                          onClick={() => clearCapturedVar(group.name)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <button type="button" className="ml-auto text-[11px] text-slate-400 hover:text-rose-300" onClick={clearAllCapturedVars}>
                      Limpar listas
                    </button>
                  </div>
                ) : null}
                {libraryVarNames.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {libraryVarNames.map((name) => {
                      const current = libraryVars[name] ?? "";
                      const selectedInLists = savedGroups.some((group) => group.options.some((item) => item.value === current));
                      return (
                        <label key={name} className="text-xs text-slate-400">
                          {name}
                          {savedGroups.length ? (
                            <select
                              aria-label={`Valores salvos para ${name}`}
                              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
                              value={selectedInLists ? current : ""}
                              onChange={(e) => setLibraryVars((prev) => ({ ...prev, [name]: e.target.value }))}
                            >
                              <option value="">Escolher valor salvo…</option>
                              {savedGroups.map((group) => (
                                <optgroup key={group.name} label={`{{${group.name}}} · ${group.sourceName}`}>
                                  {group.options.map((item) => (
                                    <option key={`${group.name}:${item.value}:${item.label}`} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          ) : (
                            <span className="mt-1 block text-[11px] text-slate-500">Sem listas ainda. Rode um comando que grava variáveis.</span>
                          )}
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100"
                            value={libraryVars[name] ?? ""}
                            onChange={(e) => setLibraryVars((prev) => ({ ...prev, [name]: e.target.value }))}
                            placeholder={`{{${name}}}`}
                            autoComplete="off"
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="shrink-0 font-mono text-emerald-400">{shell === "ps1" ? "PS>" : "C:\\>"}</span>
                  {libraryVarNames.length ? (
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-300" title={libraryCmd?.name}>
                      {libraryCmd?.name}
                    </span>
                  ) : (
                    <input
                      value={prompt}
                      onChange={(e) => {
                        setPrompt(e.target.value);
                        if (libraryId) chooseLibrary(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          if (!typed.current.length) return;
                          typedIndex.current = Math.max(0, typedIndex.current < 0 ? typed.current.length - 1 : typedIndex.current - 1);
                          setPrompt(typed.current[typedIndex.current] ?? "");
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          typedIndex.current = Math.min(typed.current.length, typedIndex.current + 1);
                          setPrompt(typed.current[typedIndex.current] ?? "");
                        }
                      }}
                            aria-label="Comando do terminal"
                            className="flex-1 bg-transparent font-mono text-sm outline-none"
                      placeholder={libraryCmd ? `Enviar: ${libraryCmd.name}` : "ipconfig /all"}
                    />
                  )}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void sendTerminal(true).catch((ex) => setError(errText(ex)))}>
                      Todos online
                    </button>
                    <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950">
                      <Send size={14} /> Enviar
                    </button>
                  </div>
                </div>
              </form>
            </section>
            </div>
          </section>
          </>
        ) : null}

        {view === "library" ? (
          <section className="library-workspace">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
              <div className="shrink-0 space-y-3 p-3 sm:p-4">
                <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Buscar scripts" value={search} onChange={(e) => setSearch(e.target.value)} />
                <button className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => setDraft({ id: 0, name: "", kind: "bat", content: "", timeoutSec: 60 })}>
                  Novo script
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3 sm:px-4 sm:pb-4">
                <div className="grid min-w-0 gap-2">
                  {filteredCommands.map((cmd) => (
                    <button key={cmd.id} onClick={() => setDraft(cmd)} className={`min-w-0 overflow-hidden rounded-xl border px-3 py-3 text-left ${draft.id === cmd.id ? "border-sky-400 bg-slate-950" : "border-slate-800 bg-slate-950/60"}`}>
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 break-words font-semibold">{cmd.name}</span>
                        <span className="flex max-w-[46%] shrink-0 flex-wrap items-center justify-end gap-1">
                          {readCaptureVar(cmd.content) ? (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-emerald-300">GRAVA</span>
                          ) : null}
                          {extractCommandVars(cmd.content).length ? (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-sky-300">VARS</span>
                          ) : null}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cmd.kind === "ps1" ? "bg-sky-400 text-slate-950" : "bg-amber-400 text-slate-950"}`}>
                            {cmd.kind === "ps1" ? "PS1" : "BAT"}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-400">{stripCaptureLine(cmd.content) || "vazio"}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
              <div className="max-h-[42%] shrink-0 space-y-3 overflow-y-auto p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0 text-sm text-slate-400">Nome
                    <input className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                  </label>
                  <label className="min-w-0 text-sm text-slate-400">Timeout
                    <input type="number" className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={draft.timeoutSec} onChange={(e) => setDraft((d) => ({ ...d, timeoutSec: Number(e.target.value) }))} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={`rounded-lg px-3 py-1.5 text-sm ${draft.kind === "bat" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`} onClick={() => setDraft((d) => ({ ...d, kind: "bat", content: writeCaptureVar(d.content, "bat", readCaptureVar(d.content)) }))}>CMD</button>
                  <button className={`rounded-lg px-3 py-1.5 text-sm ${draft.kind === "ps1" ? "bg-sky-400 text-slate-950" : "bg-slate-800"}`} onClick={() => setDraft((d) => ({ ...d, kind: "ps1", content: writeCaptureVar(d.content, "ps1", readCaptureVar(d.content)) }))}>PowerShell</button>
                </div>
                <label className="block text-sm text-slate-400">
                  Gravar da resposta a variável
                  <input
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                    value={draftCapture}
                    onChange={(e) => setDraft((d) => ({ ...d, content: writeCaptureVar(d.content, d.kind, e.target.value) }))}
                    placeholder="janela_id"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Se preencher, a saída deste comando entra na lista de <span className="font-mono">{"{{variavel}}"}</span> e permanece até você limpar.
                  </span>
                </label>
              </div>
              <div className="min-h-0 min-w-0 flex-1">
                <textarea
                  className="block h-full min-h-0 w-full min-w-0 resize-none overflow-auto border-y border-slate-700 bg-slate-950 p-3 font-mono text-sm"
                  value={stripCaptureLine(draft.content)}
                  onChange={(e) => setDraft((d) => ({ ...d, content: writeCaptureVar(e.target.value, d.kind, readCaptureVar(d.content)) }))}
                  placeholder={'ping {{host}} -n {{count}}'}
                />
              </div>
              <div className="shrink-0 space-y-2 border-t border-slate-800 bg-slate-900/90 p-3 sm:p-4">
                <p className="text-xs text-slate-500">
                  Use <span className="font-mono text-slate-300">{"{{variavel}}"}</span> no script. Ao executar, o terminal pede esses campos.
                </p>
                {draftVarNames.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {draftVarNames.map((name) => (
                      <span key={name} className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-sky-300">
                        {`{{${name}}}`}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <label className="rounded-lg bg-slate-800 px-3 py-2 text-sm">
                    Importar arquivo
                    <input type="file" accept=".bat,.ps1" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const content = await file.text();
                      const kind = file.name.toLowerCase().endsWith(".ps1") ? "ps1" : "bat";
                      setDraft({ id: 0, name: file.name.replace(/\.(bat|ps1)$/i, ""), kind, content, timeoutSec: 60 });
                    }} />
                  </label>
                  <button className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void saveCommand().catch((ex) => setError(errText(ex)))}>Salvar</button>
                  <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => {
                    setShell(draft.kind === "ps1" ? "ps1" : "bat");
                    if (draft.id > 0) {
                      chooseLibrary(draft.id);
                      setPrompt("");
                    } else {
                      chooseLibrary(0);
                      setPrompt(draft.content);
                    }
                    setView("computers");
                  }}>Usar no terminal</button>
                  {draft.id > 0 ? (
                    <button className="rounded-lg bg-rose-900 px-3 py-2 text-sm" onClick={() => void api.deleteCommand(draft.id).then(loadAll)}>Excluir</button>
                  ) : null}
                  {draft.id > 0 ? (
                    <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => {
                      if (draftVarNames.length) {
                        chooseLibrary(draft.id);
                        setView("computers");
                        setStatus("Preencha as variáveis no terminal para enviar.");
                        return;
                      }
                      void api.runCommand(draft.id, selectedRows.map((r) => ({ hostName: r.hostName, windowsUser: r.windowsUser })), false).then(async (r) => {
                        setStatus(`${r.queued} job(s)`);
                        burstUntil.current = Date.now() + 120_000;
                        setLog((prev) => `${prev}${shell === "ps1" || draft.kind === "ps1" ? "PS>" : "C:\\>"} ${draft.content.trim()}\naguardando resposta (${r.queued})…\n`);
                        setView("computers");
                        const list = await api.jobs();
                        applyJobs(list.jobs ?? []);
                      });
                    }}>Enviar selecionados</button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {view === "history" ? (
          <section className="history-workspace">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-3">
                <h2 className="font-semibold">Histórico</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-900 px-3 py-1.5 text-sm text-slate-100 disabled:opacity-50"
                  disabled={!jobs.length}
                  onClick={() => {
                    if (!window.confirm("Limpar todo o histórico de comandos?")) return;
                    void api.clearJobs().then(() => {
                      applyJobs([]);
                      setJobId(null);
                      setStatus("Histórico limpo.");
                    }).catch((ex) => setError(errText(ex)));
                  }}
                >
                  <Trash2 size={14} /> Limpar
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
                {jobs.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-slate-400">Nenhum comando.</p>
                ) : jobs.map((job) => (
                  <button key={job.id} onClick={() => setJobId(job.id)} className={`mb-2 w-full min-w-0 overflow-hidden rounded-xl px-3 py-2 text-left ${activeJob?.id === job.id ? "bg-slate-800" : ""}`}>
                    <div className="break-words font-medium">{isDesktopJob(job) ? desktopJobLabel(job) : job.name}</div>
                    <div className="truncate text-xs text-slate-400">{job.hostName} · {job.status}</div>
                  </button>
                ))}
              </div>
            </div>
            <pre className="min-h-0 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-emerald-300">
              {activeJob ? `${isDesktopJob(activeJob) ? `${desktopJobLabel(activeJob)} · ${activeJob.status}\nConsulte o painel Ações do client em Computadores. A captura pode ser atualizada pelo botão Print de tela.` : activeJob.stdout || ""}${activeJob.stderr ? `\nSTDERR:\n${activeJob.stderr}` : ""}` : "Sem saída."}
            </pre>
          </section>
        ) : null}

        {view === "settings" ? (
          <section className="settings-page" aria-label="Configurações do letreiro">
            <SettingsSummary cfg={localCfg} profiles={configProfiles.length} />
            <nav className="settings-nav" aria-label="Categorias de ajustes">
              {SETTINGS_NAV.filter(item => !userAjustes || item.id !== "connection").map(item => {
                const Icon = item.icon;
                return <button type="button" key={item.id} aria-pressed={settingsSection === item.id} className={settingsSection === item.id ? "is-active" : ""} onClick={() => setSettingsSection(item.id)}><Icon size={16} />{item.label}</button>;
              })}
            </nav>
            <fieldset disabled={saving || !savedConfig} className="min-w-0 space-y-5">
            <div className={settingsSection === "bar" || settingsSection === "notifications" ? "settings-layout" : "min-w-0"}>
              {!userAjustes && settingsSection === "connection" ? (
                <div className="settings-card">
                  <div className="section-heading"><span className="section-icon"><Unplug size={20} /></span><div><h2>Conexão e acesso</h2>
                  <p className="mt-1 text-sm text-slate-400">Conta e API deste computador.</p>
                  </div></div>
                  <div className="mt-4 grid gap-3">
                    <Field label="API" value={localCfg.apiBaseUrl ?? ""} onChange={(v) => patchLocal({ ...localCfg, apiBaseUrl: v })} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Ponto" value={localCfg.ponto ?? ""} onChange={(v) => patchLocal({ ...localCfg, ponto: v })} />
                      <Field label="Nome" value={localCfg.nome ?? ""} onChange={(v) => patchLocal({ ...localCfg, nome: v })} />
                    </div>
                    <Field label="Senha (se o IP exigir)" value={localCfg.password ?? ""} onChange={(v) => patchLocal({ ...localCfg, password: v })} password />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!localCfg.sslVerify} onChange={(e) => patchLocal({ ...localCfg, sslVerify: e.target.checked })} />
                      Verificar certificado SSL
                    </label>
                  </div>
                </div>
              ) : null}
              {settingsSection === "bar" || settingsSection === "notifications" ? <>
              <div className="settings-card">
                <div className="section-heading"><span className="section-icon">{settingsSection === "bar" ? <SlidersHorizontal size={20} /> : <Bell size={20} />}</span><div><h2>{settingsSection === "bar" ? "Barra do letreiro" : "Notificações"}</h2>
                <p>{settingsSection === "bar" ? "Defina como as informações aparecem na sua área de trabalho." : "Ajuste os cards de aviso, as animações e os sons."}</p></div></div>
                <LetreiroDisplayFields
                  section={settingsSection}
                  cfg={localCfg}
                  onChange={patchLocal}
                  setores={setores}
                  listId="setores-list"
                  presets={painelPresets}
                  sounds={sounds}
                  onSoundsChange={setSounds}
                  onError={setError}
                  onPreview={(priority) => void api.previewNotification(previewNotificationPayload(localCfg, { priority }))
                    .then(() => setStatus("Notificação de teste disparada."))
                    .catch((ex) => setError(errText(ex)))}
                />
              </div>
              <ConfigPreview cfg={localCfg} notifications={settingsSection === "notifications"} editingProfile={!!editingProfileId} />
              </> : null}
            </div>

            {settingsSection === "filters" ? <div className="settings-card">
                <FilterListFields
                  cfg={localCfg}
                  onChange={patchLocal}
                  onError={setError}
                  setores={setores}
                  situacoes={situacoes}
                  sounds={sounds}
                  listId="setores-list-filtros"
                  onPreviewFilter={(row) => void api.previewNotification(previewNotificationPayload(localCfg, {
                    animation: resolveFilterAnimation(row.animation, localCfg.window?.notificationAnimation),
                    sound: resolveFilterSound(row.sound, localCfg.window?.notificationSound),
                  }))
                    .then(() => setStatus(`Teste do filtro “${row.situacao || row.fonte}” disparado.`))
                    .catch((ex) => setError(errText(ex)))}
                  actions={
                    <>
                      <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void restoreGroups().catch((ex) => setError(errText(ex)))}>Restaurar padrão</button>
                    </>
                  }
                />
              </div> : null}

              {!userAjustes && settingsSection === "connection" ? (
                <div className="min-w-0 space-y-4">
                  <div className="settings-card">
                    <h2 className="text-lg font-bold">Intervalo de comandos</h2>
                    <p className="mt-1 text-sm text-slate-400">Frequência de consulta de comandos em todos os computadores.</p>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                      <label className="flex items-center gap-3 text-sm"><input aria-label="Intervalo de comandos em segundos" type="number" min={1} max={120} className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))} />segundos</label>
                      <button disabled={!Number.isInteger(pollSec) || pollSec < 1 || pollSec > 120} className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={() => void api.saveSettings(pollSec).then(() => setStatus(`Intervalo de comandos atualizado para ${pollSec} segundos.`)).catch((ex) => setError(errText(ex)))}>Aplicar intervalo</button>
                    </div>
                  </div>
                </div>
              ) : null}

            {!userAjustes && settingsSection === "profiles" ? (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-card">
                <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
                  <h2 className="text-xl font-bold">Computadores e perfis</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Escolha o perfil salvo na coluna Perfil para aplicar imediatamente naquela máquina. A posição da faixa permanece no PC de destino.
                  </p>
                </div>
                <div className="max-h-[min(28rem,55vh)] overflow-auto">
                  <table className="profiles-table w-full min-w-[42rem] text-sm">
                    <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                      <tr>
                        <th className="w-6 px-3 py-3 font-medium" aria-label="Estado" />
                        {["Nome", "Setor", "Computador", "Usuário", "Perfil"].map((h) => (
                          <th key={h} className="px-3 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settingsInstances.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">
                            Nenhum computador com letreiro.
                          </td>
                        </tr>
                      ) : null}
                      {settingsInstances.map((row) => {
                        const busy = assignBusyKey === keyOf(row);
                        const assignedId = assignmentByKey.get(keyOf(row))?.profileId ?? 0;
                        return (
                          <tr key={keyOf(row)} className="border-t border-slate-800 hover:bg-slate-800/40">
                            <td data-label="Conexão" className="px-3 py-3">
                              <span
                                className={`mx-auto block h-2 w-2 rounded-full ${row.online ? "bg-emerald-400" : "bg-rose-500"}`}
                                title={row.online ? "Online" : "Offline"}
                                aria-label={row.online ? "Online" : "Offline"}
                              />
                              <span className="table-status-label">{row.online ? "Online" : "Offline"}</span>
                            </td>
                            <td data-label="Nome" className="max-w-[8rem] truncate px-3 py-3 font-medium" title={row.nome || undefined}>{row.nome || "—"}</td>
                            <td data-label="Setor" className="max-w-[7rem] truncate px-3 py-3" title={row.setor || undefined}>{row.setor || "—"}</td>
                            <td data-label="Computador" className="max-w-[8rem] truncate px-3 py-3" title={row.hostName}>{row.hostName}</td>
                            <td data-label="Usuário" className="max-w-[8rem] truncate px-3 py-3" title={row.windowsUser}>{row.windowsUser}</td>
                            <td data-label="Perfil" className="min-w-[12rem] px-3 py-2">
                              <select
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 disabled:opacity-60"
                                value={assignedId}
                                disabled={busy || clientBusy || configProfiles.length === 0}
                                title={configProfiles.length === 0 ? "Cadastre um perfil abaixo" : undefined}
                                aria-label={`Perfil de ${row.nome || row.windowsUser} em ${row.hostName}`}
                                onChange={(e) => void assignProfileFromSettings(row, Number(e.target.value))}
                              >
                                <option value={0}>{configProfiles.length ? "Sem perfil" : "Sem perfis salvos"}</option>
                                {configProfiles.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {settingsSection === "profiles" ? <div className="settings-card">
              <h2 className="text-xl font-bold">Perfis de configuração</h2>
              <p className="mt-1 text-sm text-slate-400">
                Salve a aparência e os filtros atuais para reutilizar depois.{!userAjustes ? " Aplique um perfil aos computadores da lista acima ou aos selecionados na administração." : " Carregue um perfil para preencher os ajustes deste computador."}
              </p>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
                <label className="min-w-0 text-sm text-slate-400">
                  Perfil
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={settingsProfileId}
                    disabled={!!editingProfileId}
                    onChange={(e) => selectSettingsProfile(Number(e.target.value))}
                  >
                    <option value={0}>Novo perfil…</option>
                    {configProfiles.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-sm text-slate-400">
                  Nome
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={profileDraftName}
                    placeholder="Ex.: TV SEFOC"
                    onChange={(e) => setProfileDraftName(e.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950"
                  onClick={() => void saveConfigProfile().catch((ex) => setError(errText(ex)))}
                >
                  Salvar perfil
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
                  disabled={!settingsProfileId || !!editingProfileId}
                  onClick={() => loadConfigProfile()}
                >
                  Carregar no formulário
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-rose-200 disabled:opacity-50"
                  disabled={!settingsProfileId || !!editingProfileId}
                  onClick={() => void deleteConfigProfile().catch((ex) => setError(errText(ex)))}
                >
                  Excluir
                </button>
              </div>
            </div> : null}
            </fieldset>
            <div className="settings-savebar">
              {editingProfileId ? <>
                <div><span className="save-indicator is-dirty"><CircleAlert size={17} /></span><div><strong>Editando perfil: {profileDraftName}</strong><p>Os ajustes deste computador serão preservados.</p></div></div>
                <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm disabled:opacity-50" disabled={saving} onClick={cancelProfileEdit}>Cancelar edição</button><button type="button" className="primary-button" disabled={saving} onClick={() => void saveConfigProfile().catch((ex) => setError(errText(ex)))}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{saving ? "Salvando…" : "Salvar perfil"}</button></div>
              </> : <>
                <div><span className={`save-indicator ${dirty || !savedConfig ? "is-dirty" : ""}`}>{dirty || !savedConfig ? <CircleAlert size={17} /> : <Check size={17} />}</span><div><strong>{!savedConfig ? "Configuração não carregada" : dirty ? "Alterações pendentes" : "Configuração sincronizada"}</strong><p>{!savedConfig ? "Atualize a página para tentar novamente." : dirty ? "Salve para aplicar os ajustes neste computador." : "Personalize seu letreiro em cada categoria acima."}</p></div></div>
                <button type="button" className="primary-button" disabled={saving || !savedConfig} onClick={() => void saveLocal().catch((ex) => setError(errText(ex)))}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{saving ? "Salvando…" : "Salvar alterações"}</button>
              </>}
            </div>
          </section>
        ) : null}
        </>}
      </main>

      {clientEdit ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 sm:p-8"
          role="presentation"
          onClick={() => {
            if (!clientBusy) setClientEdit(null);
          }}
        >
          <div
            role="dialog"
            ref={clientDialogRef}
            aria-modal="true"
            aria-labelledby="client-config-title"
            className="my-auto flex max-h-[min(90vh,100dvh-2rem)] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-4 sm:px-5">
              <div>
                <h2 id="client-config-title" className="text-xl font-bold">Filtros e exibição</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Aplica somente em {clientEdit.row.hostName} ({clientEdit.row.windowsUser}).
                  {clientEdit.row.nome ? ` ${clientEdit.row.nome}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Fechar"
                disabled={clientBusy}
                onClick={() => setClientEdit(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
              {configProfiles.length ? (
                <label className="text-sm text-slate-400">
                  Preencher com perfil
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    defaultValue={0}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      e.currentTarget.value = "0";
                      if (id) fillClientEditFromProfile(id);
                    }}
                  >
                    <option value={0}>Escolher perfil…</option>
                    {configProfiles.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="text-lg font-bold">Letreiro</h3>
                <p className="mt-1 text-sm text-slate-400">Aparência, tamanho da barra e filtro OS/SP.</p>
                <LetreiroDisplayFields
                  cfg={clientEdit.cfg}
                  onChange={(next) => setClientEdit((cur) => (cur ? { ...cur, cfg: next } : cur))}
                  setores={setores}
                  listId="client-setores-list"
                  presets={painelPresets}
                  sounds={sounds}
                  onSoundsChange={setSounds}
                  onError={setError}
                />
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <FilterListFields
                  cfg={clientEdit.cfg}
                  onChange={(next) => setClientEdit((cur) => (cur ? { ...cur, cfg: next } : cur))}
                  onError={setError}
                  setores={setores}
                  situacoes={situacoes}
                  sounds={sounds}
                  listId="client-setores-filtros"
                  onPreviewFilter={(row) => void api.previewNotification(previewNotificationPayload(clientEdit.cfg, {
                    animation: resolveFilterAnimation(row.animation, clientEdit.cfg.window?.notificationAnimation),
                    sound: resolveFilterSound(row.sound, clientEdit.cfg.window?.notificationSound),
                  }))
                    .then(() => setStatus(`Teste do filtro “${row.situacao || row.fonte}” disparado.`))
                    .catch((ex) => setError(errText(ex)))}
                />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-900 px-4 py-4 sm:px-5">
              <button
                type="button"
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm"
                disabled={clientBusy}
                onClick={() => setClientEdit(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                disabled={clientBusy}
                onClick={() => void applyClientConfig()}
              >
                {clientBusy ? "Aplicando…" : "Aplicar configurações"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, password }: { label: string; value: string; onChange: (v: string) => void; password?: boolean }) {
  return (
    <label className="min-w-0 text-sm text-slate-400">
      {label}
      <input type={password ? "password" : "text"} className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
