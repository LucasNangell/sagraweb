import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Expand, Library, LoaderCircle, Maximize2, Minimize2, Monitor, Plus, RefreshCw, Square, SquareArrowOutUpRight, X } from "lucide-react";
import { api, type Command, type Instance, type Job } from "./api";
import { extractCommandVars } from "./commandVars";
import { DESKTOP_JOB_PREFIX, QUICK_BUTTONS_KEY, desktopTargetGuard, desktopTargetKey, matchesDesktopJob, parseDesktopResult, parseQuickButtons, windowActionScript, type DesktopWindow, type ScreenshotResult, type WindowAction, type WindowResult } from "./desktop";
import windowsTemplate from "./desktopScripts/windows.ps1?raw";
import screenshotScript from "./desktopScripts/screenshot.ps1?raw";

type Pending = { name: string; kind: "windows" | "screenshot" | "action"; started: number };
type Props = { target: Instance | null; selectionCount: number; commands: Command[]; jobs: Job[]; onQueued: () => void; onJobs: (jobs: Job[]) => void; onOpenLibrary: () => void };

const ACTIONS: { id: WindowAction; label: string; icon: typeof Monitor }[] = [
  { id: "maximize", label: "Maximizar", icon: Maximize2 },
  { id: "minimize", label: "Minimizar", icon: Minimize2 },
  { id: "fullscreen", label: "Tela cheia", icon: Expand },
  { id: "foreground", label: "Trazer ao topo", icon: SquareArrowOutUpRight },
  { id: "close", label: "Fechar", icon: X },
];

function loadButtons() {
  try { return parseQuickButtons(localStorage.getItem(QUICK_BUTTONS_KEY)); } catch { return []; }
}

function timeLabel(value: string) { return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

export default function ClientControlPanel({ target, selectionCount, commands, jobs, onQueued, onJobs, onOpenLibrary }: Props) {
  const [pins, setPins] = useState(loadButtons);
  const [adding, setAdding] = useState(false);
  const [chosenId, setChosenId] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [windows, setWindows] = useState<WindowResult | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [runningShortcut, setRunningShortcut] = useState(false);
  const [variableCommand, setVariableCommand] = useState<Command | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const imageDialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const initiallyRequested = useRef(false);
  const enabled = !!target?.online && !pending && !runningShortcut;
  const availableCommands = [...commands].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const targetKey = target ? desktopTargetKey(target) : "";

  const queueDesktop = useCallback(async (kind: Pending["kind"], row?: DesktopWindow, action?: WindowAction) => {
    if (!target?.online || pendingRef.current) return;
    const request: Pending = { name: `${DESKTOP_JOB_PREFIX}${kind}/${crypto.randomUUID()}`, kind, started: Date.now() };
    pendingRef.current = request;
    setPending(request);
    setError("");
    try {
      const content = kind === "screenshot" ? screenshotScript : kind === "action" && row && action ? windowActionScript(windowsTemplate, row, action)
        : `${windowsTemplate}\n$rows = @([SagraDesktop]::List())\n@{ type = 'windows'; windows = $rows; truncated = ($rows.Count -ge 100); capturedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 4 -Compress`;
      const result = await api.runAdhoc("ps1", desktopTargetGuard(target) + content, request.name, [{ hostName: target.hostName, windowsUser: target.windowsUser }], false, 30);
      if (!alive.current || pendingRef.current !== request) return;
      if (result.queued !== 1) throw new Error("Não foi possível enviar o comando a esta estação.");
      onQueued();
      const next = await api.jobs().catch(() => null);
      if (next && alive.current && pendingRef.current === request) onJobs(next.jobs ?? []);
    } catch (ex) {
      if (!alive.current || pendingRef.current !== request) return;
      pendingRef.current = null;
      setPending(null);
      setError(ex instanceof Error ? ex.message : "Falha ao enviar a ação.");
    }
  }, [target, onQueued, onJobs]);

  useEffect(() => {
    alive.current = true;
    if (target?.online && !initiallyRequested.current) {
      initiallyRequested.current = true;
      void queueDesktop("windows");
    }
    return () => { alive.current = false; };
  }, [targetKey, target?.online, queueDesktop]);

  useEffect(() => {
    const current = pendingRef.current;
    if (!current || !target) return;
    const job = jobs.find(item => matchesDesktopJob(item, current.name, target));
    if (!job || !["ok", "fail", "timeout"].includes(job.status)) return;
    pendingRef.current = null;
    setPending(null);
    try {
      if (job.status !== "ok") throw new Error(job.status === "timeout" ? "O client não concluiu a ação no prazo. Atualize a lista e tente novamente." : job.stderr.trim().slice(0, 600) || "O Windows não conseguiu executar a ação.");
      const result = parseDesktopResult(job.stdout);
      if (result.type !== current.kind) throw new Error("O client retornou um resultado diferente do solicitado.");
      if (result.type === "windows") setWindows(result);
      if (result.type === "screenshot") { setScreenshot(result); setMessage("Captura recebida."); }
      if (result.type === "action") { setMessage(result.message); void queueDesktop("windows"); }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Resposta inválida do client.");
    }
  }, [jobs, target, queueDesktop]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      setPending(null);
      setError("A estação ainda não respondeu. Verifique a conexão e tente atualizar a lista.");
    }, Math.max(0, 90000 - (Date.now() - pending.started)));
    return () => window.clearTimeout(timer);
  }, [pending]);

  function savePins(next: number[]) {
    setPins(next);
    try { localStorage.setItem(QUICK_BUTTONS_KEY, JSON.stringify(next)); }
    catch { setError("O navegador não permitiu salvar os atalhos. Eles ficarão disponíveis apenas nesta sessão."); }
  }

  async function runShortcut(command: Command, values: Record<string, string> = {}) {
    if (!target?.online || !enabled) return;
    if (!commands.some(item => item.id === command.id)) return setError("Este comando foi removido da biblioteca.");
    setRunningShortcut(true);
    setError("");
    try {
      const result = await api.runCommand(command.id, [{ hostName: target.hostName, windowsUser: target.windowsUser }], false, values);
      if (!alive.current) return;
      if (result.queued !== 1) throw new Error("Não foi possível enviar o atalho a esta estação.");
      setVariableCommand(null);
      setMessage(`“${command.name}” enviado para ${target.hostName}. Acompanhe o retorno no terminal.`);
      onQueued();
      const next = await api.jobs().catch(() => null);
      if (next && alive.current) onJobs(next.jobs ?? []);
    } catch (ex) {
      if (alive.current) setError(ex instanceof Error ? ex.message : "Falha ao executar o atalho.");
    } finally { if (alive.current) setRunningShortcut(false); }
  }

  return (
    <section className="client-control-panel" aria-label="Ações da estação selecionada">
      <header className="client-panel-header"><div className="flex items-center gap-2"><Monitor size={17} className="text-sky-300" /><h2>Ações do client</h2></div>
        <p>{target ? <><strong>{target.hostName}</strong><span>{target.nome || target.windowsUser} · {target.setor || "Sem setor"}</span></> : selectionCount > 1 ? "Selecione apenas uma estação para usar este painel." : "Selecione uma estação na lista ao lado."}</p>
        {target && !target.online ? <span className="client-offline">Estação offline · ações indisponíveis</span> : null}
      </header>
      <div className="client-panel-body">
        <div className="client-section-title"><h3>Ações rápidas</h3><button type="button" className="icon-button" aria-label="Adicionar atalho da biblioteca" aria-expanded={adding} onClick={() => setAdding(value => !value)}><Plus size={16} /></button></div>
        <button type="button" className="client-screenshot-button" disabled={!enabled} onClick={() => void queueDesktop("screenshot")}>{pending?.kind === "screenshot" ? <LoaderCircle size={18} className="animate-spin" /> : <Camera size={18} />}<span><strong>Print de tela</strong><small>Capturar a área de trabalho agora</small></span></button>
        <div className="client-shortcuts">
          {pins.map(id => {
            const command = commands.find(item => item.id === id);
            return <div key={id}><button type="button" disabled={!enabled || !command} title={command?.name} onClick={() => {
              if (!command) return;
              if (extractCommandVars(command.content).length) { setVariables({}); setVariableCommand(command); }
              else void runShortcut(command);
            }}><Library size={14} /><span>{command?.name || `Comando removido (#${id})`}</span></button><button type="button" className="icon-button" aria-label={`Remover atalho ${command?.name || id}`} onClick={() => savePins(pins.filter(item => item !== id))}><X size={13} /></button></div>;
          })}
        </div>
        {!pins.length && !adding ? <button type="button" className="add-shortcut-button" onClick={() => setAdding(true)}><Plus size={14} />Adicionar botão da biblioteca</button> : null}
        {adding ? <form className="shortcut-form" onSubmit={e => { e.preventDefault(); if (!chosenId || pins.includes(chosenId) || pins.length >= 20) return; savePins([...pins, chosenId]); setChosenId(0); setAdding(false); }}>
          <label>Comando da biblioteca<select value={chosenId} onChange={e => setChosenId(Number(e.target.value))}><option value={0}>Selecione um comando…</option>{availableCommands.filter(item => !pins.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {pins.length >= 20 ? <p>Limite de 20 atalhos. Remova um para adicionar outro.</p> : null}
          <div className="flex flex-wrap gap-2"><button type="submit" className="primary-button" disabled={!chosenId || pins.length >= 20}>Criar botão</button><button type="button" className="text-xs text-slate-400" onClick={onOpenLibrary}>Abrir biblioteca</button></div>
        </form> : null}
        {variableCommand ? <form className="shortcut-form" onSubmit={e => { e.preventDefault(); void runShortcut(variableCommand, variables); }}><h4>{variableCommand.name}</h4>
          {extractCommandVars(variableCommand.content).map(name => <label key={name}>{name}<input required value={variables[name] ?? ""} onChange={e => setVariables(prev => ({ ...prev, [name]: e.target.value }))} /></label>)}
          <div className="flex gap-3"><button type="submit" className="primary-button" disabled={!enabled}>{runningShortcut ? "Enviando…" : "Executar atalho"}</button><button type="button" className="text-xs text-slate-400" onClick={() => setVariableCommand(null)}>Cancelar</button></div>
        </form> : null}
        {screenshot ? <div className="client-capture"><button type="button" aria-label="Ampliar captura de tela" onClick={() => imageDialog.current?.showModal()}><img src={`data:${screenshot.mime};base64,${screenshot.image}`} alt={`Captura de ${target?.hostName} às ${timeLabel(screenshot.capturedAt)}`} /><span><Expand size={13} />Ampliar captura</span></button><p>Capturada às {timeLabel(screenshot.capturedAt)} · {screenshot.width} × {screenshot.height}</p></div> : null}
        {error ? <div role="alert" className="client-panel-error">{error}</div> : null}
        <p role="status" aria-live="polite" className="client-panel-status">{pending ? <><LoaderCircle size={13} className="animate-spin" />{pending.kind === "windows" ? "Consultando janelas da estação…" : pending.kind === "screenshot" ? "Aguardando captura do client…" : "Enviando ação à janela…"}</> : message}</p>
        <div className="client-section-title client-windows-title"><div><h3>Janelas abertas <span className="count-badge">{windows?.windows.length ?? "—"}</span></h3>{windows ? <p>Consultadas às {timeLabel(windows.capturedAt)}</p> : null}</div><button type="button" className="icon-button" disabled={!enabled} aria-label="Atualizar janelas da estação" onClick={() => void queueDesktop("windows")}><RefreshCw size={15} /></button></div>
        {!target ? <div className="client-windows-empty"><Monitor size={24} /><p>As janelas aparecerão ao selecionar uma única estação.</p></div> : windows && !windows.windows.length ? <div className="client-windows-empty"><Square size={24} /><p>Nenhuma janela visível nesta sessão.</p></div> : !windows && !pending ? <div className="client-windows-empty"><p>{target.online ? "Atualize a lista para consultar as janelas." : "Aguardando a conexão da estação."}</p></div> : null}
        <div className="client-window-list">{windows?.windows.map(row => <article className="client-window" key={`${row.handle}:${row.processStart}`}><div className="client-window-row"><Monitor size={15} /><div className="client-window-info"><strong title={row.title}>{row.title}</strong><p>{row.processName} · {row.fullscreen ? "Tela cheia" : row.state === "minimized" ? "Minimizada" : row.state === "maximized" ? "Maximizada" : "Normal"}</p></div><div className="client-window-actions">{ACTIONS.map(({ id, label, icon: Icon }) => <button type="button" key={id} disabled={!enabled} aria-label={`${id === "fullscreen" && row.fullscreen ? "Sair da tela cheia" : label}: ${row.title}`} title={id === "fullscreen" && row.fullscreen ? "Sair da tela cheia" : label} className={id === "close" ? "is-danger" : row.fullscreen && id === "fullscreen" ? "is-active" : ""} onClick={() => void queueDesktop("action", row, id)}><Icon size={14} /></button>)}</div></div></article>)}</div>
        {windows?.truncated ? <p className="client-panel-status">Exibindo as primeiras 100 janelas desta sessão.</p> : null}
      </div>
      <dialog ref={imageDialog} className="capture-dialog"><header><div><h2>Captura de {target?.hostName}</h2><p>{screenshot ? `${timeLabel(screenshot.capturedAt)} · área original ${screenshot.originalWidth} × ${screenshot.originalHeight}` : ""}</p></div><button type="button" className="icon-button" aria-label="Fechar captura ampliada" onClick={() => imageDialog.current?.close()}><X size={20} /></button></header>{screenshot ? <img src={`data:${screenshot.mime};base64,${screenshot.image}`} alt={`Área de trabalho de ${target?.hostName}`} /> : null}<p>A captura representa o instante informado. Use Print de tela para atualizar.</p></dialog>
    </section>
  );
}
