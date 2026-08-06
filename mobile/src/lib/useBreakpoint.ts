import { useEffect, useState } from "react";

export type Breakpoint = "phone" | "tablet";

export function useBreakpoint(thresholdPx = 640): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window !== "undefined" && window.innerWidth >= thresholdPx
      ? "tablet"
      : "phone",
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${thresholdPx}px)`);
    const onChange = () => setBp(mq.matches ? "tablet" : "phone");
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [thresholdPx]);

  return bp;
}
