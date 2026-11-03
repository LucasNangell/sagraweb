import { Bell, Check, CircleHelp, Monitor, Radio, SlidersHorizontal } from "lucide-react";
import type { AppConfig } from "./api";

export function ConfigPreview({ cfg, notifications, editingProfile = false }: { cfg: AppConfig; notifications: boolean; editingProfile?: boolean }) {
  const win = cfg.window;
  return (
    <aside className="config-preview" aria-label="Resumo da exibição">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow">Prévia ilustrativa</span>
        <Monitor size={16} className="text-slate-500" />
      </div>
      <div className={`preview-screen ${notifications ? "preview-screen--notification" : ""}`}>
        <div className="preview-desktop"><span /><span /><span /></div>
        {notifications ? (
          <div className="preview-notification">
            <span className="preview-notification-icon"><Bell size={16} /></span>
            <div><span className="text-[10px] text-slate-400">NOVA ATUALIZAÇÃO</span><strong>OS 2481</strong><span>Em execução · {cfg.board?.sector || "Seu setor"}</span></div>
          </div>
        ) : (
          <div className="preview-ticker" style={{ opacity: win?.opacity ?? 0.95, background: win?.transparentBg ? "transparent" : undefined }}>
            {cfg.board?.showOs !== false ? <span className="preview-order"><i /> OS 2481 <small>Em execução</small></span> : null}
            {cfg.board?.showSp !== false ? <span className="preview-order"><i /> SP 5032 <small>Recebido</small></span> : null}
          </div>
        )}
        <div className="preview-taskbar"><span /><span /><span /><time>14:30</time></div>
      </div>
      <h3 className="mt-5 text-sm font-semibold">{notifications ? "Notificações do letreiro" : "Sua barra de informações"}</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{notifications ? "Use Testar notificação para conferir o visual e o som reais no computador." : "Os valores abaixo acompanham suas escolhas. A barra exibe as ordens dos filtros configurados."}</p>
      <dl className="preview-summary">
        {(notifications ? [
          ["Dimensões", `${win?.notificationWidth ?? 320} × ${win?.notificationHeight ?? 96} px`],
          ["Fonte da OS", `${win?.notificationTitleFontSize ?? 22} px`],
          ["Distância das bordas", `${win?.notificationOffsetRight ?? 24} px direita · ${win?.notificationOffsetBottom ?? 24} px inferior`],
        ] : [
          ["Setor padrão", cfg.board?.sector || "Não definido"],
          ["Largura", `${win?.width ?? 720} px`],
          ["Velocidade", `${win?.speedPxPerSec ?? 40} px/s`],
          ["Opacidade", `${Math.round((win?.opacity ?? 0.95) * 100)}%`],
        ]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="preview-tip"><CircleHelp size={16} /><p>{editingProfile ? <>As alterações serão gravadas ao clicar em <strong>Salvar perfil</strong>.</> : <>As alterações são aplicadas ao clicar em <strong>Salvar alterações</strong>.</>}</p></div>
    </aside>
  );
}

export function SettingsSummary({ cfg, profiles }: { cfg: AppConfig; profiles: number }) {
  const columns = cfg.board?.columns ?? [];
  const filters = columns.reduce((total, col) => total + Math.max(col.statuses?.length ?? 0, 1), 0);
  return (
    <div className="settings-summary">
      <span><Radio size={15} /> <strong>{cfg.board?.sector || "Setor não definido"}</strong></span>
      <span><SlidersHorizontal size={15} /> {filters} filtro{filters !== 1 ? "s" : ""}</span>
      <span><Bell size={15} /> {columns.filter(col => col.notify).length} {columns.filter(col => col.notify).length === 1 ? "grupo com aviso" : "grupos com aviso"}</span>
      <span><Check size={15} /> {profiles} {profiles === 1 ? "perfil salvo" : "perfis salvos"}</span>
    </div>
  );
}
