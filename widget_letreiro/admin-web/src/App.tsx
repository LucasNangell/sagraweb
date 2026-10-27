import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { api, ApiError, type AppConfig, type BoardColumn, type Command, type Instance, type Job } from "./api";

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
  const lines = [`[${who}]`];
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(stderr);
  const code = job.exitCode == null ? "" : ` exit ${job.exitCode}`;
  lines.push(`${job.status}${code}`);
  return `${lines.join("\n")}\n`;
}

type FilterFonte = "situacao" | "inbox";

type DisplayFilter = {
  key: string;
  setor: string;
  situacao: string;
  fonte: FilterFonte;
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
      };
    }
    const situacao = item.situacao.trim();
    return {
      id: `col_${i}`,
      title: situacao || `Filtro ${i + 1}`,
      statuses: situacao ? [situacao] : [],
      sector: item.setor || undefined,
    };
  });
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
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState("SAGRA Letreiro · terminal remoto\nSelecione computadores e digite um comando.\n");
  const typed = useRef<string[]>([]);
  const typedIndex = useRef(-1);
  const printedJobs = useRef(new Set<number>());
  const jobsPrimed = useRef(false);
  const burstUntil = useRef(0);
  const logEl = useRef<HTMLPreElement | null>(null);
  const [draft, setDraft] = useState<Command>({ id: 0, name: "", kind: "bat", content: "", timeoutSec: 60 });
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState({ nome: "", setor: "" });
  const [cfg, setCfg] = useState<AppConfig>({});
  const [localCfg, setLocalCfg] = useState<AppConfig>({});
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

  const applyJobs = useCallback((next: Job[]) => {
    setJobs(next);
    if (!jobsPrimed.current) {
      for (const job of next) printedJobs.current.add(job.id);
      jobsPrimed.current = true;
      return;
    }
    const chunks: string[] = [];
    for (const job of [...next].sort((a, b) => a.id - b.id)) {
      if (printedJobs.current.has(job.id) || !jobDone(job)) continue;
      printedJobs.current.add(job.id);
      chunks.push(formatJobReply(job));
    }
    if (chunks.length) setLog((prev) => `${prev}${chunks.join("")}`);
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
        const [local, setorList, situacaoList] = await Promise.all([
          api.localConfig(),
          api.setores(),
          api.situacoes().catch(() => ({ situacoes: [] as string[] })),
        ]);
        setLocalCfg(local);
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

  function toggle(row: Instance) {
    const id = keyOf(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setProfile({ nome: row.nome ?? "", setor: row.setor ?? "" });
  }

  async function saveProfile() {
    const row = selectedRows[0];
    if (!row) return setError("Selecione um computador.");
    await api.saveProfile(row.hostName, row.windowsUser, profile.nome, profile.setor);
    setStatus(`Dados de ${row.hostName} gravados.`);
    await loadAll();
  }

  async function loadConfig() {
    const row = selectedRows[0];
    if (!row) return setError("Selecione um computador.");
    const data = await api.getConfig(row.hostName, row.windowsUser);
    setCfg(data.payload ?? {});
    setView("settings");
  }

  async function saveConfig(applyToAll = false) {
    const row = selectedRows[0];
    await api.putConfig(cfg, row?.hostName, row?.windowsUser, applyToAll);
    setStatus(applyToAll ? "Configuração aplicada a todos." : "Configuração gravada.");
  }

  const filters = useMemo(() => filtersFromColumns(localCfg.board?.columns ?? []), [localCfg.board?.columns]);
  const situacaoOptions = useMemo(() => {
    const extra = filters.map((row) => row.situacao).filter(Boolean);
    return [...new Set([...situacoes, ...extra])];
  }, [situacoes, filters]);

  function patchLocal(next: AppConfig) {
    setLocalCfg(next);
  }

  function setFilters(next: DisplayFilter[]) {
    const cols = columnsFromFilters(next);
    patchLocal({ ...localCfg, board: { ...localCfg.board, columns: cols, columnCount: cols.length } });
  }

  function patchFilter(index: number, patch: Partial<DisplayFilter>) {
    setFilters(filters.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addFilter() {
    setFilters([
      ...filters,
      {
        key: `new-${Date.now()}`,
        setor: localCfg.board?.sector ?? "",
        situacao: "",
        fonte: "situacao",
      },
    ]);
  }

  function removeFilter(index: number) {
    if (filters.length <= 1) return setError("É necessário pelo menos um filtro.");
    setFilters(filters.filter((_, i) => i !== index));
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

  async function watchQueued(queued: number, echo: string) {
    setStatus(queued === 1 ? "1 comando enfileirado." : `${queued} comandos enfileirados.`);
    burstUntil.current = Date.now() + 120_000;
    setLog((prev) => `${prev}${echo}aguardando resposta (${queued})…\n`);
    const jobList = await api.jobs();
    applyJobs(jobList.jobs ?? []);
  }

  async function sendTerminal(allOnline: boolean) {
    if (!allOnline && selectedRows.length === 0) return setError("Selecione computadores ou envie a todos os online.");
    const targets = selectedRows.map((row) => ({ hostName: row.hostName, windowsUser: row.windowsUser }));
    const catalog = commands.find((cmd) => cmd.id === libraryId);
    if (catalog) {
      const marker = catalog.kind === "ps1" ? "PS>" : "C:\\>";
      setLog((prev) => `${prev}${marker} ${catalog.name}\n`);
      const queued = await api.runCommand(catalog.id, targets, allOnline);
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
    if (!draft.name.trim() || !draft.content.trim()) return setError("Nome e conteúdo são obrigatórios.");
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

  return (
    <div className="min-h-screen lg:grid lg:h-screen lg:grid-cols-[260px_1fr] lg:overflow-hidden">
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
        className={`${menuOpen ? "block" : "hidden"} border-b border-slate-800 bg-slate-950/80 p-4 lg:block lg:min-h-0 lg:overflow-auto lg:border-b-0 lg:border-r`}
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

      <main className={`p-4 sm:p-6 ${view === "computers" ? "flex min-h-0 flex-col lg:overflow-hidden" : "min-h-0 lg:overflow-auto"}`}>
        {error ? (
          <div className="mb-4 shrink-0 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {view === "computers" ? (
          <section className="grid min-h-[calc(100dvh-8rem)] flex-1 grid-rows-[minmax(12rem,1fr)_minmax(16rem,1fr)] gap-4 lg:min-h-0">
            <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold">Computadores</h2>
                  <p className="text-sm text-slate-400">Selecione um ou vários para o terminal e a configuração remota.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void loadConfig()}>
                    Editar config
                  </button>
                  <button className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void saveProfile()}>
                    Salvar nome/setor
                  </button>
                </div>
              </div>
              <div className="grid shrink-0 gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-400">
                  Nome
                  <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={profile.nome} onChange={(e) => setProfile((p) => ({ ...p, nome: e.target.value }))} />
                </label>
                <label className="text-sm text-slate-400">
                  Setor
                  <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={profile.setor} onChange={(e) => setProfile((p) => ({ ...p, setor: e.target.value }))} />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-800 bg-slate-900/80 shadow-card">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                    <tr>
                      {["", "Computador", "Usuário", "Nome", "Setor", "Estado", "Ponto", "Versão"].map((h) => (
                        <th key={h} className="px-3 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((row) => {
                      const on = selected.has(keyOf(row));
                      return (
                        <tr key={keyOf(row)} className={`border-t border-slate-800 ${on ? "bg-sky-400/10" : ""}`} onClick={() => toggle(row)}>
                          <td className="px-3 py-3"><input type="checkbox" checked={on} readOnly /></td>
                          <td className="px-3 py-3 font-medium">{row.hostName}</td>
                          <td className="px-3 py-3">{row.windowsUser}</td>
                          <td className="px-3 py-3">{row.nome || "—"}</td>
                          <td className="px-3 py-3">{row.setor || "—"}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${row.online ? "bg-emerald-400/20 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
                              {row.online ? "Online" : "Offline"}
                            </span>
                          </td>
                          <td className="px-3 py-3">{row.ponto || "—"}</td>
                          <td className="px-3 py-3">{row.version || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-card">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2">
                  <TerminalSquare size={16} className="text-sky-400" />
                  <div>
                    <h2 className="font-semibold">Terminal remoto</h2>
                    <p className="text-xs text-slate-400">{selectedRows.length} selecionado(s)</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg bg-slate-900 p-1">
                    <button type="button" className={`rounded-md px-3 py-1 text-sm ${shell === "bat" ? "bg-slate-800 text-white" : "text-slate-400"}`} onClick={() => { setShell("bat"); setLibraryId(0); }}>CMD</button>
                    <button type="button" className={`rounded-md px-3 py-1 text-sm ${shell === "ps1" ? "bg-slate-800 text-white" : "text-slate-400"}`} onClick={() => { setShell("ps1"); setLibraryId(0); }}>PowerShell</button>
                  </div>
                  <select
                    aria-label="Comando da biblioteca"
                    className="max-w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100"
                    value={libraryId || ""}
                    onChange={(e) => {
                      const id = Number(e.target.value) || 0;
                      setLibraryId(id);
                      const cmd = commands.find((item) => item.id === id);
                      if (cmd) setShell(cmd.kind === "ps1" ? "ps1" : "bat");
                    }}
                  >
                    <option value="">Biblioteca…</option>
                    {[...commands]
                      .sort((a, b) => a.name.localeCompare(b.name, "pt"))
                      .map((cmd) => (
                        <option key={cmd.id} value={cmd.id}>
                          {cmd.name} ({cmd.kind === "ps1" ? "PS1" : "BAT"})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <pre ref={logEl} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm text-emerald-300">{log}</pre>
              <form
                className="flex shrink-0 flex-col gap-2 border-t border-slate-800 bg-slate-900 p-3 sm:flex-row sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendTerminal(false).catch((ex) => setError(errText(ex)));
                }}
              >
                <span className="font-mono text-emerald-400">{shell === "ps1" ? "PS>" : "C:\\>"}</span>
                <input
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (libraryId) setLibraryId(0);
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
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void sendTerminal(true).catch((ex) => setError(errText(ex)))}>
                    Todos online
                  </button>
                  <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950">
                    <Send size={14} /> Enviar
                  </button>
                </div>
              </form>
            </section>
          </section>
        ) : null}

        {view === "library" ? (
          <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
              <input className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Buscar scripts" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => setDraft({ id: 0, name: "", kind: "bat", content: "", timeoutSec: 60 })}>
                Novo script
              </button>
              <div className="grid gap-2">
                {filteredCommands.map((cmd) => (
                  <button key={cmd.id} onClick={() => setDraft(cmd)} className={`rounded-xl border px-3 py-3 text-left ${draft.id === cmd.id ? "border-sky-400 bg-slate-950" : "border-slate-800 bg-slate-950/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{cmd.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cmd.kind === "ps1" ? "bg-sky-400 text-slate-950" : "bg-amber-400 text-slate-950"}`}>
                        {cmd.kind === "ps1" ? "PS1" : "BAT"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">{cmd.content || "vazio"}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-400">Nome
                  <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                </label>
                <label className="text-sm text-slate-400">Timeout
                  <input type="number" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={draft.timeoutSec} onChange={(e) => setDraft((d) => ({ ...d, timeoutSec: Number(e.target.value) }))} />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button className={`rounded-lg px-3 py-1.5 text-sm ${draft.kind === "bat" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`} onClick={() => setDraft((d) => ({ ...d, kind: "bat" }))}>CMD</button>
                <button className={`rounded-lg px-3 py-1.5 text-sm ${draft.kind === "ps1" ? "bg-sky-400 text-slate-950" : "bg-slate-800"}`} onClick={() => setDraft((d) => ({ ...d, kind: "ps1" }))}>PowerShell</button>
              </div>
              <textarea className="mt-3 min-h-64 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm" value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
              <div className="mt-3 flex flex-wrap gap-2">
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
                    setLibraryId(draft.id);
                    setPrompt("");
                  } else {
                    setLibraryId(0);
                    setPrompt(draft.content);
                  }
                  setView("computers");
                }}>Usar no terminal</button>
                {draft.id > 0 ? (
                  <button className="rounded-lg bg-rose-900 px-3 py-2 text-sm" onClick={() => void api.deleteCommand(draft.id).then(loadAll)}>Excluir</button>
                ) : null}
                {draft.id > 0 ? (
                  <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void api.runCommand(draft.id, selectedRows.map((r) => ({ hostName: r.hostName, windowsUser: r.windowsUser })), false).then(async (r) => {
                    setStatus(`${r.queued} job(s)`);
                    burstUntil.current = Date.now() + 120_000;
                    setLog((prev) => `${prev}${shell === "ps1" || draft.kind === "ps1" ? "PS>" : "C:\\>"} ${draft.content.trim()}\naguardando resposta (${r.queued})…\n`);
                    setView("computers");
                    const list = await api.jobs();
                    applyJobs(list.jobs ?? []);
                  })}>Enviar selecionados</button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {view === "history" ? (
          <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
              {jobs.map((job) => (
                <button key={job.id} onClick={() => setJobId(job.id)} className={`mb-2 w-full rounded-xl px-3 py-2 text-left ${activeJob?.id === job.id ? "bg-slate-800" : ""}`}>
                  <div className="font-medium">{job.name}</div>
                  <div className="text-xs text-slate-400">{job.hostName} · {job.status}</div>
                </button>
              ))}
            </div>
            <pre className="min-h-80 overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-emerald-300">
              {activeJob ? `${activeJob.stdout || ""}${activeJob.stderr ? `\nSTDERR:\n${activeJob.stderr}` : ""}` : "Sem saída."}
            </pre>
          </section>
        ) : null}

        {view === "settings" ? (
          <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
            <div className={`grid gap-4 ${!userAjustes ? "lg:grid-cols-2" : ""}`}>
              {!userAjustes ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                  <h2 className="text-xl font-bold">Conexão</h2>
                  <p className="mt-1 text-sm text-slate-400">Conta e API deste computador.</p>
                  <div className="mt-4 grid gap-3">
                    <Field label="API" value={localCfg.apiBaseUrl ?? ""} onChange={(v) => patchLocal({ ...localCfg, apiBaseUrl: v })} />
                    <div className="grid gap-3 md:grid-cols-2">
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
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                <h2 className="text-xl font-bold">Letreiro</h2>
                <p className="mt-1 text-sm text-slate-400">Aparência, tamanho da barra e filtro OS/SP.</p>
                <label className="mt-4 block text-sm text-slate-400">
                  Setor padrão
                  <input list="setores-list" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={localCfg.board?.sector ?? ""} onChange={(e) => patchLocal({ ...localCfg, board: { ...localCfg.board, sector: e.target.value } })} />
                  <datalist id="setores-list">{setores.map((s) => <option key={s} value={s} />)}</datalist>
                </label>
                <label className="mt-4 block text-sm text-slate-400">
                  Largura da barra (px)
                  <input
                    type="number"
                    min={320}
                    max={4000}
                    step={1}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={localCfg.window?.width ?? 720}
                    onChange={(e) => {
                      const width = Number(e.target.value);
                      if (!Number.isFinite(width)) return;
                      patchLocal({ ...localCfg, window: { ...localCfg.window, width } });
                    }}
                  />
                  <span className="mt-1 block text-xs text-slate-500">Entre 320 e 4000. Arrastar a faixa só move a posição.</span>
                </label>
                <label className="mt-4 block text-sm text-slate-400">
                  Velocidade do deslize ({Math.round(localCfg.window?.speedPxPerSec ?? 40)} px/s)
                  <input type="range" min={8} max={160} className="mt-2 w-full" value={localCfg.window?.speedPxPerSec ?? 40} onChange={(e) => patchLocal({ ...localCfg, window: { ...localCfg.window, speedPxPerSec: Number(e.target.value) } })} />
                </label>
                <label className="mt-3 block text-sm text-slate-400">
                  Opacidade ({Math.round((localCfg.window?.opacity ?? 0.95) * 100)}%)
                  <input type="range" min={0.4} max={1} step={0.01} className="mt-2 w-full" value={localCfg.window?.opacity ?? 0.95} onChange={(e) => patchLocal({ ...localCfg, window: { ...localCfg.window, opacity: Number(e.target.value) } })} />
                </label>
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!localCfg.window?.transparentBg} onChange={(e) => patchLocal({ ...localCfg, window: { ...localCfg.window, transparentBg: e.target.checked } })} /> Fundo transparente</label>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={localCfg.board?.showOs !== false} onChange={(e) => patchLocal({ ...localCfg, board: { ...localCfg.board, showOs: e.target.checked } })} /> OS (nº &lt; 5000)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={localCfg.board?.showSp !== false} onChange={(e) => patchLocal({ ...localCfg, board: { ...localCfg.board, showSp: e.target.checked } })} /> SP (nº ≥ 5000)</label>
                </div>
              </div>
            </div>

            <div className={`grid gap-4 ${!userAjustes ? "xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]" : ""}`}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">Filtros</h2>
                    <p className="mt-1 max-w-xl text-sm text-slate-400">
                      Cada linha vira um card na faixa. Escolha setor, situação e a fonte dos dados.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={addFilter}>
                      <Plus size={16} /> Adicionar
                    </button>
                    <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void restoreGroups()}>Restaurar padrão</button>
                    <button type="button" className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void saveLocal().catch((ex) => setError(errText(ex)))}>Salvar</button>
                  </div>
                </div>

                {filters.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                    Nenhum filtro. Adicione um para exibir cards no letreiro.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] border-separate border-spacing-y-2 text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-2 pb-1 font-medium">Setor</th>
                          <th className="px-2 pb-1 font-medium">Situação</th>
                          <th className="px-2 pb-1 font-medium">Fonte</th>
                          <th className="w-14 px-2 pb-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {filters.map((row, index) => (
                          <tr key={row.key} className="align-middle">
                            <td className="rounded-l-xl border border-r-0 border-slate-800 bg-slate-950 px-2 py-2">
                              <input
                                list="setores-list"
                                aria-label="Setor"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                value={row.setor}
                                placeholder={localCfg.board?.sector || "Setor"}
                                onChange={(e) => patchFilter(index, { setor: e.target.value })}
                              />
                            </td>
                            <td className="border-y border-slate-800 bg-slate-950 px-2 py-2">
                              <select
                                aria-label="Situação"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:text-slate-500"
                                value={row.fonte === "inbox" ? "" : row.situacao}
                                disabled={row.fonte === "inbox"}
                                onChange={(e) => patchFilter(index, { situacao: e.target.value })}
                              >
                                <option value="">{row.fonte === "inbox" ? "—" : "Selecione…"}</option>
                                {situacaoOptions.map((item) => (
                                  <option key={item} value={item}>{item}</option>
                                ))}
                              </select>
                            </td>
                            <td className="border-y border-slate-800 bg-slate-950 px-2 py-2">
                              <select
                                aria-label="Fonte"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                value={row.fonte}
                                onChange={(e) => {
                                  const fonte = e.target.value as FilterFonte;
                                  patchFilter(index, { fonte, situacao: fonte === "inbox" ? "" : row.situacao });
                                }}
                              >
                                <option value="situacao">Situação</option>
                                <option value="inbox">Inbox</option>
                              </select>
                            </td>
                            <td className="rounded-r-xl border border-l-0 border-slate-800 bg-slate-950 px-2 py-2 text-right">
                              <button
                                type="button"
                                className="inline-flex rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                                title="Remover filtro"
                                onClick={() => removeFilter(index)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {!userAjustes ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                    <h2 className="text-lg font-bold">Intervalo de comandos</h2>
                    <p className="mt-1 text-sm text-slate-400">Todos os letreiros consultam jobs neste intervalo.</p>
                    <div className="mt-3 flex gap-2">
                      <input type="number" min={1} max={120} className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))} />
                      <button className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void api.saveSettings(pollSec).then(() => setStatus(`Poll = ${pollSec}s`))}>Aplicar</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                    <h2 className="text-lg font-bold">Configuração remota</h2>
                    <p className="mt-1 text-sm text-slate-400">Do computador selecionado em Computadores. Posição da janela permanece no PC.</p>
                    <div className="mt-3 grid gap-3">
                      <Field label="API" value={cfg.apiBaseUrl ?? ""} onChange={(v) => setCfg((c) => ({ ...c, apiBaseUrl: v }))} />
                      <Field label="Ponto" value={cfg.ponto ?? ""} onChange={(v) => setCfg((c) => ({ ...c, ponto: v }))} />
                      <Field label="Nome" value={cfg.nome ?? ""} onChange={(v) => setCfg((c) => ({ ...c, nome: v }))} />
                      <Field label="Setor" value={cfg.board?.sector ?? ""} onChange={(v) => setCfg((c) => ({ ...c, board: { ...c.board, sector: v } }))} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void loadConfig()}>Carregar selecionado</button>
                      <button className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void saveConfig(false)}>Salvar no selecionado</button>
                      <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => void saveConfig(true)}>Aplicar a todos</button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, password }: { label: string; value: string; onChange: (v: string) => void; password?: boolean }) {
  return (
    <label className="text-sm text-slate-400">
      {label}
      <input type={password ? "password" : "text"} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
