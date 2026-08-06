import type { UsuarioRecord, UsuarioRow } from "./types";

export function mergeUsuariosWithOnline(
  users: UsuarioRecord[],
  onlinePoints: Array<string | number>,
): UsuarioRow[] {
  const safeUsers = Array.isArray(users) ? users : [];
  const safeOnline = Array.isArray(onlinePoints) ? onlinePoints : [];

  const rows = safeUsers.map((user) => {
    const ponto = parseInt(String(user.Ponto), 10);
    const isOnline = safeOnline.some(
      (onlinePonto) => parseInt(String(onlinePonto), 10) === ponto,
    );
    return { ...user, isOnline };
  });

  rows.sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;

    const nomeA = (a.Nome || "").toLowerCase();
    const nomeB = (b.Nome || "").toLowerCase();
    return nomeA.localeCompare(nomeB, "pt-BR");
  });

  return rows;
}

export function formatUltimoAcesso(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}
