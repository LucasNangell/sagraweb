import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { analiseFileServeUrl, listAnaliseFiles } from "@/api/analise";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PdfPageCountResult {
  totalPages: number;
  pdfCount: number;
  perFile: { name: string; pages: number; path: string }[];
}

export { parsePgsField } from "./utils";

/** Soma as paginas de todos os PDFs na pasta da versao analisada. */
export async function countPdfPagesInFolder(folderPath: string): Promise<PdfPageCountResult> {
  const data = await listAnaliseFiles(folderPath);
  const pdfs = (data.files ?? []).filter(
    (f) => f.type === "PDF" || f.name.toLowerCase().endsWith(".pdf"),
  );

  let totalPages = 0;
  const perFile: PdfPageCountResult["perFile"] = [];

  for (const file of pdfs) {
    const url = analiseFileServeUrl(file.path);
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Não foi possível ler o PDF "${file.name}" (${response.status}).`);
    }
    const buffer = await response.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    totalPages += pdf.numPages;
    perFile.push({ name: file.name, pages: pdf.numPages, path: file.path });
  }

  return { totalPages, pdfCount: pdfs.length, perFile };
}
