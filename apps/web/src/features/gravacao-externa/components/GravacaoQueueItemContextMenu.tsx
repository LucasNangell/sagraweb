import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface GravacaoQueueItemContextMenuProps {
  children: ReactElement;
  enabled: boolean;
  label: string;
  removing?: boolean;
  onRemove: () => void | Promise<void>;
}

export function GravacaoQueueItemContextMenu({
  children,
  enabled,
  label,
  removing = false,
  onRemove,
}: GravacaoQueueItemContextMenuProps) {
  if (!enabled) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{label}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={removing}
          className="text-red-700 focus:bg-red-50 focus:text-red-800"
          onSelect={() => void onRemove()}
        >
          <Trash2 className="size-4" />
          {removing ? "Removendo…" : "Remover da lista"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
