import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DashboardDisplayColumn,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";

import { useBoardMotion } from "./useBoardMotion";

const op: DashboardOsItem = {
  nr_os: 100,
  ano: 2026,
  uniqueKey: "100-2026",
  pcp_ordem: null,
  displaySituacao: "Entrada",
  priorityType: null,
  isNew: false,
};
const columns = (
  items: DashboardOsItem[],
  second: DashboardOsItem[] = [],
): DashboardDisplayColumn[] => [
  { id: "a", title: "Entrada", statuses: [], items },
  { id: "b", title: "Execução", statuses: [], items: second },
];

function Board({
  rows,
  keys = [],
  configKey = "default",
}: {
  rows: DashboardDisplayColumn[];
  keys?: string[];
  configKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBoardMotion(ref, rows, {
    sectorItemKeys: new Set(keys),
    configKey,
    enabled: true,
  });
  return (
    <div className="setor-modern">
      <div ref={ref} className="setor-modern-board">
        {rows.map((column) => (
          <section key={column.id} className="setor-modern-lane-content">
            {column.items.map((item) => (
              <article
                className="setor-modern-card"
                key={item.uniqueKey}
                data-card-key={item.uniqueKey}
              >
                <h3>OS {item.nr_os}</h3>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

const motions: {
  target: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  finish: () => void;
}[] = [];
let reduced = false;

beforeEach(() => {
  reduced = false;
  motions.length = 0;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const isCard = this.hasAttribute("data-card-key");
      const second = this.closest("section")?.previousElementSibling != null;
      return new DOMRect(
        second ? 520 : 20,
        isCard ? 120 : 100,
        isCard ? 440 : 480,
        isCard ? 100 : 600,
      );
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn(function (
      this: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const cancel = vi.fn();
      motions.push({ target: this, frames, options, cancel, finish });
      return { finished, cancel };
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

describe("movimento e dissolução das OPs", () => {
  it("dissolve o retrato do card que saiu e remove a cópia ao terminar", async () => {
    const { rerender } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    expect(motions).toHaveLength(0);
    rerender(<Board rows={columns([])} />);
    const layer = document.querySelector(".setor-modern-departure-layer")!;
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveTextContent("OS 100");
    expect(layer.querySelector("[data-card-key]")).toBeNull();
    const exit = motions[0]!;
    expect(exit.options.duration).toBe(760);
    expect(exit.frames.at(-1)).toMatchObject({
      opacity: 0,
      filter: "blur(8px)",
    });
    await act(async () => {
      exit.finish();
    });
    expect(layer).not.toBeInTheDocument();
  });

  it("preserva a troca de colunas sem dissolução", () => {
    const { rerender } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    rerender(<Board rows={columns([], [op])} keys={[op.uniqueKey]} />);
    expect(document.querySelector(".setor-modern-departure-layer")).toBeNull();
    expect(motions[0]!.options.duration).toBe(680);
  });

  it("não dissolve uma OP que segue no setor com situação não mapeada", () => {
    const { rerender } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    rerender(<Board rows={columns([])} keys={[op.uniqueKey]} />);
    expect(motions).toHaveLength(0);
  });

  it("não anima saídas causadas pela alteração de configuração ou por movimento reduzido", () => {
    const { rerender } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    rerender(<Board rows={columns([])} configKey="other" />);
    expect(motions).toHaveLength(0);
    rerender(
      <Board rows={columns([op])} keys={[op.uniqueKey]} configKey="other" />,
    );
    reduced = true;
    rerender(<Board rows={columns([])} configKey="other" />);
    expect(motions).toHaveLength(0);
  });

  it("continua dissolvendo durante atualizações e limpa a animação ao desmontar", () => {
    const { rerender, unmount } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    rerender(<Board rows={columns([])} />);
    const layer = document.querySelector(".setor-modern-departure-layer")!;
    rerender(<Board rows={columns([])} />);
    expect(layer).toBeInTheDocument();
    expect(motions[0]!.cancel).not.toHaveBeenCalled();
    unmount();
    expect(layer).not.toBeInTheDocument();
    expect(motions[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("remove a cópia se a OS retornar antes do fim da dissolução", () => {
    const { rerender } = render(
      <Board rows={columns([op])} keys={[op.uniqueKey]} />,
    );
    rerender(<Board rows={columns([])} />);
    rerender(<Board rows={columns([op])} keys={[op.uniqueKey]} />);
    expect(document.querySelector(".setor-modern-departure-layer")).toBeNull();
    expect(motions[0]!.cancel).toHaveBeenCalledOnce();
  });
});
