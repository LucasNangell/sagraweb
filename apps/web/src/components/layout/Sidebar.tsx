import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { useEmailNotificationStatus } from "@/api/hooks/useEmailQueries";
import { useGravacaoPendenteHasItems } from "@/api/hooks/useGravacaoPendente";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useLombadaUiStore } from "@/features/lombada/lombadaUiStore";
import { useOsSelectionStore } from "@/features/os/osSelectionStore";
import { isPapelariaProduct, setPapelariaNavigationContext } from "@/features/papelaria/papelariaSession";
import {
  isPainelStandalonePath,
  openPainelInNewWindow,
  type PainelStandalonePath,
} from "@/lib/painel-standalone";
import { SupportHelpMenu } from "@/features/support/components/SupportHelpMenu";
import { cn } from "@sagra/ui";
import { sidebarNavTestId, homeTestIds } from "@/lib/testId";

import { navItemKey, type NavItem } from "./nav-config";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItemClassName = (collapsed: boolean) =>
  cn(
    "flex min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-medium no-underline md:min-w-0 md:flex-row md:gap-3 md:rounded-md md:px-2.5 md:py-2 md:text-sm",
    collapsed ? "md:justify-center" : "md:justify-start",
    "text-sagra-text visited:text-sagra-text hover:bg-sagra-bg hover:text-sagra-text hover:no-underline",
    "data-[status=active]:bg-primary-green/15 data-[status=active]:text-primary-green data-[status=active]:visited:text-primary-green",
    "data-[status=active]:ring-2 data-[status=active]:ring-primary-green/40 md:data-[status=active]:ring-0",
  );

function NavItemContent({
  item,
  collapsed,
  showIndicator,
}: {
  item: NavItem;
  collapsed: boolean;
  showIndicator: boolean;
}) {
  const Icon = item.icon;
  const mobileShort =
    item.label.length <= 10 ? item.label : item.label.split(/\s+/)[0];

  return (
    <>
      <span className="relative shrink-0">
        <Icon className="size-6 text-secondary-blue md:size-5" />
        {showIndicator ? (
          <span
            data-testid="sidebar-nav-indicator"
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sagra-danger ring-2 ring-white"
            aria-hidden
          />
        ) : null}
      </span>
      <span className="max-w-[4.25rem] truncate text-center leading-tight md:hidden">
        {mobileShort}
      </span>
      {!collapsed ? (
        <span className="hidden truncate md:inline">{item.label}</span>
      ) : null}
    </>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { isReady, navItems, can } = useAccessControl();
  const selectedOs = useOsSelectionStore((s) => s.selected);
  const pathname = useRouterState((s) => s.location.pathname);
  const openLombadaModal = useLombadaUiStore((s) => s.openModal);
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<Map<string, HTMLElement>>(new Map());

  const emailNotifyEnabled = isReady && can("sb_email");
  const emailNotifyQuery = useEmailNotificationStatus(emailNotifyEnabled);
  const hasEmailActivity =
    emailNotifyEnabled &&
    (emailNotifyQuery.data?.inbox_count ?? 0) +
      (emailNotifyQuery.data?.pendencias_count ?? 0) >
      0;

  const gravacaoPendenteNotifyEnabled = isReady && can("sb_gravacao_pendente");
  const gravacaoPendenteQuery = useGravacaoPendenteHasItems(gravacaoPendenteNotifyEnabled);
  const hasGravacaoPendente =
    gravacaoPendenteNotifyEnabled && gravacaoPendenteQuery.data === true;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(min-width: 768px)").matches) {
      return;
    }
    const activeLink = linkRefs.current.get(pathname);
    if (!activeLink || !navRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      activeLink.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, navItems.length]);

  if (!isReady) {
    return null;
  }

  return (
    <aside
      data-testid={homeTestIds.sidebar}
      className={cn(
        "sagra-sidebar-nav z-40 flex shrink-0 flex-col border-sagra-border bg-white",
        "fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom,0px)] md:relative md:inset-auto md:border-r md:border-t-0 md:pb-0",
        collapsed ? "md:w-16" : "md:w-42",
      )}
    >
      <div className="hidden h-12 items-center justify-end border-b border-sagra-border px-2 md:flex">
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-1.5 text-secondary-blue hover:bg-sagra-bg"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          data-testid={homeTestIds.sidebarCollapse}
        >
          {collapsed ? (
            <ChevronRight className="size-5" />
          ) : (
            <ChevronLeft className="size-5" />
          )}
        </button>
      </div>

      <nav
        ref={navRef}
        className="overflow-x-auto overscroll-x-contain scroll-smooth [-webkit-overflow-scrolling:touch] md:flex-1 md:overflow-y-auto md:overflow-x-hidden md:py-2"
        aria-label="Menu principal"
      >
        <ul className="flex w-max min-w-full items-stretch gap-1 px-2 py-2 md:w-full md:flex-col md:gap-0 md:space-y-0.5 md:px-2 md:py-0">
          {navItems.map((item) => {
            const key = navItemKey(item);
            const showEmailIndicator = item.to === "/email" && hasEmailActivity;
            const showGravacaoIndicator =
              item.to === "/gravacao-externa" && hasGravacaoPendente;
            const showIndicator = showEmailIndicator || showGravacaoIndicator;
            const linkTitle = collapsed
              ? showEmailIndicator
                ? `${item.label} (novos itens)`
                : showGravacaoIndicator
                  ? `${item.label} (OSs pendentes)`
                  : item.label
              : undefined;

            if (item.action === "lombada-calculator") {
              return (
                <li key={key} className="shrink-0 md:w-full">
                  <button
                    type="button"
                    className={cn(navItemClassName(collapsed), "w-full cursor-pointer border-0 bg-transparent")}
                    title={linkTitle ?? item.label}
                    data-testid={sidebarNavTestId(item.to, item.action)}
                    onClick={() => openLombadaModal()}
                  >
                    <NavItemContent
                      item={item}
                      collapsed={collapsed}
                      showIndicator={false}
                    />
                  </button>
                </li>
              );
            }

            const to = item.to;
            if (!to) {
              return null;
            }

            return (
              <li key={key} className="shrink-0 md:w-full">
                <Link
                  ref={(el) => {
                    if (el) {
                      linkRefs.current.set(to, el);
                    } else {
                      linkRefs.current.delete(to);
                    }
                  }}
                  to={to}
                  className={navItemClassName(collapsed)}
                  activeOptions={{ exact: to === "/" }}
                  title={linkTitle ?? item.label}
                  data-testid={sidebarNavTestId(to, item.action)}
                  onClick={
                    item.opensInNewWindow && isPainelStandalonePath(to)
                      ? (e) => {
                          e.preventDefault();
                          openPainelInNewWindow(to as PainelStandalonePath);
                        }
                      : to === "/papelaria" && !selectedOs
                        ? (e) => {
                            e.preventDefault();
                            window.alert("Por favor, selecione uma Ordem de Serviço.");
                          }
                        : to === "/papelaria" &&
                            selectedOs &&
                            selectedOs.nr_os <= 5000 &&
                            !isPapelariaProduct(selectedOs.produto)
                          ? (e) => {
                              e.preventDefault();
                              window.alert(
                                "O acesso à Papelaria é restrito a OS com número superior a 5000.",
                              );
                            }
                          : (to === "/papelaria" || to === "/credenciais-depol") &&
                              selectedOs
                            ? () => {
                                setPapelariaNavigationContext({
                                  nr_os: selectedOs.nr_os,
                                  ano: selectedOs.ano,
                                  produto: selectedOs.produto,
                                });
                              }
                            : undefined
                  }
                >
                  <NavItemContent
                    item={item}
                    collapsed={collapsed}
                    showIndicator={showIndicator}
                  />
                </Link>
              </li>
            );
          })}
          <li className="shrink-0 md:hidden">
            <SupportHelpMenu variant="mobile-nav" />
          </li>
        </ul>

        {navItems.length === 0 && !collapsed ? (
          <p className="hidden px-4 py-6 text-center text-xs text-neutral-500 md:block">
            Nenhum módulo liberado para seu IP.
          </p>
        ) : null}
      </nav>
      <SupportHelpMenu collapsed={collapsed} variant="sidebar-bottom" />
    </aside>
  );
}
