import type { RemoteTypingState } from "@/features/support/hooks/useSupportChatRealtime";
import { cn } from "@sagra/ui";

interface SupportTypingIndicatorProps {
  typing: RemoteTypingState | null;
  className?: string;
}

function typingLabel(typing: RemoteTypingState): string {
  if (typing.role === "admin") {
    return "Suporte está digitando";
  }
  const name = typing.label.trim();
  return name ? `${name} está digitando` : "Usuário está digitando";
}

export function SupportTypingIndicator({ typing, className }: SupportTypingIndicatorProps) {
  if (!typing) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-slate-500",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
      </span>
      <span>{typingLabel(typing)}…</span>
    </div>
  );
}
