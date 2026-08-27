import { Outlet } from "@tanstack/react-router";
import { useState } from "react";

import { LombadaCalculatorModal } from "@/features/lombada/components/LombadaCalculatorModal";
import { useLombadaUiStore } from "@/features/lombada/lombadaUiStore";
import { SupportMessageModal } from "@/features/support/components/SupportMessageModal";
import { useSupportUiStore } from "@/features/support/supportUiStore";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const showAssignedSupportModal = useSupportUiStore(
    (s) => s.modalOpen && s.modalKind === "assigned",
  );
  const showLombadaModal = useLombadaUiStore((s) => s.open);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sagra-bg">
      <Header />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] sm:p-3 md:p-2 md:pb-2 lg:p-[calc(var(--spacing)*2)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </main>
      </div>
      {showAssignedSupportModal ? <SupportMessageModal /> : null}
      {showLombadaModal ? <LombadaCalculatorModal /> : null}
    </div>
  );
}
