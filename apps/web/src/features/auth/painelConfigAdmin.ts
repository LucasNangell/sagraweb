export const PAINEL_CONFIG_ADMIN_PONTO = 918713;

export function isPainelConfigAdminPonto(
  ponto: number | string | null | undefined,
): boolean {
  if (ponto == null) {
    return false;
  }
  const digits = String(ponto).replace(/\D/g, "");
  if (!digits) {
    return false;
  }
  return Number(digits) === PAINEL_CONFIG_ADMIN_PONTO;
}
