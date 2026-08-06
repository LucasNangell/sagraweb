import { Inbox } from "lucide-react";

interface ClienteSectionEmptyStateProps {
  message: string;
}

export function ClienteSectionEmptyState({ message }: ClienteSectionEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sagra-border bg-slate-50/80 px-6 py-8 text-center">
      <Inbox className="size-7 text-neutral-300" aria-hidden />
      <p className="mt-3 text-sm font-medium text-neutral-600">{message}</p>
    </div>
  );
}
