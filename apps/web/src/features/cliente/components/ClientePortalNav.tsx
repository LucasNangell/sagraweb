import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  FileCheck,
  IdCard,
  LayoutDashboard,
  UserRound,
  Users,
} from "lucide-react";

import { cn } from "@sagra/ui";

import { useClienteStore } from "../clienteStore";

const NAV_ITEMS = [
  {
    id: "visao-geral",
    to: "/cliente",
    label: "Visão Geral",
    icon: LayoutDashboard,
    match: (path: string) => path === "/cliente" || path === "/cliente/",
  },
  {
    id: "problemas-tecnicos",
    to: "/cliente/problemas-tecnicos",
    label: "Problemas Técnicos",
    icon: AlertTriangle,
    match: (path: string) =>
      path.startsWith("/cliente/problemas-tecnicos") ||
      path.includes("/problemas-tecnicos"),
  },
  {
    id: "provas",
    to: "/cliente/provas",
    label: "Provas",
    icon: FileCheck,
    match: (path: string) =>
      path.startsWith("/cliente/provas") || path.endsWith("/prova"),
  },
  {
    id: "pendencia-usuario",
    to: "/cliente/pendencia-usuario",
    label: "Pendência usuário",
    icon: UserRound,
    match: (path: string) => path.startsWith("/cliente/pendencia-usuario"),
  },
  {
    id: "contas",
    to: "/cliente/contas",
    label: "Contas",
    icon: Users,
    match: (path: string) => path.startsWith("/cliente/contas"),
  },
  {
    id: "credencial-depol",
    to: "/cliente/credencial-depol",
    label: "Credencial DEPOL",
    icon: IdCard,
    match: (path: string) => path.startsWith("/cliente/credencial-depol"),
    requiresDepol: true,
  },
] as const;

export function ClientePortalNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navDepol = useClienteStore((s) => s.user?.nav_credencial_depol === true);

  const items = NAV_ITEMS.filter((item) =>
    "requiresDepol" in item && item.requiresDepol ? navDepol : true,
  );

  return (
    <nav
      aria-label="Seções do portal"
      className="overflow-x-auto overscroll-x-contain scroll-smooth [-webkit-overflow-scrolling:touch] md:h-full md:overflow-y-auto md:overflow-x-hidden md:py-2"
    >
      <ul className="flex w-max min-w-full items-stretch gap-1 px-2 py-2 md:w-full md:flex-col md:gap-0 md:space-y-0.5 md:px-2 md:py-0">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="shrink-0 md:w-full md:shrink">
              <Link
                to={to}
                className={cn(
                  "flex min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-medium no-underline",
                  "md:w-full md:min-w-0 md:flex-row md:items-center md:justify-start md:gap-3 md:rounded-md md:px-3 md:py-2 md:text-sm",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
                  active
                    ? "bg-sagra-bg font-semibold text-secondary-blue"
                    : "text-neutral-600 hover:bg-sagra-bg hover:text-secondary-blue",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-5 shrink-0 md:size-[1.125rem]" aria-hidden />
                <span className="max-w-[4.5rem] truncate text-center md:max-w-none md:whitespace-nowrap md:text-left">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
