import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, CircleHelp, GraduationCap, MessageSquare } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { queryKeys } from "@/api/query-keys";
import { fetchSupportSettings, userManualUrl } from "@/api/support";
import { getTourCatalog } from "@/features/guided-tour/catalog";
import { useGuidedTourStore } from "@/features/guided-tour/tourStore";
import { homeTestIds } from "@/lib/testId";
import { cn } from "@sagra/ui";

interface SupportHelpMenuProps {
  collapsed?: boolean;
  variant?: "sidebar-bottom" | "mobile-nav";
}

export function SupportHelpMenu({
  collapsed = false,
  variant = "sidebar-bottom",
}: SupportHelpMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tutorialsOpen, setTutorialsOpen] = useState(false);
  const navigate = useNavigate();
  const startTour = useGuidedTourStore((s) => s.start);
  const catalog = getTourCatalog();
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsQuery = useQuery({
    queryKey: queryKeys.support.settings,
    queryFn: fetchSupportSettings,
    staleTime: 60_000,
  });
  const usuarioChatEnabled = settingsQuery.data?.usuario_chat_enabled ?? true;

  useEffect(() => {
    if (!menuOpen) {
      setTutorialsOpen(false);
      return;
    }
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const openManual = () => {
    setMenuOpen(false);
    window.open(userManualUrl(), "_blank", "noopener,noreferrer");
  };

  const openSupportPage = () => {
    setMenuOpen(false);
    setTutorialsOpen(false);
    void navigate({ to: "/mensagens" });
  };

  const startTutorial = (id: string) => {
    setMenuOpen(false);
    setTutorialsOpen(false);
    void navigate({ to: "/" });
    startTour(id);
  };

  const isMobileNav = variant === "mobile-nav";

  return (
    <>
      <div
        ref={rootRef}
        className={cn(
          "relative",
          isMobileNav ? "shrink-0" : "hidden border-t border-sagra-border px-2 py-2 md:block",
        )}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            isMobileNav
              ? "flex min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-medium text-sagra-text"
              : cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-sagra-text hover:bg-sagra-bg",
                  collapsed ? "justify-center" : "",
                ),
          )}
          aria-label="Ajuda"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="Ajuda"
          data-testid={homeTestIds.sidebarHelp}
        >
          <CircleHelp className={cn("shrink-0 text-secondary-blue", isMobileNav ? "size-6" : "size-5")} />
          {isMobileNav || !collapsed ? (
            <span
              className={cn(
                isMobileNav
                  ? "max-w-[4.25rem] truncate text-center leading-tight"
                  : "hidden truncate md:inline",
              )}
            >
              Ajuda
            </span>
          ) : null}
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className={cn(
              "absolute z-50 rounded-md border border-slate-200 bg-white py-1 shadow-lg",
              isMobileNav
                ? "bottom-full left-1/2 mb-2 w-56 -translate-x-1/2"
                : "bottom-full left-2 mb-1 w-56",
            )}
          >
            <button
              type="button"
              role="menuitem"
              onClick={openManual}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              data-testid={homeTestIds.sidebarHelpManual}
            >
              <BookOpen className="size-4 text-secondary-blue" aria-hidden />
              Manual do Usuário
            </button>
            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-expanded={tutorialsOpen}
                aria-haspopup="menu"
                onClick={() => setTutorialsOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                data-testid={homeTestIds.sidebarHelpTutorial}
              >
                <GraduationCap className="size-4 text-secondary-blue" aria-hidden />
                <span className="flex-1">Tutorial guiado</span>
                <ChevronRight
                  className={cn(
                    "size-4 text-slate-400 transition-transform",
                    tutorialsOpen && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>
              {tutorialsOpen ? (
                <div
                  role="menu"
                  aria-label="Tutoriais guiados"
                  className={cn(
                    "rounded-md border border-slate-200 bg-white py-1 shadow-lg",
                    isMobileNav
                      ? "mx-2 mb-1"
                      : "absolute bottom-0 left-full ml-1 w-56",
                  )}
                >
                  {catalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => startTutorial(item.id)}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      data-testid={homeTestIds.sidebarHelpTutorialItem(item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {usuarioChatEnabled ? (
              <button
                type="button"
                role="menuitem"
                onClick={openSupportPage}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                data-testid={homeTestIds.sidebarHelpSupport}
              >
                <MessageSquare className="size-4 text-secondary-blue" aria-hidden />
                Mensagem ao suporte
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
