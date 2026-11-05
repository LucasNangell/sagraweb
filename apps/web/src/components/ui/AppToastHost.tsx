import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useToastStore, type ToastVariant } from "./toastStore";

const VARIANT_STYLES: Record<
  ToastVariant,
  { accent: string; tint: string; mark: string; label: string }
> = {
  success: {
    accent: "#b9f472",
    tint: "#2a3a2f",
    mark: "✓",
    label: "Sucesso",
  },
  warning: {
    accent: "#f0b429",
    tint: "#3a3424",
    mark: "!",
    label: "Atenção",
  },
  error: {
    accent: "#f87171",
    tint: "#3a2828",
    mark: "✕",
    label: "Erro",
  },
};

export function AppToastHost() {
  const items = useToastStore((s) => s.items);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || items.length === 0) {
    return null;
  }

  return createPortal(
    <div
      data-testid="sagra-toast-host"
      className="pointer-events-none fixed right-3 z-[2147483000] flex w-[min(100%-1.5rem,26rem)] flex-col gap-2 sm:right-4"
      style={{
        top: "calc(3.5rem + 0.5rem)",
      }}
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => {
        const style = VARIANT_STYLES[item.variant];
        return (
          <div
            key={item.id}
            role="status"
            data-testid={`sagra-toast-${item.variant}`}
            className="sagra-toast pointer-events-none flex items-center gap-2 rounded-[8px] border px-2.5 py-2 text-[13px] leading-[1.42] shadow-[0_14px_34px_rgba(0,0,0,0.35)]"
            style={{
              background: style.tint,
              color: "#eef6e8",
              borderColor: "rgba(255,255,255,0.12)",
              borderLeft: `3px solid ${style.accent}`,
            }}
          >
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-[6px] text-sm font-semibold"
              style={{
                background: "rgba(0,0,0,0.25)",
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
        @media (min-width: 640px) {
          [data-testid="sagra-toast-host"] { top: calc(4rem + 0.5rem) !important; }
        }
        @media (min-width: 1024px) {
          [data-testid="sagra-toast-host"] { top: calc(5rem + 0.5rem) !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
