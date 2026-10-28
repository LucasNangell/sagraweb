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
} from "lucide-react";
import { api, ApiError, type AppConfig, type BoardColumn, type Command, type ConfigProfile, type Instance, type Job } from "./api";
import {
  CLASSIC_ENTRY_ANIMATIONS,
  clampEntryAnimation,
  visualFromPreset,
} from "./notificationStyle";
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

const NAV: { id: View; label: string; icon: typeof Monitor }[] = [
  { id: "computers", label: "Computadores", icon: Monitor },
  { id: "library", label: "Biblioteca", icon: BookMarked },
  { id: "history", label: "Histórico", icon: Clock3 },
  { id: "settings", label: "Ajustes", icon: Settings2 },
];

function keyOf(row: Pick<Instance, "hostName" | "windowsUser">) {
  return `${row.hostName}\n${row.windowsUser}`;
}

function uniqueInstances(rows: Instance[]) {
  const seen = new Set<string>();
  const out: Instance[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
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
      });
    });
  });
  return rows;
}

function columnsFromFilters(filters: DisplayFilter[]): BoardColumn[] {
  return filters.map((item, i) => {
    if (item.fonte === "inbox") {
      return {
        id: `col_${i}`,
        title: "Inbox",
        source: "inbox",
        statuses: [],
        sector: item.setor || undefined,
        notify: !!item.notify,
      };
    }
    const situacao = item.situacao.trim();
    return {
      id: `col_${i}`,
      title: situacao || `Filtro ${i + 1}`,
      statuses: situacao ? [situacao] : [],
      sector: item.setor || undefined,
      notify: !!item.notify,
    };
  });
}

const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "col_0", title: "p/ Triagem", statuses: ["Saída p/", "Saída parcial p/", "Entrada Inicial", "Tramit. de Prova p/", "Tramit. de Prévia p/", "Comentário"] },
  { id: "col_1", title: "p/ Execução", statuses: ["Em Execução", "Recebido"] },
  { id: "col_2", title: "Prob. Téc.", statuses: ["Problemas Técnicos", "Problema Técnico"] },
  { id: "col_3", title: "enviar E-mail", statuses: ["Encam. de Docum."] },
];

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
    notificationVisual: cfg.window?.notificationVisual,
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

function LetreiroDisplayFields({
  cfg,
  onChange,
  setores,
  listId,
  onPreview,
  presets = [],
}: {
  cfg: AppConfig;
  onChange: (next: AppConfig) => void;
  setores: string[];
  listId: string;
  onPreview?: (priority: string) => void;
  presets?: { id: number; nome: string; payload: unknown }[];
}) {
  const [previewPriority, setPreviewPriority] = useState("");
  return (
    <>
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
          OS (nº &lt; 5000)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.board?.showSp !== false} onChange={(e) => onChange({ ...cfg, board: { ...cfg.board, showSp: e.target.checked } })} />
          SP (nº ≥ 5000)
        </label>
      </div>
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
          Distância da inferior do monitor (px)
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
      <label className="mt-3 block min-w-0 text-sm text-slate-400">
        Visual do card (presets de admin/paineis)
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
        O tamanho 180–900 × 56–280 é o do card. Fontes: nº da OS 10–72 px e situação 8–56 px, independentes. A animação de entrada é a escolhida acima, mesmo se o preset tiver outra. Cores vêm da paleta do modelo quando o preset não grava hex.
      </p>
    </>
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
}: {
  cfg: AppConfig;
  onChange: (next: AppConfig) => void;
  onError?: (msg: string) => void;
  setores: string[];
  situacoes: string[];
  listId: string;
  actions?: ReactNode;
}) {
  const filters = filtersFromColumns(cfg.board?.columns ?? []);
  const situacaoOptions = [...new Set([...situacoes, ...filters.map((row) => row.situacao).filter(Boolean)])];

  function patchFilter(index: number, patch: Partial<DisplayFilter>) {
    onChange(withFilters(cfg, filters.map((row, i) => (i === index ? { ...row, ...patch } : row))));
  }

  function addFilter() {
    onChange(withFilters(cfg, [
      ...filters,
      { key: `new-${Date.now()}`, setor: cfg.board?.sector ?? "", situacao: "", fonte: "situacao", notify: false },
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
          <h2 className="text-xl font-bold">Filtros</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Cada linha vira um card na faixa. Marque Notificar para avisar quando uma OS entrar nessa situação.
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
              className="grid min-w-0 gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(7rem,9rem)_auto_auto] lg:items-end"
            >
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
                onClick={() => removeFilter(index)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [view, setView] = useState<View>("computers");
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
  const commandsRef = useRef<Command[]>([]);
  const logEl = useRef<HTMLPreElement | null>(null);
  const [draft, setDraft] = useState<Command>({ id: 0, name: "", kind: "bat", content: "", timeoutSec: 60 });
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState({ nome: "", setor: "" });
  const [localCfg, setLocalCfg] = useState<AppConfig>({});
  const [clientEdit, setClientEdit] = useState<{ row: Instance; cfg: AppConfig } | null>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const clickTimer = useRef(0);
  const [painelPresets, setPainelPresets] = useState<{ id: number; nome: string; payload: unknown }[]>([]);
  const [configProfiles, setConfigProfiles] = useState<ConfigProfile[]>([]);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [settingsProfileId, setSettingsProfileId] = useState(0);
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
  const filteringList = selected.size === 0;
  const visibleInstances = useMemo(() => {
    const sorted = uniqueInstances(instances).sort(compareInstances);
    if (!filteringList) return sorted;
    return sorted.filter((row) =>
      textMatches(row.nome ?? "", profile.nome) && textMatches(row.setor ?? "", profile.setor),
    );
  }, [filteringList, instances, profile.nome, profile.setor]);

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
        const [local, setorList, situacaoList, presetList, profileList] = await Promise.all([
          api.localConfig(),
          api.setores(),
          api.situacoes().catch(() => ({ situacoes: [] as string[] })),
          api.painelPresets().catch(() => ({ presets: [] as { id: number; nome: string; payload: unknown }[] })),
          api.configProfiles().catch(() => ({ profiles: [] as ConfigProfile[] })),
        ]);
        setLocalCfg(withNotifyMigration(local));
        setPainelPresets(presetList.presets ?? []);
        setConfigProfiles(profileList.profiles ?? []);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clientEdit, clientBusy]);

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
    const saved = await api.saveLocalConfig(localCfg);
    setLocalCfg(saved);
    setStatus("Ajustes deste computador gravados.");
  }

  async function restoreGroups() {
    if (!window.confirm("Restaurar a lista padrão de filtros (SEFOC)?")) return;
    const restored = await api.restoreBoard();
    setLocalCfg(restored);
    setStatus("Filtros restaurados.");
  }

  async function refreshConfigProfiles() {
    const list = await api.configProfiles();
    setConfigProfiles(list.profiles ?? []);
  }

  function selectSettingsProfile(id: number) {
    setSettingsProfileId(id);
    const row = configProfiles.find((item) => item.id === id);
    setProfileDraftName(row?.name ?? "");
  }

  async function saveConfigProfile() {
    const name = profileDraftName.trim();
    if (!name) return setError("Informe o nome do perfil.");
    const saved = settingsProfileId
      ? await api.updateConfigProfile(settingsProfileId, name, localCfg)
      : await api.saveConfigProfile(name, localCfg);
    await refreshConfigProfiles();
    setSettingsProfileId(saved.id);
    setProfileDraftName(saved.name);
    setApplyProfileId(saved.id);
    setStatus(`Perfil “${saved.name}” gravado.`);
  }

  function loadConfigProfile() {
    const row = configProfiles.find((item) => item.id === settingsProfileId);
    if (!row) return setError("Selecione um perfil para carregar.");
    setLocalCfg(mergeProfile(localCfg, row.payload ?? {}));
    setProfileDraftName(row.name);
    setStatus(`Perfil “${row.name}” carregado neste formulário. Clique em Salvar para aplicar neste computador.`);
  }

  async function deleteConfigProfile() {
    const row = configProfiles.find((item) => item.id === settingsProfileId);
    if (!row) return setError("Selecione um perfil para excluir.");
    if (!window.confirm(`Excluir o perfil “${row.name}”?`)) return;
    await api.deleteConfigProfile(row.id);
    await refreshConfigProfiles();
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
      }
      setStatus(`Perfil “${row.name}” aplicado em ${selectedRows.length} usuário(s). A posição da faixa permanece em cada PC.`);
    } catch (ex) {
      setError(errText(ex));
    } finally {
      setClientBusy(false);
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

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] lg:overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 lg:hidden">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sky-400">SAGRA</p>
          <h1 className="text-lg font-bold">{userAjustes ? "Ajustes" : "Admin letreiro"}</h1>
        </div>
        <button className="rounded-lg bg-slate-800 p-2" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      <aside
        className={`${menuOpen ? "block" : "hidden"} min-w-0 border-b border-slate-800 bg-slate-950/80 p-4 lg:block lg:min-h-0 lg:overflow-auto lg:border-b-0 lg:border-r`}
      >
        <div className="mb-8 hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">SAGRA Letreiro</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{userAjustes ? "Ajustes" : "Administração"}</h1>
          <p className="mt-2 text-sm text-slate-400">{status}</p>
        </div>
        <nav className="grid gap-2">
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
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${
                  active ? "bg-sky-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button
          onClick={() => {
            if (userAjustes) void api.localConfig().then(setLocalCfg).catch((ex) => setError(errText(ex)));
            else void loadAll();
          }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </aside>

      <main className={`min-w-0 p-3 sm:p-4 lg:p-5 ${fillView ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-auto"}`}>
        {error ? (
          <div className="mb-4 shrink-0 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {view === "computers" ? (
          <section className="grid min-h-0 flex-1 grid-rows-[minmax(14rem,38%)_minmax(0,1fr)] gap-3 sm:gap-4 lg:grid-rows-none lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-card">
              <div className="shrink-0 border-b border-slate-800 px-3 py-3 sm:px-4">
                <h2 className="text-xl font-bold">Computadores</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Clique seleciona um. Ctrl+clique marca vários. Duplo clique edita filtros.
                  {filteringList ? " Sem seleção, Nome e Setor filtram a lista." : ""}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                    <tr>
                      <th className="w-6 px-2 py-3 font-medium" aria-label="Estado" />
                      {["Nome", "Setor", "Computador", "Usuário"].map((h) => (
                        <th key={h} className="px-2 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInstances.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">
                          {instances.length === 0 ? "Nenhum usuário." : "Nenhum usuário corresponde ao filtro."}
                        </td>
                      </tr>
                    ) : null}
                    {visibleInstances.map((row) => {
                      const on = selected.has(keyOf(row));
                      return (
                        <tr
                          key={keyOf(row)}
                          className={`cursor-pointer border-t border-slate-800 ${on ? "bg-sky-400/20" : "hover:bg-slate-800/60"}`}
                          title={row.online ? "Online" : "Offline"}
                          aria-selected={on}
                          onClick={(e) => onRowClick(row, e)}
                          onDoubleClick={() => void openClientConfig(row)}
                        >
                          <td className="px-2 py-3">
                            <span
                              className={`mx-auto block h-2 w-2 rounded-full ${row.online ? "bg-emerald-400" : "bg-rose-500"}`}
                              aria-label={row.online ? "Online" : "Offline"}
                            />
                          </td>
                          <td className="max-w-[8rem] truncate px-2 py-3 font-medium" title={row.nome || undefined}>{row.nome || "—"}</td>
                          <td className="max-w-[7rem] truncate px-2 py-3" title={row.setor || undefined}>{row.setor || "—"}</td>
                          <td className="max-w-[8rem] truncate px-2 py-3" title={row.hostName}>{row.hostName}</td>
                          <td className="max-w-[8rem] truncate px-2 py-3" title={row.windowsUser}>{row.windowsUser}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              <div className="grid shrink-0 gap-2 sm:grid-cols-2">
                <label className="min-w-0 text-sm text-slate-400">
                  Nome
                  <input
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={profile.nome}
                    placeholder={filteringList ? "Filtrar por nome" : undefined}
                    onChange={(e) => setProfile((p) => ({ ...p, nome: e.target.value }))}
                  />
                </label>
                <label className="min-w-0 text-sm text-slate-400">
                  Setor
                  <input
                    className="mt-1 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={profile.setor}
                    placeholder={filteringList ? "Filtrar por setor" : undefined}
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
                  disabled={clientBusy}
                  onClick={() => void applyConfigProfileToSelected().catch((ex) => setError(errText(ex)))}
                >
                  {clientBusy ? "Aplicando…" : "Aplicar aos selecionados"}
                </button>
                <button
                  type="button"
                  className="whitespace-nowrap rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100"
                  onClick={() => void saveProfile()}
                >
                  Salvar nome/setor
                </button>
              </div>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible rounded-2xl border border-slate-800 bg-slate-950 shadow-card">
              <div className="relative z-20 flex shrink-0 flex-col gap-3 border-b border-slate-800 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <TerminalSquare size={16} className="shrink-0 text-sky-400" />
                  <div className="min-w-0">
                    <h2 className="font-semibold">Terminal remoto</h2>
                    <p className="text-xs text-slate-400">{selectedRows.length} selecionado(s)</p>
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
        ) : null}

        {view === "library" ? (
          <section className="grid min-h-0 flex-1 grid-rows-[minmax(11rem,28vh)_minmax(0,1fr)] gap-3 sm:gap-4 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
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
          <section className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,28vh)_minmax(0,1fr)] gap-3 sm:gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
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
                    <div className="break-words font-medium">{job.name}</div>
                    <div className="truncate text-xs text-slate-400">{job.hostName} · {job.status}</div>
                  </button>
                ))}
              </div>
            </div>
            <pre className="min-h-0 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-emerald-300">
              {activeJob ? `${activeJob.stdout || ""}${activeJob.stderr ? `\nSTDERR:\n${activeJob.stderr}` : ""}` : "Sem saída."}
            </pre>
          </section>
        ) : null}

        {view === "settings" ? (
          <section className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 pb-8">
            <div className={`grid min-w-0 gap-4 ${!userAjustes ? "xl:grid-cols-2" : ""}`}>
              {!userAjustes ? (
                <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                  <h2 className="text-xl font-bold">Conexão</h2>
                  <p className="mt-1 text-sm text-slate-400">Conta e API deste computador.</p>
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
              <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                <h2 className="text-xl font-bold">Letreiro</h2>
                <p className="mt-1 text-sm text-slate-400">Aparência, tamanho da barra e filtro OS/SP.</p>
                <LetreiroDisplayFields
                  cfg={localCfg}
                  onChange={patchLocal}
                  setores={setores}
                  listId="setores-list"
                  presets={painelPresets}
                  onPreview={(priority) => void api.previewNotification({
                    width: localCfg.window?.notificationWidth ?? 320,
                    height: localCfg.window?.notificationHeight ?? 96,
                    titleFontSize: localCfg.window?.notificationTitleFontSize ?? 22,
                    situationFontSize: localCfg.window?.notificationSituationFontSize ?? 14,
                    padX: localCfg.window?.notificationPadX ?? 16,
                    textGap: localCfg.window?.notificationTextGap ?? 4,
                    priority,
                    offsetRight: localCfg.window?.notificationOffsetRight ?? 24,
                    offsetBottom: localCfg.window?.notificationOffsetBottom ?? 24,
                    animation: clampEntryAnimation(localCfg.window?.notificationAnimation),
                    visual: localCfg.window?.notificationVisual,
                  }).then(() => setStatus("Notificação de teste disparada.")).catch((ex) => setError(errText(ex)))}
                />
              </div>
            </div>

            <div className={`grid min-w-0 gap-4 ${!userAjustes ? "2xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]" : ""}`}>
              <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                <FilterListFields
                  cfg={localCfg}
                  onChange={patchLocal}
                  onError={setError}
                  setores={setores}
                  situacoes={situacoes}
                  listId="setores-list-filtros"
                  actions={
                    <>
                      <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void restoreGroups()}>Restaurar padrão</button>
                      <button type="button" className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void saveLocal().catch((ex) => setError(errText(ex)))}>Salvar</button>
                    </>
                  }
                />
              </div>

              {!userAjustes ? (
                <div className="min-w-0 space-y-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                    <h2 className="text-lg font-bold">Intervalo de comandos</h2>
                    <p className="mt-1 text-sm text-slate-400">Todos os letreiros consultam jobs neste intervalo.</p>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                      <input type="number" min={1} max={120} className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))} />
                      <button className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void api.saveSettings(pollSec).then(() => setStatus(`Poll = ${pollSec}s`))}>Aplicar</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                    <h2 className="text-lg font-bold">Configuração remota</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Grave um perfil abaixo e aplique-o aos usuários selecionados em Computadores. Duplo clique ainda edita um usuário. A posição da faixa permanece no PC de destino.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
              <h2 className="text-xl font-bold">Perfis de configuração</h2>
              <p className="mt-1 text-sm text-slate-400">
                Salva letreiro e filtros desta página (sem conta ou API). Na administração, o perfil pode ser aplicado aos usuários selecionados.
              </p>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
                <label className="min-w-0 text-sm text-slate-400">
                  Perfil
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={settingsProfileId}
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
                  disabled={!settingsProfileId}
                  onClick={() => loadConfigProfile()}
                >
                  Carregar no formulário
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-rose-200 disabled:opacity-50"
                  disabled={!settingsProfileId}
                  onClick={() => void deleteConfigProfile().catch((ex) => setError(errText(ex)))}
                >
                  Excluir
                </button>
              </div>
            </div>
          </section>
        ) : null}
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
                />
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <FilterListFields
                  cfg={clientEdit.cfg}
                  onChange={(next) => setClientEdit((cur) => (cur ? { ...cur, cfg: next } : cur))}
                  onError={setError}
                  setores={setores}
                  situacoes={situacoes}
                  listId="client-setores-filtros"
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
