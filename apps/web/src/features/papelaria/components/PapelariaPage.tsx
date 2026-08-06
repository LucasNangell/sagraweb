import { useState } from "react";

import {
  readPapelariaSession,
  resolveInitialPapelariaTab,
  type PapelariaTabId,
} from "../papelariaSession";
import { PapelariaCartaoSvgPanel } from "./PapelariaCartaoSvgPanel";
import { PapelariaCorelPanel } from "./PapelariaCorelPanel";

export function PapelariaPage() {
  const session = readPapelariaSession();
  const osId = session.osId;
  const osAno = session.osAno;
  const osPanelKey = `${osAno ?? ""}-${osId ?? ""}`;
  const [activeTab] = useState<PapelariaTabId>(() => resolveInitialPapelariaTab());

  return (
    <div className="flex min-h-min flex-1 flex-col gap-2 md:h-full md:min-h-0 md:overflow-hidden">
      {activeTab === "cartao" ? (
        <PapelariaCartaoSvgPanel key={osPanelKey} osId={osId} osAno={osAno} />
      ) : (
        <PapelariaCorelPanel key={osPanelKey} osId={osId} osAno={osAno} />
      )}
    </div>
  );
}
