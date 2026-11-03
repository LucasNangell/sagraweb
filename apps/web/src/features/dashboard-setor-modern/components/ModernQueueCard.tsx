import { Layers2, UserRound } from "lucide-react";
import type { CSSProperties } from "react";

import type {
  DashboardCardStyle,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";

import {
  cardSlotStyleVars,
  entryColorVars,
  resolveCardSlot,
  resolveCardTextColors,
} from "../cardStyle";
import { isHtmlCardModel } from "../htmlCardModels";
import { AndamentoTimer } from "./AndamentoTimer";
import { LabVidroFoscoCard } from "./LabVidroFoscoCard";

export function ModernQueueCard({
  item,
  index,
  showTime = true,
  cardStyle,
  entryNonce,
}: {
  item: DashboardOsItem;
  index: number;
  showTime?: boolean;
  cardStyle?: DashboardCardStyle;
  entryNonce?: number;
}) {
  const registeredBy = item.andamento_usuario?.trim();
  const priority =
    item.priorityType === "priority-high"
      ? "Prometido"
      : item.priorityType === "priority-medium"
        ? "Solicitado"
        : null;
  const slot = resolveCardSlot(cardStyle, item.priorityType);
  const modelId = slot?.effect ?? "";
  const textColors = resolveCardTextColors(cardStyle, item.priorityType);
  const displayLabel = formatQueueDisplayLabel(item);
  const htmlModel = isHtmlCardModel(modelId);
  const entryId =
    !htmlModel &&
    cardStyle?.entryAnimation &&
    cardStyle.entryAnimation !== "none"
      ? cardStyle.entryAnimation
      : undefined;
  const entrySpeed = cardStyle?.entrySpeed ?? 1;
  return (
    <div
      className="setor-modern-card-motion"
      data-entry={entryId}
      data-entry-nonce={entryNonce ?? 0}
      style={
        {
          "--sm-entry-speed": entrySpeed,
          ...entryColorVars(cardStyle?.entryColors),
        } as CSSProperties
      }
    >
      <article
        className={`setor-modern-card ${item.isNew ? "is-new" : ""} ${item.priorityType ?? ""}`}
        data-card-key={item.uniqueKey}
        data-model={modelId || undefined}
        data-highlight={slot?.highlight || undefined}
        data-title-color={textColors.titleColor ? "1" : undefined}
        data-situation-color={textColors.situationColor ? "1" : undefined}
        data-author-color={textColors.authorColor ? "1" : undefined}
        data-timer-color={textColors.timerColor ? "1" : undefined}
        style={
          {
            "--card-index": Math.min(index, 7),
            ...(textColors.titleColor
              ? { "--sm-title-color": textColors.titleColor }
              : {}),
            ...(textColors.situationColor
              ? { "--sm-situation-color": textColors.situationColor }
              : {}),
            ...(textColors.authorColor
              ? { "--sm-author-color": textColors.authorColor }
              : {}),
            ...(textColors.timerColor
              ? { "--sm-timer-color": textColors.timerColor }
              : {}),
            ...cardSlotStyleVars(slot),
          } as CSSProperties
        }
        aria-label={`${displayLabel} · ${item.displaySituacao}${priority ? ` · ${priority}` : ""}`}
      >
        {htmlModel ? (
          <LabVidroFoscoCard
            osLabel={displayLabel}
            situacao={item.displaySituacao}
            isSubOs={item.row_kind === "sub_os"}
            author={registeredBy}
            showTime={showTime}
            since={item.last_update}
            observation={item.observacao}
          />
        ) : (
          <>
            <div className="setor-modern-card-top">
              <h3 data-text={displayLabel}>{displayLabel}</h3>
            </div>
            <div className="setor-modern-situation" title={item.displaySituacao}>
              {item.row_kind === "sub_os" && (
                <Layers2 size={13} aria-label="Sub OS" />
              )}
              <span>{item.displaySituacao || "Sem situação informada"}</span>
            </div>
            {(registeredBy || showTime) && (
              <div className="setor-modern-card-meta">
                {registeredBy && (
                  <p
                    className="setor-modern-card-author"
                    title={`Andamento registrado por ${registeredBy}`}
                  >
                    <UserRound aria-hidden="true" />
                    <span>{registeredBy}</span>
                  </p>
                )}
                {showTime && (
                  <AndamentoTimer
                    since={item.last_update}
                    observation={item.observacao}
                  />
                )}
              </div>
            )}
          </>
        )}
      </article>
    </div>
  );
}
