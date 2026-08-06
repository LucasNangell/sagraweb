import { useEffect, useRef, useState } from "react";

function debounceIdentity(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

/**
 * Debounce por valor estável — objetos com o mesmo conteúdo JSON não
 * reiniciam o timer em re-renders (WS, isFetching, etc.).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const identity = debounceIdentity(value);
  const latestRef = useRef(value);
  latestRef.current = value;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(latestRef.current), delayMs);
    return () => window.clearTimeout(timer);
  }, [identity, delayMs]);

  return debounced;
}
