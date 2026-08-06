import { useEffect } from "react";

import { LoginScreen } from "@/auth/LoginScreen";
import { useAuthStore } from "@/auth/authStore";
import { BoardScreen } from "@/board/BoardScreen";

export function App() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">SAGRA</div>
        <p>Carregando…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <BoardScreen />;
}
