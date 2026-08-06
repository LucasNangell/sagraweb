import { useCallback, useEffect, useRef, useState } from "react";

import type { ClienteDashboardResponse } from "@/api/cliente-portal";

import type { SectionKind } from "../types/clienteProgress";
import {
  CLIENTE_DASHBOARD_SECTIONS,
  defaultOpenSection,
} from "../utils/clienteSectionConfig";
import { ClienteCollapsibleSection } from "./ClienteCollapsibleSection";

interface ClienteCollapsibleWorkBoardProps {
  data: ClienteDashboardResponse;
  vinculoLabel: string;
  navigateToSection?: SectionKind | null;
  onNavigateHandled?: () => void;
}

export function ClienteCollapsibleWorkBoard({
  data,
  vinculoLabel,
  navigateToSection,
  onNavigateHandled,
}: ClienteCollapsibleWorkBoardProps) {
  const initRef = useRef(false);
  const [openSections, setOpenSections] = useState<Set<SectionKind>>(() => new Set());
  const [expandedOsKeys, setExpandedOsKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const initial = defaultOpenSection(data);
    if (initial) {
      setOpenSections(new Set([initial]));
    }
  }, [data]);

  useEffect(() => {
    if (!navigateToSection) return;
    setOpenSections((prev) => new Set(prev).add(navigateToSection));
    const config = CLIENTE_DASHBOARD_SECTIONS.find((s) => s.kind === navigateToSection);
    if (config) {
      requestAnimationFrame(() => {
        document.getElementById(config.sectionId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
    onNavigateHandled?.();
  }, [navigateToSection, onNavigateHandled]);

  const toggleSection = useCallback((kind: SectionKind) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }, []);

  const toggleOsExpand = useCallback((key: string) => {
    setExpandedOsKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      {CLIENTE_DASHBOARD_SECTIONS.map((config) => {
        const items = config.getItems(data);

        return (
          <ClienteCollapsibleSection
            key={config.kind}
            config={config}
            items={items}
            vinculoLabel={vinculoLabel}
            isOpen={openSections.has(config.kind)}
            onToggle={() => toggleSection(config.kind)}
            expandedOsKeys={expandedOsKeys}
            onToggleOsExpand={toggleOsExpand}
          />
        );
      })}
    </div>
  );
}
