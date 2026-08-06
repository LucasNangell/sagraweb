interface ClienteProofPontoInputProps {
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  /** Exibe prefixo fixo P_ (portal público). */
  withPrefix?: boolean;
  id?: string;
}

export function ClienteProofPontoInput({
  value,
  onChange,
  disabled = false,
  withPrefix = false,
  id,
}: ClienteProofPontoInputProps) {
  const handleChange = (raw: string) => {
    onChange(raw.replace(/\D/g, ""));
  };

  if (!withPrefix) {
    return (
      <input
        id={id}
        className="min-h-11 rounded-xl border border-sagra-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Ex.: 918713"
        inputMode="numeric"
        disabled={disabled}
        required
        aria-required="true"
      />
    );
  }

  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-neutral-600"
        aria-hidden
      >
        P_
      </span>
      <input
        id={id}
        className="min-h-11 w-full rounded-xl border border-sagra-border py-2 pl-9 pr-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        required
        aria-required="true"
        aria-describedby={id ? `${id}-hint` : undefined}
      />
    </div>
  );
}

/** Valor enviado à API (prefixo P_ quando aplicável). */
export function formatProofPontoForApi(digits: string, withPrefix: boolean): string {
  const clean = digits.replace(/\D/g, "");
  if (!clean) return "";
  return withPrefix ? `P_${clean}` : clean;
}

/** Rótulo exibido após envio. */
export function formatProofPontoDisplay(digits: string, withPrefix: boolean): string {
  const clean = digits.replace(/\D/g, "");
  if (!clean) return "—";
  return withPrefix ? `P_${clean}` : clean;
}
