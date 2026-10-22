import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { elapsedParts, parseAndamentoTime } from "../elapsed";

const ClockContext = createContext(Date.now());

/** Um único relógio para todos os cards; retoma o horário real ao voltar à aba. */
export function AndamentoClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

export function AndamentoTimer({
  since,
  observation,
}: {
  since?: string | null;
  observation?: string | null;
}) {
  const now = useContext(ClockContext);
  const timestamp = parseAndamentoTime(since, observation);
  const elapsed = elapsedParts(timestamp, now);
  const clockDelay = useMemo(
    () => -((Math.max(0, Date.now() - (timestamp ?? Date.now())) / 1000) % 60),
    [timestamp],
  );
  const description = elapsed
    ? `${elapsed.days ? `${elapsed.days} dias, ` : ""}${elapsed.hours} horas, ${elapsed.minutes} minutos e ${elapsed.seconds} segundos desde o último andamento`
    : "Horário do andamento indisponível";

  return (
    <div
      className="setor-modern-timer"
      title={
        timestamp == null
          ? description
          : `Último andamento: ${new Date(timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
      }
    >
      <span className="setor-modern-clock-face" aria-hidden="true">
        {elapsed && (
          <span
            style={{ "--clock-delay": `${clockDelay}s` } as CSSProperties}
          />
        )}
      </span>
      <span className="setor-modern-timer-label">no andamento</span>
      <span
        className="setor-modern-timer-value"
        role="timer"
        aria-live="off"
        aria-label={description}
      >
        {elapsed ? (
          <>
            {elapsed.days > 0 && (
              <span className="setor-modern-timer-days">{elapsed.days}d </span>
            )}
            <span key={`h${elapsed.hours}`} className="setor-modern-digit">
              {elapsed.hours}
            </span>
            <span className="setor-modern-colon">:</span>
            <span key={`m${elapsed.minutes}`} className="setor-modern-digit">
              {elapsed.minutes}
            </span>
            <span className="setor-modern-colon">:</span>
            <span
              key={`s${elapsed.seconds}`}
              className="setor-modern-digit setor-modern-seconds"
            >
              {elapsed.seconds}
            </span>
          </>
        ) : (
          <span className="setor-modern-timer-unavailable">Sem horário</span>
        )}
      </span>
    </div>
  );
}
