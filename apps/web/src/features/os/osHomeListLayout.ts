import { cn } from "@sagra/ui";

export type OsHomeMobileView = "list" | "details" | "history";

export function osHomeListPaneClassName(
  listExpanded: boolean,
  mobileView: OsHomeMobileView,
): string {
  return cn(
    "min-h-[min(50vh,360px)] flex-none md:min-h-[clamp(160px,32vh,360px)] md:flex-[5] md:overflow-hidden lg:min-h-[180px]",
    listExpanded && "lg:min-h-0 lg:flex-1",
    mobileView !== "list" ? "hidden lg:block" : "block",
  );
}

export function osHomeDetailsPaneClassName(
  listExpanded: boolean,
  mobileView: OsHomeMobileView,
): string {
  if (listExpanded) {
    if (mobileView === "list") {
      return "hidden";
    }
    return "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden lg:hidden";
  }
  const base =
    "flex min-h-0 flex-col gap-2 md:grid md:grid-cols-1 md:gap-2 lg:grid-cols-2 lg:gap-3";
  if (mobileView === "list") {
    return cn(
      base,
      "hidden lg:grid lg:flex-none lg:min-h-[220px] lg:overflow-hidden md:min-h-[clamp(200px,38vh,420px)] md:flex-[4]",
    );
  }
  return cn(
    base,
    "min-h-0 flex-1 overflow-hidden md:flex-none md:min-h-[clamp(200px,38vh,420px)] md:flex-[4] lg:min-h-[220px] lg:overflow-hidden",
  );
}
