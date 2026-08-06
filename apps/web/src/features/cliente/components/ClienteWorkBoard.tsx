import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FileCheck,
  Upload,
} from "lucide-react";

import type { ClienteDashboardResponse } from "@/api/cliente-portal";

import { ClienteWorkSection } from "./ClienteWorkSection";

interface ClienteWorkBoardProps {
  data: ClienteDashboardResponse;
}

export function ClienteWorkBoard({ data }: ClienteWorkBoardProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const onToggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-10">
      <ClienteWorkSection
        sectionId="sec-pendencias-pt"
        kind="pendencias_pt"
        title="Pendências — Problemas técnicos"
        description="OSs aguardando resolução de problemas técnicos pelo gabinete."
        icon={AlertTriangle}
        items={data.pendencias_pt}
        showPendenciaButton
        emptyMessage="Nenhuma OS com pendência de problemas técnicos."
        expandedKeys={expandedKeys}
        onToggleExpand={onToggleExpand}
      />

      <ClienteWorkSection
        sectionId="sec-pendencias-aprovacao"
        kind="pendencias_aprovacao"
        title="Pendências — Aprovação de prova"
        description="OSs com prova aguardando sua aprovação."
        icon={FileCheck}
        items={data.pendencias_aprovacao}
        showPendenciaButton
        emptyMessage="Nenhuma OS aguardando aprovação de prova."
        expandedKeys={expandedKeys}
        onToggleExpand={onToggleExpand}
      />

      <ClienteWorkSection
        sectionId="sec-pendencias-arquivos"
        kind="pendencias_envio_arquivo"
        title="Pendências — Envio de arquivos"
        description="OSs aguardando envio de arquivos pelo gabinete."
        icon={Upload}
        items={data.pendencias_envio_arquivo}
        showPendenciaButton
        emptyMessage="Nenhuma OS aguardando envio de arquivos."
        expandedKeys={expandedKeys}
        onToggleExpand={onToggleExpand}
      />

      <ClienteWorkSection
        sectionId="sec-em-andamento"
        kind="em_andamento"
        title="OSs em andamento"
        description="Ordens de serviço em produção sem pendência do gabinete."
        icon={ClipboardList}
        items={data.em_andamento}
        emptyMessage="Nenhuma OS em andamento para este gabinete."
        expandedKeys={expandedKeys}
        onToggleExpand={onToggleExpand}
      />
    </div>
  );
}
