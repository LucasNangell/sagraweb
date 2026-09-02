import { useEffect, useRef, useState } from "react";

import { fetchProofPessoaNome } from "@/api/proof-portal";

const DEBOUNCE_MS = 400;
const MIN_DIGITS = 4;

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function useProofGalNomeLookup(options: {
  enabled: boolean;
  ano: number;
  osId: number;
  token: string;
  pontoDigits: string;
  nomeCliente: string;
  onNomeChange: (nome: string) => void;
}): { pending: boolean; lockNome: boolean } {
  const { enabled, ano, osId, token, pontoDigits, nomeCliente, onNomeChange } =
    options;
  const [pending, setPending] = useState(false);
  const [settledDigits, setSettledDigits] = useState<string | null>(null);
  const filledFromLookupRef = useRef<string>("");
  const nomeRef = useRef(nomeCliente);
  const onNomeChangeRef = useRef(onNomeChange);
  const prevDigitsRef = useRef<string | null>(null);
  nomeRef.current = nomeCliente;
  onNomeChangeRef.current = onNomeChange;

  const digits = onlyDigits(pontoDigits);

  useEffect(() => {
    if (!enabled) {
      prevDigitsRef.current = digits;
      return;
    }
    const prev = prevDigitsRef.current;
    prevDigitsRef.current = digits;
    if (prev === null || prev === digits) return;
    filledFromLookupRef.current = "";
    if (nomeRef.current.trim()) {
      onNomeChangeRef.current("");
    }
  }, [enabled, digits]);

  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return;
    }
    if (digits.length < MIN_DIGITS) {
      setPending(false);
      setSettledDigits(null);
      return;
    }

    let cancelled = false;
    setPending(true);
    const timer = window.setTimeout(() => {
      void fetchProofPessoaNome(ano, osId, token, digits)
        .then((res) => {
          if (cancelled) return;
          const nome = (res.nome ?? "").trim();
          if (!nome) return;
          const still = nomeRef.current.trim();
          if (still && still !== filledFromLookupRef.current) return;
          filledFromLookupRef.current = nome;
          onNomeChangeRef.current(nome);
        })
        .catch(() => {
          /* falha silenciosa */
        })
        .finally(() => {
          if (!cancelled) {
            setPending(false);
            setSettledDigits(digits);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, ano, osId, token, digits]);

  const searching = Boolean(
    enabled && digits.length >= MIN_DIGITS && (pending || settledDigits !== digits),
  );
  const lockNome = Boolean(enabled && (digits.length < MIN_DIGITS || searching));

  return { pending: searching, lockNome };
}
