import { cn } from "@sagra/ui";

import { AlertTriangle, FileText, Loader2 } from "lucide-react";



import type { EmailProofFileEntry } from "../types";



function formatFileSize(bytes: number): string {

  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

}



function formatModifiedAt(iso: string | null | undefined): string {

  if (!iso) return "—";

  try {

    return new Date(iso).toLocaleString("pt-BR", {

      dateStyle: "short",

      timeStyle: "short",

    });

  } catch {

    return iso;

  }

}



export interface EmailProofFileSelectorProps {

  files: EmailProofFileEntry[];

  suggested: string | null;

  selectedFilename: string;

  onSelect: (filename: string) => void;

  onChangeFile?: () => void;

  isLoading: boolean;

  isError: boolean;

  errorMessage?: string;

}



export function EmailProofFileSelector({

  files,

  suggested,

  selectedFilename,

  onSelect,

  onChangeFile,

  isLoading,

  isError,

  errorMessage,

}: EmailProofFileSelectorProps) {

  if (isLoading) {

    return (

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">

        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />

        Carregando PDFs da pasta Sefoc…

      </div>

    );

  }



  if (isError) {

    return (

      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-800">

        <AlertTriangle className="mb-1 inline size-4 align-text-bottom" aria-hidden />

        {" "}

        {errorMessage || "Erro ao listar PDFs de prova."}

      </div>

    );

  }



  const displayName = selectedFilename.trim();

  const selectedMeta = displayName

    ? files.find((file) => file.name === displayName)

    : undefined;

  const isSuggested =

    Boolean(displayName) && suggested != null && suggested === displayName;

  const canChange = Boolean(onChangeFile);



  if (files.length === 0 && !displayName) {

    return (

      <div className="mt-4 space-y-2">

        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-900">

          <strong>Atenção:</strong> Nenhum PDF de prova foi encontrado na pasta Sefoc desta OS.

          {canChange ? " Use «Alterar» para procurar na pasta da OS." : ""}

        </div>

        {canChange ? (

          <button

            type="button"

            onClick={onChangeFile}

            className="rounded border border-secondary-blue/40 bg-white px-3 py-1.5 text-xs font-semibold text-secondary-blue hover:bg-blue-50"

          >

            Alterar

          </button>

        ) : null}

      </div>

    );

  }



  return (

    <fieldset className="mt-4 space-y-2">

      <legend className="text-sm font-semibold text-slate-800">

        Arquivo de prova para aprovação do cliente

      </legend>

      <p className="text-xs text-slate-500">

        O PDF selecionado será usado no portal ou anexado ao e-mail, conforme o modelo ativo.

      </p>



      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">

        <FileText className="size-4 shrink-0 text-secondary-blue" aria-hidden />

        <span className="min-w-0 flex-1 break-all text-sm font-medium text-slate-900">

          {displayName || "Nenhum arquivo selecionado"}

        </span>

        {isSuggested ? (

          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase text-amber-900">

            Sugerido

          </span>

        ) : null}

        {canChange ? (

          <button

            type="button"

            onClick={onChangeFile}

            className="shrink-0 rounded border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-secondary-blue/40 hover:bg-blue-50 hover:text-secondary-blue"

          >

            Alterar

          </button>

        ) : null}

      </div>



      {selectedMeta ? (

        <p className="text-[0.65rem] text-slate-500">

          {formatFileSize(selectedMeta.size)} · modificado em{" "}

          {formatModifiedAt(selectedMeta.modified_at)}

        </p>

      ) : displayName ? (

        <p className="text-[0.65rem] text-slate-500">

          Arquivo escolhido na pasta da OS (fora da lista automática de Sefoc).

        </p>

      ) : null}



      {files.length > 1 && !displayName ? (

        <p className="text-xs font-medium text-amber-800">

          Há vários PDFs em Sefoc — use «Alterar» para escolher o arquivo correto.

        </p>

      ) : null}



      {files.length > 1 && !canChange ? (

        <div className="space-y-2 border-t border-slate-100 pt-2">

          <p className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-500">

            Outros PDFs em Sefoc

          </p>

          {files.map((file) => {

            const fileSuggested = suggested === file.name;

            const fileSelected = selectedFilename === file.name;

            return (

              <button

                key={file.name}

                type="button"

                onClick={() => onSelect(file.name)}

                className={cn(

                  "flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-left text-xs transition",

                  fileSelected

                    ? "border-secondary-blue bg-blue-50/80"

                    : "border-slate-200 bg-white hover:border-slate-300",

                )}

              >

                <span className="min-w-0 flex-1 break-all font-medium text-slate-800">

                  {file.name}

                </span>

                {fileSuggested ? (

                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[0.6rem] font-semibold uppercase text-amber-900">

                    Sugerido

                  </span>

                ) : null}

              </button>

            );

          })}

        </div>

      ) : null}

    </fieldset>

  );

}



export function isProofSendBlocked(

  emailType: string,

  proofLoading: boolean,

  proofError: boolean,

  proofFilesCount: number,

  selectedFilename: string,

  allowWithoutPdf = false,

): boolean {

  if (emailType !== "proof") return false;

  if (allowWithoutPdf) return false;

  return (

    proofLoading ||

    proofError ||

    (proofFilesCount === 0 && !selectedFilename.trim()) ||

    !selectedFilename.trim()

  );

}


