import { useEffect, type ReactNode } from "react";

import { OsFilterPreferencesSync } from "@/components/auth/OsFilterPreferencesSync";
import { useAuthStore } from "@/features/auth/authStore";

interface AuthBootstrapProps {
  children: ReactNode;
}

/** Dispara hidratação da sessão uma vez ao abrir o app (não bloqueia o router). */
export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <OsFilterPreferencesSync />
      {children}
    </>
  );
}
