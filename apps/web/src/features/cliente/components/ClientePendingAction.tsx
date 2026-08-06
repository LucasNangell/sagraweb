import { ExternalLink } from "lucide-react";

import { cn } from "@sagra/ui";

interface ClientePendingActionProps {
  href: string;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

export function ClientePendingAction({
  href,
  label,
  className,
  size = "md",
}: ClientePendingActionProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-green font-medium text-white shadow-sm",
        "w-full sm:w-auto",
        "transition-all duration-200 hover:bg-primary-green/90 active:scale-[0.98]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-green",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="size-4 shrink-0" aria-hidden />
    </a>
  );
}
