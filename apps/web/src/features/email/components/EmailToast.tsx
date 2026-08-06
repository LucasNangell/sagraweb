import { CheckCircle2 } from "lucide-react";
import { useEffect } from "react";

interface EmailToastProps {
  message: string | null;
  onClear: () => void;
}

export function EmailToast({ message, onClear }: EmailToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onClear, 3000);
    return () => window.clearTimeout(t);
  }, [message, onClear]);

  if (!message) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 right-4 z-[9999] mx-auto flex max-w-md items-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg sm:bottom-8 sm:left-auto sm:right-8 sm:mx-0 sm:px-5"
      role="status"
    >
      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
