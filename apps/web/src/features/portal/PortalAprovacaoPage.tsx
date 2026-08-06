import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";
import { ClienteProofPage } from "@/features/cliente/components/proof/ClienteProofPage";

interface PortalAprovacaoPageProps {
  token: string;
  osId: number;
  ano: number;
}

/** Portal público por token — reutiliza a mesma UI de prova do portal autenticado. */
export function PortalAprovacaoPage({ token, osId, ano }: PortalAprovacaoPageProps) {
  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-sagra-bg">
      <PortalSystemHeader subtitle="Portal do Cliente — Aprovação de Prova" />
      <ClienteProofPage token={token} osId={osId} ano={ano} fillHeight publicPortal />
    </div>
  );
}
