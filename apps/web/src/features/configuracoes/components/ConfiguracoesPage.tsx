import { cn } from "@sagra/ui";
import {
  Briefcase,
  Calculator,
  ClipboardList,
  Coins,
  Database,
  IdCard,
  Mail,
  Package,
  Printer,
  Settings,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { BoxModelsSection } from "./BoxModelsSection";
import { CotasGrafSettingsSection } from "./CotasGrafSettingsSection";
import { CredenciaisDepolModelosSection } from "./CredenciaisDepolModelosSection";
import { CustosSettingsSection } from "./CustosSettingsSection";
import { EmailTemplatesSection } from "./EmailTemplatesSection";
import { GerenciaSettingsSection } from "./GerenciaSettingsSection";
import { OrcamentoSettingsSection } from "./OrcamentoSettingsSection";
import { PapelariaProdutosAdminSection } from "./PapelariaProdutosAdminSection";
import { PapelariaWorkerQueueSection } from "./PapelariaWorkerQueueSection";
import { PreAnaliseChecksSection } from "./PreAnaliseChecksSection";
import { SistemaSettingsSection } from "./SistemaSettingsSection";
import "./configuracoesPage.css";

type ConfigTab =
  | "analise"
  | "email"
  | "gerencia"
  | "cotas_graf"
  | "papelaria"
  | "credenciais_depol"
  | "caixas"
  | "sistema"
  | "custos"
  | "orcamento";

const TAB_META: Record<
  ConfigTab,
  { label: string; description: string; icon: ReactNode }
> = {
  analise: {
    label: "Scripts de pré-análise",
    description:
      "Habilite ou desabilite verificações automáticas executadas na análise de PDF.",
    icon: <ClipboardList className="size-3.5" aria-hidden />,
  },
  email: {
    label: "E-mail",
    description:
      "Ativação de cadastro, recuperação de senha, provas OS/SP, problemas técnicos, contas Exchange e tipo de envio.",
    icon: <Mail className="size-3.5" aria-hidden />,
  },
  gerencia: {
    label: "Gerência",
    description: "Opções do fluxo de abertura de OS e solicitação de arquivos ao cliente.",
    icon: <Briefcase className="size-3.5" aria-hidden />,
  },
  cotas_graf: {
    label: "CotasGraf",
    description: "Semestre aberto, limites, recálculo de cache e importação da Gráfica Rápida.",
    icon: <Coins className="size-3.5" aria-hidden />,
  },
  papelaria: {
    label: "Papelaria",
    description:
      "Produtos de papelaria: modelos Corel, mockup 3D e prévia em tempo real. Monitoramento da fila do worker.",
    icon: <Printer className="size-3.5" aria-hidden />,
  },
  credenciais_depol: {
    label: "Credenciais DEPOL",
    description:
      "Modelos JPG da pasta DEPOL, ativação no pedido e layout do SVG (posição/tamanho em mm) compartilhado com o worker.",
    icon: <IdCard className="size-3.5" aria-hidden />,
  },
  caixas: {
    label: "Caixas (Prova WEB)",
    description:
      "Pré-cadastro de facas: painéis, vincos, ângulo e sequência. Usados no mockup 3D da Prova WEB com overlay da arte.",
    icon: <Package className="size-3.5" aria-hidden />,
  },
  sistema: {
    label: "Sistema",
    description:
      "Cadastros de setores, clientes, produtos, papel, máquinas e demais listas usadas no fluxo operacional.",
    icon: <Database className="size-3.5" aria-hidden />,
  },
  custos: {
    label: "Custos",
    description:
      "Cadastro de funções da gráfica e custo de mão de obra (custo mensal → custo/hora automático).",
    icon: <Wallet className="size-3.5" aria-hidden />,
  },
  orcamento: {
    label: "Orçamento",
    description:
      "Alíquotas, cliques, formatos e textos do ofício usados no cálculo Digital/Offset. Preços de material vêm do estoque.",
    icon: <Calculator className="size-3.5" aria-hidden />,
  },
};

export function ConfiguracoesPage() {
  const [activeTab, setActiveTab] = useState<ConfigTab>("analise");
  const activeMeta = TAB_META[activeTab];

  return (
    <div className="configuracoes-page-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="configuracoes-page-scroll mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 xl:px-6">
        <header className="configuracoes-page-header shrink-0">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Settings className="size-5 text-secondary-blue" />
            Configurações do sistema
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            Painel administrativo do SAGRA. Alterações aqui afetam o comportamento global —
            revise cada seção antes de salvar.
          </p>
          <div
            className="configuracoes-tab-list mt-4"
            role="tablist"
            aria-label="Seções de configuração"
          >
            {(Object.keys(TAB_META) as ConfigTab[]).map((tab) => {
              const meta = TAB_META[tab];
              const active = activeTab === tab;
              return (
                <TabButton
                  key={tab}
                  id={`config-tab-${tab}`}
                  active={active}
                  panelId={`config-panel-${tab}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {meta.icon}
                  {meta.label}
                </TabButton>
              );
            })}
          </div>
        </header>

        <div className="configuracoes-tab-intro shrink-0" role="note">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            {activeMeta.icon}
            {activeMeta.label}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{activeMeta.description}</p>
        </div>

        <div className="configuracoes-tab-panel pb-4">
          <div
            role="tabpanel"
            id="config-panel-analise"
            aria-labelledby="config-tab-analise"
            hidden={activeTab !== "analise"}
            className="configuracoes-tab-panel"
          >
            <PreAnaliseChecksSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-email"
            aria-labelledby="config-tab-email"
            hidden={activeTab !== "email"}
            className="configuracoes-tab-panel"
          >
            <EmailTemplatesSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-gerencia"
            aria-labelledby="config-tab-gerencia"
            hidden={activeTab !== "gerencia"}
            className="configuracoes-tab-panel"
          >
            <GerenciaSettingsSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-cotas-graf"
            aria-labelledby="config-tab-cotas-graf"
            hidden={activeTab !== "cotas_graf"}
            className="configuracoes-tab-panel"
          >
            <CotasGrafSettingsSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-papelaria"
            aria-labelledby="config-tab-papelaria"
            hidden={activeTab !== "papelaria"}
            className="configuracoes-tab-panel"
          >
            <PapelariaProdutosAdminSection />
            <PapelariaWorkerQueueSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-credenciais_depol"
            aria-labelledby="config-tab-credenciais_depol"
            hidden={activeTab !== "credenciais_depol"}
            className="configuracoes-tab-panel"
          >
            <CredenciaisDepolModelosSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-caixas"
            aria-labelledby="config-tab-caixas"
            hidden={activeTab !== "caixas"}
            className="configuracoes-tab-panel"
          >
            <BoxModelsSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-sistema"
            aria-labelledby="config-tab-sistema"
            hidden={activeTab !== "sistema"}
            className="configuracoes-tab-panel"
          >
            <SistemaSettingsSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-custos"
            aria-labelledby="config-tab-custos"
            hidden={activeTab !== "custos"}
            className="configuracoes-tab-panel"
          >
            <CustosSettingsSection />
          </div>
          <div
            role="tabpanel"
            id="config-panel-orcamento"
            aria-labelledby="config-tab-orcamento"
            hidden={activeTab !== "orcamento"}
            className="configuracoes-tab-panel"
          >
            <OrcamentoSettingsSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  panelId,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  panelId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
        active
          ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
          : "text-slate-600 hover:bg-white/60 hover:text-secondary-blue",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
