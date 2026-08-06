export function formatDateBr(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("pt-BR");
}

export function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Texto relativo curto para “última atualização” (pt-BR). */
export function formatRelativeTimeBr(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) {
    return "agora";
  }
  if (mins < 60) {
    return `há ${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `há ${hours} h`;
  }
  return formatDateTimeBr(date.toISOString());
}

export function formatOsLabel(row: { nr_os: number; ano: number }): string {
  return `${row.nr_os}/${row.ano}`;
}

/** Entrada de ponto: apenas dígitos (remove letras, espaços e símbolos). */
export function sanitizePontoDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Formata ponto para exibição (legado script.js). */
export function formatPonto(val: string | number | null | undefined): string {
  if (val == null || val === "") {
    return "";
  }
  const digits = String(val).replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatDateForInput(
  value: string | null | undefined,
): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
