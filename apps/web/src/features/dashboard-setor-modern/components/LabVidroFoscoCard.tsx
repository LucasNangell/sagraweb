import { Layers2, UserRound } from "lucide-react";

import { AndamentoTimer } from "./AndamentoTimer";

export function LabVidroFoscoCard({
  osLabel,
  situacao,
  isSubOs = false,
  author,
  showTime = false,
  since,
  observation,
  compact = false,
}: {
  osLabel: string;
  situacao?: string;
  isSubOs?: boolean;
  author?: string;
  showTime?: boolean;
  since?: string | null;
  observation?: string | null;
  compact?: boolean;
}) {
  const showFooter = !compact && Boolean(author || showTime);
  return (
    <div className="mx-shell">
      <div className="mx-glow" />
      <div className="mx-entry" data-cm-motion="entry">
        <div className="mx-emphasis" data-emphasis="pulse-outline" data-cm-motion="pulse">
          <div className="mx-card mx-mat-1">
            <div className="mx-orb" />
            <div className="mx-fx" />
            <div className="mx-content">
              <div className="mx-top setor-modern-card-top">
                <h3 className="mx-id" data-slot="os" data-text={osLabel}>
                  {osLabel}
                </h3>
              </div>
              {!compact ? (
                <div
                  className="mx-task setor-modern-situation"
                  data-slot="situacao"
                  title={situacao}
                >
                  {isSubOs ? <Layers2 size={13} aria-label="Sub OS" /> : null}
                  <span>{situacao || "Sem situação informada"}</span>
                </div>
              ) : null}
              {showFooter ? (
                <div className="mx-footer setor-modern-card-meta">
                  {author ? (
                    <p
                      className="mx-author setor-modern-card-author"
                      data-slot="usuario"
                      title={`Andamento registrado por ${author}`}
                    >
                      <UserRound aria-hidden="true" />
                      <span>{author}</span>
                    </p>
                  ) : null}
                  {showTime ? (
                    <div className="mx-timer" data-slot="timer">
                      <AndamentoTimer since={since} observation={observation} />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!compact ? (
                <div className="mx-meter">
                  <div className="mx-fill" data-cm-motion="fill" />
                </div>
              ) : null}
            </div>
          </div>
          <div className="mx-emphasis-fx">
            <span className="mx-emphasis-beam" />
          </div>
        </div>
      </div>
      <div className="mx-ring" />
      {!compact ? (
        <div className="mx-addons">
          <div
            className="mx-addon ax-stamp ax-pos-top-left"
            data-addon-id="urgent"
            data-cm-motion="stamp"
            role="img"
            aria-label="Carimbo URGENTE: PRIORIDADE"
          >
            <div className="ax-art">
              <span className="ax-stamp-label">PRIORIDADE</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
