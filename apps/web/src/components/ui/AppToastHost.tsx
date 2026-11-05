import type { CSSProperties } from "react";

import { useToastStore, type ToastVariant } from "./toastStore";

const VARIANT_STYLES: Record<
  ToastVariant,
  { accent: string; mark: string; label: string }
> = {
  success: {
    accent: "#b9f472",
    mark: "✓",
    label: "Sucesso",
  },
  warning: {
    accent: "#f0b429",
    mark: "!",
    label: "Atenção",
  },
  error: {
    accent: "#f87171",
    mark: "✕",
    label: "Erro",
  },
};

export function AppToastHost() {
  const items = useToastStore((s) => s.items);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 z-[12000] flex w-[min(100%-1.5rem,26rem)] flex-col gap-2 sm:right-4 top-[calc(3.5rem+0.5rem)] sm:top-[calc(4rem+0.5rem)] lg:top-[calc(5rem+0.5rem)]"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => {
        const style = VARIANT_STYLES[item.variant];
        return (
          <div
            key={item.id}
            role="status"
            className="sagra-toast pointer-events-none flex items-center gap-2 rounded-[8px] border border-white/10 px-2.5 py-2 text-[13px] leading-[1.42] shadow-[0_14px_34px_#0002]"
            style={
              {
                background: "#1d2724",
                color: "#eef6e8",
                borderLeft: `3px solid ${style.accent}`,
                backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${style.accent} 17%, #1d2724), #1d2724 42%)`,
              } satisfies CSSProperties
            }
          >
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-[6px] text-sm font-semibold"
              style={{
                background: `color-mix(in srgb, ${style.accent} 22%, #1d2724)`,
                color: style.accent,
              }}
              title={style.label}
            >
              {style.mark}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {item.message}
            </span>
          </div>
        );
      })}
      <style>{`
        @keyframes sagra-toast-enter {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sagra-toast {
          animation: sagra-toast-enter 190ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .sagra-toast { animation: none; }
        }
      `}</style>
    </div>
  );
}
