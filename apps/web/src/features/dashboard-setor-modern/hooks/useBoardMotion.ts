import { useLayoutEffect, useRef, type RefObject } from "react";

import type { DashboardDisplayColumn } from "@/features/dashboard-setor/types";

interface CardPosition {
  rect: DOMRect;
  element: HTMLElement;
  snapshot: HTMLElement;
  lane: Element | null;
  laneRect: DOMRect;
  scrollTop: number;
}

interface BoardMotionOptions {
  sectorItemKeys: ReadonlySet<string>;
  configKey: string;
  enabled: boolean;
}

function visualCopy(card: HTMLElement): HTMLElement {
  const copy = card.cloneNode(true) as HTMLElement;
  // A cópia sai do contêiner da coluna; mantém a tipografia calculada em cqi/cqw.
  const sources = [card, ...card.querySelectorAll<HTMLElement>("*")];
  const targets = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  sources.forEach((source, index) => {
    targets[index]!.style.fontSize = getComputedStyle(source).fontSize;
  });
  copy.removeAttribute("data-card-key");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  Object.assign(copy.style, {
    margin: "0",
    pointerEvents: "none",
    animation: "none",
    translate: "none",
    scale: "none",
    visibility: "visible",
  });
  return copy;
}

/** FLIP nas movimentações; dissolução apenas para cards que deixam o setor. */
export function useBoardMotion(
  board: RefObject<HTMLElement | null>,
  columns: DashboardDisplayColumn[],
  { sectorItemKeys, configKey, enabled }: BoardMotionOptions,
) {
  const previous = useRef(new Map<string, CardPosition>());
  const previousScrollLeft = useRef(0);
  const previousConfig = useRef(configKey);
  const departures = useRef(new Map<string, () => void>());

  useLayoutEffect(() => {
    const element = board.current;
    // Atualiza a posição final após a entrada animada, rolagem ou redimensionamento.
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const position of previous.current.values()) {
          if (!position.element.isConnected) continue;
          position.rect = position.element.getBoundingClientRect();
          position.snapshot = visualCopy(position.element);
          position.laneRect =
            position.lane?.getBoundingClientRect() ?? position.rect;
          position.scrollTop = position.lane?.scrollTop ?? 0;
        }
        previousScrollLeft.current = element?.scrollLeft ?? 0;
      });
    };
    element?.addEventListener("animationend", refresh, true);
    element?.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      element?.removeEventListener("animationend", refresh, true);
      element?.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      departures.current.forEach((cleanup) => cleanup());
      departures.current.clear();
    };
  }, [board]);

  useLayoutEffect(() => {
    const next = new Map<string, CardPosition>();
    const cleanups: (() => void)[] = [];
    const scrollLeft = board.current?.scrollLeft ?? 0;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const root = board.current?.closest(".setor-modern");
    if (previousConfig.current !== configKey || !enabled || reduced) {
      previous.current.clear();
      departures.current.forEach((cleanup) => cleanup());
      departures.current.clear();
    }
    previousConfig.current = configKey;
    const hasDepartures = [...previous.current.keys()].some(
      (key) => !sectorItemKeys.has(key),
    );
    board.current
      ?.querySelectorAll<HTMLElement>("[data-card-key]")
      .forEach((card) => {
        const key = card.dataset["cardKey"]!;
        const rect = card.getBoundingClientRect();
        const lane = card.closest(".setor-modern-lane-content");
        next.set(key, {
          rect,
          element: card,
          snapshot: visualCopy(card),
          lane,
          laneRect: lane?.getBoundingClientRect() ?? rect,
          scrollTop: lane?.scrollTop ?? 0,
        });
        departures.current.get(key)?.();
        const old = previous.current.get(key);
        if (reduced || !old || typeof card.animate !== "function") return;
        // Rolagem manual não deve ser confundida com reordenação de OPs.
        const x =
          old.rect.left - rect.left - (scrollLeft - previousScrollLeft.current);
        const y =
          old.rect.top -
          rect.top -
          ((old.lane?.scrollTop ?? 0) - old.scrollTop);
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
        // Uma cópia visual atravessa as colunas sem ser cortada pelos contêineres de rolagem.
        let moving = card;
        if (old.lane !== lane && root) {
          moving = visualCopy(card);
          Object.assign(moving.style, {
            position: "fixed",
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: "0",
            zIndex: "20",
            pointerEvents: "none",
            animation: "none",
            translate: "none",
            scale: "none",
          });
          root.appendChild(moving);
          card.style.visibility = "hidden";
        }
        const animation = moving.animate(
          [
            { transform: `translate(${x}px, ${y}px)`, opacity: 0.7 },
            { transform: "translate(0, 0)", opacity: 1 },
          ],
          {
            duration: 680,
            delay: hasDepartures ? 240 : 0,
            fill: "backwards",
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (moving !== card) {
            moving.remove();
            card.style.visibility = "";
          }
        };
        void animation.finished.then(cleanup, cleanup);
        cleanups.push(() => {
          animation.cancel();
          cleanup();
        });
      });

    if (!reduced && enabled && root) {
      for (const [key, old] of previous.current) {
        if (
          next.has(key) ||
          sectorItemKeys.has(key) ||
          typeof old.snapshot.animate !== "function"
        )
          continue;
        // Mantém a última posição visível, mesmo se a remoção reduzir a rolagem da coluna.
        const x = old.rect.left;
        const y = old.rect.top;
        const laneRect = old.lane?.isConnected
          ? old.lane.getBoundingClientRect()
          : old.laneRect;
        const boardRect = board.current!.getBoundingClientRect();
        const left = Math.max(laneRect.left, boardRect.left, 0);
        const top = Math.max(laneRect.top, boardRect.top, 0);
        const right = Math.min(
          laneRect.right,
          boardRect.right,
          window.innerWidth,
        );
        const bottom = Math.min(
          laneRect.bottom,
          boardRect.bottom,
          window.innerHeight,
        );
        // Cards fora da área visível não devem ressurgir sobre cabeçalhos ou rodapés.
        if (
          right <= left ||
          bottom <= top ||
          x >= right ||
          x + old.rect.width <= left ||
          y >= bottom ||
          y + old.rect.height <= top
        )
          continue;

        const layer = document.createElement("div");
        layer.className = "setor-modern-departure-layer";
        layer.setAttribute("aria-hidden", "true");
        layer.inert = true;
        Object.assign(layer.style, {
          position: "fixed",
          left: `${left}px`,
          top: `${top}px`,
          width: `${right - left}px`,
          height: `${bottom - top}px`,
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: "20",
        });
        const fading = old.snapshot;
        fading.classList.add("is-departing");
        Object.assign(fading.style, {
          position: "absolute",
          left: `${x - left}px`,
          top: `${y - top}px`,
          width: `${old.rect.width}px`,
          height: `${old.rect.height}px`,
          willChange: "opacity, filter, transform",
        });
        layer.appendChild(fading);
        root.appendChild(layer);
        const animation = fading.animate(
          [
            {
              opacity: 1,
              filter: "blur(0px)",
              transform: "translateY(0) scale(1)",
            },
            {
              opacity: 0.65,
              filter: "blur(1.5px)",
              transform: "translateY(-1px) scale(0.995)",
              offset: 0.4,
            },
            {
              opacity: 0,
              filter: "blur(8px)",
              transform: "translateY(-5px) scale(0.975)",
            },
          ],
          {
            duration: 760,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "forwards",
          },
        );
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          animation.cancel();
          layer.remove();
          departures.current.delete(key);
        };
        departures.current.set(key, cleanup);
        void animation.finished.then(cleanup, cleanup);
      }
    }
    previous.current = next;
    previousScrollLeft.current = scrollLeft;
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [board, columns, sectorItemKeys, configKey, enabled]);
}
