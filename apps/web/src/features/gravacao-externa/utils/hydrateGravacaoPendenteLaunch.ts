import type { NetworkFilePick } from "@/api/networkFiles";

import type {
  GravacaoPendenteArquivoLaunch,
  GravacaoPendenteChapaInput,
} from "../components/GravacaoPendenteLaunchModal";

export interface HydratedChapaRow {
  key: string;
  maquina: string;
  quantidade: string;
  arquivos: NetworkFilePick[];
  espelhosPdf: NetworkFilePick[];
}

export interface HydratedGravacaoPendenteLaunch {
  chapas: HydratedChapaRow[];
}

const TIF_EXTS = new Set(["tif", "tiff"]);

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isTifFile(name: string): boolean {
  return TIF_EXTS.has(getExt(name));
}

function isPdfFile(name: string): boolean {
  return getExt(name) === "pdf";
}

function emptyChapaRow(): HydratedChapaRow {
  return {
    key: crypto.randomUUID(),
    maquina: "",
    quantidade: "",
    arquivos: [],
    espelhosPdf: [],
  };
}

/** Reconstrói o estado do modal a partir dos arquivos/chapas já salvos na sessão. */
export function hydrateGravacaoPendenteLaunch(
  arquivos: GravacaoPendenteArquivoLaunch[],
  chapas: GravacaoPendenteChapaInput[] = [],
): HydratedGravacaoPendenteLaunch {
  const tifsByMachine = new Map<string, NetworkFilePick[]>();
  const pdfsByMachine = new Map<string, NetworkFilePick[]>();
  const orphanTifs: NetworkFilePick[] = [];
  const orphanPdfs: NetworkFilePick[] = [];

  for (const arq of arquivos) {
    const absolute_path = String(arq.absolute_path || "").trim();
    const nome = String(arq.nome || "").trim() || absolute_path.split(/[/\\]/).pop() || absolute_path;
    if (!absolute_path) continue;
    const pick: NetworkFilePick = { absolute_path, nome };
    const maquina = String(arq.maquina || "").trim();

    if (isPdfFile(nome)) {
      if (!maquina) {
        orphanPdfs.push(pick);
        continue;
      }
      const list = pdfsByMachine.get(maquina) ?? [];
      list.push(pick);
      pdfsByMachine.set(maquina, list);
      continue;
    }

    if (!maquina) {
      if (isTifFile(nome)) orphanTifs.push(pick);
      continue;
    }
    const list = tifsByMachine.get(maquina) ?? [];
    list.push(pick);
    tifsByMachine.set(maquina, list);
  }

  const rows: HydratedChapaRow[] = [];
  const seen = new Set<string>();

  for (const ch of chapas) {
    const maquina = String(ch.maquina || "").trim();
    if (!maquina) continue;
    seen.add(maquina);
    const files = tifsByMachine.get(maquina) ?? [];
    rows.push({
      key: crypto.randomUUID(),
      maquina,
      quantidade: String(ch.quantidade || files.length || ""),
      arquivos: files,
      espelhosPdf: pdfsByMachine.get(maquina) ?? [],
    });
  }

  for (const [maquina, files] of tifsByMachine) {
    if (seen.has(maquina)) continue;
    seen.add(maquina);
    rows.push({
      key: crypto.randomUUID(),
      maquina,
      quantidade: String(files.filter((f) => isTifFile(f.nome)).length || ""),
      arquivos: files,
      espelhosPdf: pdfsByMachine.get(maquina) ?? [],
    });
  }

  for (const [maquina, pdfs] of pdfsByMachine) {
    if (seen.has(maquina)) continue;
    seen.add(maquina);
    rows.push({
      key: crypto.randomUUID(),
      maquina,
      quantidade: "",
      arquivos: [],
      espelhosPdf: pdfs,
    });
  }

  if (orphanTifs.length > 0) {
    if (rows.length === 0) {
      rows.push({
        key: crypto.randomUUID(),
        maquina: "",
        quantidade: String(orphanTifs.length),
        arquivos: orphanTifs,
        espelhosPdf: [],
      });
    } else {
      rows[0] = {
        ...rows[0],
        arquivos: [...rows[0].arquivos, ...orphanTifs],
      };
    }
  }

  if (orphanPdfs.length > 0) {
    if (rows.length === 0) {
      rows.push({
        key: crypto.randomUUID(),
        maquina: "",
        quantidade: "",
        arquivos: [],
        espelhosPdf: orphanPdfs,
      });
    } else {
      rows[0] = {
        ...rows[0],
        espelhosPdf: [...rows[0].espelhosPdf, ...orphanPdfs],
      };
    }
  }

  return {
    chapas: rows.length > 0 ? rows : [emptyChapaRow()],
  };
}
