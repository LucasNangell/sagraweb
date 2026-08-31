import { FileDown, Loader2 } from "lucide-react";

import {
  formatOrcamentoBrl,
  OrcamentoCamposPanel,
} from "@/features/orcamento/components/OrcamentoCamposPanel";
import { useOrcamentoEditor } from "@/features/orcamento/hooks/useOrcamentoEditor";
import type { OrcamentoEspecificacaoGrupo } from "@/features/orcamento/types";
import { formatDataExtensoBrasilia } from "@/lib/format";

interface OrcamentoPageProps {
  ano?: string;
  id?: string;
}

export function OrcamentoPage({ ano, id }: OrcamentoPageProps) {
  const editor = useOrcamentoEditor({ ano, id });

  if (!editor.valid) {
    return (
      <p className="p-4 text-sm text-slate-600">
        Selecione uma OS na lista inicial e use o menu de contexto <strong>Orçamento</strong>.
      </p>
    );
  }
  if (editor.query.isError) {
    return (
      <p className="p-4 text-sm text-red-700">
        {editor.query.error instanceof Error
          ? editor.query.error.message
          : "Não foi possível montar o orçamento."}
      </p>
    );
  }
  if (editor.query.isLoading || !editor.entrada || !editor.computed) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" /> Carregando orçamento…
      </div>
    );
  }

  const entrada = editor.entrada;
  const oficio = editor.computed.oficio;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1 md:p-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">
            Orçamento OS {entrada.os.nro_protocolo}/{entrada.os.ano_protocolo}
          </h1>
          <p className="text-sm text-slate-600">
            {entrada.os.solicitante} — {entrada.os.titulo}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          onClick={() => editor.gerarPdf()}
          disabled={editor.pdfPending}
        >
          {editor.pdfPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileDown className="size-3.5" />
          )}
          Gerar PDF
        </button>
      </header>
      {editor.pdfError ? (
        <p className="text-xs text-red-700">{editor.pdfError}</p>
      ) : null}

      <OrcamentoCamposPanel
        entrada={entrada}
        computed={editor.computed}
        onEntradaChange={editor.setEntrada}
        recalcError={editor.recalcError}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed">
        <header className="mb-4 flex items-center gap-3">
          <img
            src={`${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}orcamento-brasao.png`}
            alt=""
            className="h-14 w-14 object-contain"
          />
          <div className="text-[11px] leading-tight text-slate-800">
            <p className="font-bold">CÂMARA DOS DEPUTADOS</p>
            <p>Departamento de Apoio Parlamentar</p>
            <p>Coordenação Gráfica da Câmara</p>
          </div>
        </header>
        <h2 className="mb-2 text-right text-base font-bold">
          ORÇAMENTO{" "}
          {oficio.numero && oficio.ano ? `${oficio.numero}/${oficio.ano}` : "(prévia)"}
        </h2>
        {oficio.processo ? <p>Processo nº {oficio.processo}</p> : null}
        <p>
          Ordem de serviço nº {oficio.os_numero}/{oficio.os_ano}
        </p>
        <p className="mt-2">{formatDataExtensoBrasilia(oficio.data_geracao)}</p>
        <p className="mt-2">
          <strong>Solicitante:</strong> {oficio.solicitante}
        </p>
        <p>
          <strong>Título:</strong> {oficio.titulo}
        </p>
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Especificação
          </p>
          {oficio.especificacao_grupos && oficio.especificacao_grupos.length > 0 ? (
            <EspecificacaoTabela grupos={oficio.especificacao_grupos} />
          ) : (
            <p>{oficio.especificacao}</p>
          )}
        </div>
        <p className="mt-3 font-semibold">
          Valor total: {formatOrcamentoBrl(oficio.valor_total)}
        </p>
        <p className="mt-3 text-xs text-slate-600">- {oficio.clausula_validade}</p>
        <p className="text-xs text-slate-600">- {oficio.clausula_entrega}</p>
        <table className="mt-6 w-full table-fixed border-collapse border border-slate-800 bg-white text-xs">
          <tbody>
            <tr className="align-top">
              <td className="w-1/2 border-r border-slate-800 bg-white px-2 py-2 pb-8">
                Encaminho o presente orçamento conforme solicitação recebida e
                obedecida a norma vigente.
              </td>
              <td className="w-1/2 bg-white px-2 py-2 pb-8">
                Autorizo a execução do trabalho especificado.
              </td>
            </tr>
            <tr className="align-top">
              <td className="w-1/2 border-r border-slate-800 bg-white px-2 py-2 text-center font-semibold">
                {oficio.signatario}
              </td>
              <td className="w-1/2 bg-white px-2 py-2 text-center">Responsável</td>
            </tr>
            <tr className="align-top">
              <td className="w-1/2 border-r border-slate-800 bg-white px-2 py-2 text-center">
                {oficio.cargo}
              </td>
              <td className="w-1/2 bg-white px-2 py-2 text-center">
                Assinatura e Carimbo
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 text-center text-[11px] text-slate-500">
          Endereço: {oficio.endereco}
          <br />
          Telefone: {oficio.telefone}
        </p>
      </section>
    </div>
  );
}

function EspecificacaoTabela({ grupos }: { grupos: OrcamentoEspecificacaoGrupo[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      {grupos.map((grupo) => (
        <tbody key={grupo.titulo}>
          <tr>
            <th
              colSpan={2}
              className="border border-slate-200 bg-slate-100 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600"
            >
              {grupo.titulo}
            </th>
          </tr>
          {(grupo.linhas || []).map((linha) => (
            <tr key={`${grupo.titulo}-${linha.label}`}>
              <td className="w-36 border border-slate-200 px-2 py-1 align-top font-medium text-slate-600">
                {linha.label}
              </td>
              <td className="border border-slate-200 px-2 py-1 text-slate-800">
                {linha.valor}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
