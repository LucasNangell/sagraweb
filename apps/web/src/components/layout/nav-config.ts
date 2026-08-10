import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Calculator,
  ClipboardList,
  Coins,
  Disc3,
  FileText,
  HardDrive,
  Home,
  IdCard,
  Inbox,
  LayoutDashboard,
  Mail,
  Package,
  Printer,
  Settings,
  Shield,
  Users,
} from "lucide-react";

import {
  hasPainelGlobalAccess,
  hasPainelSetorAccess,
  hasPainelTabletAccess,
  hasPermission,
} from "@/features/auth/permissions";
import type { PermissionKey, Permissions } from "@/features/auth/types";

export type NavAction = "lombada-calculator";

export interface NavItem {
  label: string;
  /** Rota TanStack; omitir quando `action` abre modal. */
  to?: string;
  /** Ação sem navegação (ex.: abrir calculadora). */
  action?: NavAction;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Abre em nova janela em modo tela cheia (sem AppShell). */
  opensInNewWindow?: boolean;
}

export function navItemKey(item: NavItem): string {
  if (item.action) {
    return `action:${item.action}`;
  }
  return item.to ?? item.label;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Início", to: "/", icon: Home, permission: "sb_inicio" },
  { label: "E-mail", to: "/email", icon: Mail, permission: "sb_email" },
  { label: "Papelaria", to: "/papelaria", icon: Printer, permission: "sb_papelaria" },
  {
    label: "Credenciais DEPOL",
    to: "/credenciais-depol",
    icon: IdCard,
    permission: "sb_credenciais_depol",
  },
  {
    label: "Relatórios",
    to: "/relatorios",
    icon: FileText,
    permission: "sb_relatorio",
  },
  {
    label: "Painel setor",
    to: "/painel/setor",
    icon: LayoutDashboard,
    permission: "sb_dashboard_setor",
    opensInNewWindow: true,
  },
  {
    label: "Painel global",
    to: "/painel/global",
    icon: BarChart3,
    permission: "sb_dashboard_global",
    opensInNewWindow: true,
  },
  { label: "PCP", to: "/pcp", icon: ClipboardList, permission: "sb_pcp" },
  { label: "Cotas Graf", to: "/cotas-graf", icon: Coins, permission: "sb_cotas_graf" },
  { label: "Estoque", to: "/estoque", icon: Package, permission: "sb_estoque" },
  { label: "Gravação", to: "/gravacao-externa", icon: HardDrive, permission: "sb_gravacao_externa" },
  { label: "Gravação", to: "/gravacao", icon: Disc3, permission: "sb_gravacao" },
  { label: "Usuários", to: "/usuarios", icon: Users, permission: "sb_usuarios" },
  { label: "Admin IPs", to: "/admin/ips", icon: Shield, permission: "sb_admin_ips" },
  {
    label: "Mensagens",
    to: "/admin/mensagens",
    icon: Inbox,
    permission: "sb_admin_ips",
  },
  {
    label: "Configurações",
    to: "/admin/configuracoes",
    icon: Settings,
    permission: "sb_admin_ips",
  },
  {
    label: "Lombada",
    action: "lombada-calculator",
    icon: Calculator,
    permission: "sb_lombada",
  },
];

/** Itens do menu lateral permitidos para o IP/sessão atual. */
export function getVisibleNavItems(
  permissions: Permissions,
  isAuthenticated: boolean,
): NavItem[] {
  if (!isAuthenticated) {
    return [];
  }
  return NAV_ITEMS.filter((item) => {
    if (item.to === "/painel/setor") {
      return hasPainelSetorAccess(permissions);
    }
    if (item.to === "/painel/global") {
      return hasPainelGlobalAccess(permissions);
    }
    if (item.to === "/gravacao-externa") {
      return (
        hasPermission(permissions, "sb_gravacao_externa") ||
        hasPermission(permissions, "sb_gravacao_pendente")
      );
    }
    if (item.to === "/estoque") {
      return (
        hasPermission(permissions, "sb_estoque") ||
        hasPermission(permissions, "sb_estoque_gerente")
      );
    }
    return hasPermission(permissions, item.permission);
  });
}

/** Mapa rota → permissão (guards de rota). Gerência OS: só pelo menu de contexto da lista. */
export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  "/": "sb_inicio",
  "/gerencia": "sb_gerencia",
  "/email": "sb_email",
  "/analise": "sb_analise",
  "/analise-lab": "sb_analise",
  "/papelaria": "sb_papelaria",
  "/credenciais-depol": "sb_credenciais_depol",
  "/relatorios": "sb_relatorio",
  "/painel/setor": "sb_dashboard_setor",
  "/painel/global": "sb_dashboard_global",
  "/painel/tablet": "sb_dashboard_tablet",
  "/painel/celular": "sb_dashboard_tablet",
  "/pcp": "sb_pcp",
  "/cotas-graf": "sb_cotas_graf",
  "/estoque": "sb_estoque",
  "/gravacao-externa": "sb_gravacao_externa",
  "/gravacao": "sb_gravacao",
  "/usuarios": "sb_usuarios",
  "/admin/ips": "sb_admin_ips",
  "/admin/mensagens": "sb_admin_ips",
  "/admin/configuracoes": "sb_admin_ips",
};

function normalizeRoutePath(path: string): string {
  const base = path.split("?")[0].split("#")[0].trim() || "/";
  if (base !== "/" && base.endsWith("/")) {
    return base.slice(0, -1);
  }
  return base;
}

/** Verifica se o usuário pode acessar a rota (espelha filtros do menu lateral). */
export function canAccessRoute(permissions: Permissions, path: string): boolean {
  const normalized = normalizeRoutePath(path);

  if (normalized === "/painel/setor" || normalized.startsWith("/painel/setor/")) {
    return hasPainelSetorAccess(permissions);
  }
  if (normalized === "/painel/global" || normalized.startsWith("/painel/global/")) {
    return hasPainelGlobalAccess(permissions);
  }
  if (normalized === "/painel/tablet" || normalized.startsWith("/painel/tablet/")) {
    return hasPainelTabletAccess(permissions);
  }
  if (
    normalized === "/painel/celular" ||
    normalized.startsWith("/painel/celular/")
  ) {
    return hasPainelTabletAccess(permissions);
  }
  if (normalized === "/gravacao-externa" || normalized.startsWith("/gravacao-externa/")) {
    return (
      hasPermission(permissions, "sb_gravacao_externa") ||
      hasPermission(permissions, "sb_gravacao_pendente")
    );
  }
  if (normalized === "/estoque" || normalized.startsWith("/estoque/")) {
    return (
      hasPermission(permissions, "sb_estoque") ||
      hasPermission(permissions, "sb_estoque_gerente")
    );
  }
  if (
    normalized === "/analise-lab" ||
    normalized.startsWith("/analise-lab/")
  ) {
    return hasPermission(permissions, "sb_analise");
  }
  if (
    normalized === "/prova-web" ||
    normalized.startsWith("/prova-web/")
  ) {
    return hasPermission(permissions, "ctx_prova_web");
  }

  const perm = ROUTE_PERMISSIONS[normalized];
  if (!perm) {
    return false;
  }
  return hasPermission(permissions, perm);
}

/**
 * Rota inicial após login ou quando `/` não é permitido.
 * Respeita redirect explícito se o usuário tiver acesso; senão, primeiro item do menu com rota.
 */
export function resolveDefaultAppRoute(
  permissions: Permissions,
  redirect?: string | null,
): string {
  const target = redirect?.trim();
  if (target && canAccessRoute(permissions, target)) {
    return normalizeRoutePath(target);
  }
  if (hasPainelTabletAccess(permissions)) {
    return "/painel/tablet";
  }
  const visible = getVisibleNavItems(permissions, true);
  const firstRoute = visible.find((item) => item.to)?.to;
  if (firstRoute) {
    return firstRoute;
  }
  return "/";
}
