import type { AnaliseComponente } from "./types";

export interface VersionPdfFile {
  name: string;
  path: string;
  pages: number;
  componente: AnaliseComponente;
  /** PDF não encontrado na pasta da versão (produto com capa+miolo). */
  ausente?: boolean;
}

export interface ClassifyVersionPdfOptions {
  versionLabel?: string;
  produto?: string | null;
  /** Em produto sem capa: usuário optou por tratar múltiplos PDFs como capa + miolo. */
  tratarComoCapaMiolo?: boolean;
}

function nameHintsCapa(name: string): boolean {
  return name.toLowerCase().includes("capa");
}

function nameHintsMiolo(name: string): boolean {
  return name.toLowerCase().includes("miolo");
}

/** Pasta da versão indica um único componente (ex.: «Original V3 - Capa»). */
export function versionFolderIsSingleComponent(
  versionLabel: string | undefined,
): AnaliseComponente | null {
  const lower = (versionLabel ?? "").toLowerCase();
  const hasCapa = lower.includes("capa");
  const hasMiolo = lower.includes("miolo");
  if (hasCapa && !hasMiolo) return "Capa";
  if (hasMiolo && !hasCapa) return "Miolo";
  return null;
}

/** Livro ou produto com «c/ capa» no nome — exige capa e miolo na análise. */
export function produtoExigeCapaMiolo(produto: string | null | undefined): boolean {
  const p = (produto ?? "").trim();
  if (!p) return false;
  if (p.toLowerCase() === "livro") return true;
  return /c\/\s*capa/i.test(p);
}

function assignByPageCount(pages: number): "Capa" | "Miolo" {
  return pages > 4 ? "Miolo" : "Capa";
}

function absentSlot(componente: "Capa" | "Miolo"): VersionPdfFile {
  return {
    name: "(ausente)",
    path: "",
    pages: 0,
    componente,
    ausente: true,
  };
}

/** Comportamento anterior para produtos sem capa+miolo. */
function classifyVersionPdfFilesDefault(
  pdfs: { name: string; path: string; pages: number }[],
  versionLabel?: string,
): VersionPdfFile[] {
  if (pdfs.length === 0) return [];
  if (pdfs.length === 1) {
    const fromFolder = versionFolderIsSingleComponent(versionLabel);
    return [{ ...pdfs[0], componente: fromFolder ?? "Arq. Único" }];
  }

  const byComponent = new Map<AnaliseComponente, VersionPdfFile>();
  const unassigned: typeof pdfs = [];

  for (const file of pdfs) {
    const capa = nameHintsCapa(file.name);
    const miolo = nameHintsMiolo(file.name);
    if (capa && !miolo) {
      byComponent.set("Capa", { ...file, componente: "Capa" });
    } else if (miolo && !capa) {
      byComponent.set("Miolo", { ...file, componente: "Miolo" });
    } else {
      unassigned.push(file);
    }
  }

  if (unassigned.length === 1) {
    const file = unassigned[0];
    if (!byComponent.has("Capa")) {
      byComponent.set("Capa", { ...file, componente: "Capa" });
    } else if (!byComponent.has("Miolo")) {
      byComponent.set("Miolo", { ...file, componente: "Miolo" });
    } else {
      byComponent.set("Arq. Único", { ...file, componente: "Arq. Único" });
    }
  } else if (unassigned.length >= 2) {
    const result: VersionPdfFile[] = [...byComponent.values()];
    for (const file of unassigned) {
      result.push({ ...file, componente: "Arq. Único" });
    }
    return result.sort((a, b) => {
      const order: AnaliseComponente[] = ["Capa", "Miolo", "Arq. Único"];
      const cmp = order.indexOf(a.componente) - order.indexOf(b.componente);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name, "pt-BR");
    });
  }

  return [...byComponent.values()].sort((a, b) => {
    const order: AnaliseComponente[] = ["Capa", "Miolo", "Arq. Único"];
    return order.indexOf(a.componente) - order.indexOf(b.componente);
  });
}

function classifyCapaMioloProduct(
  pdfs: { name: string; path: string; pages: number }[],
): VersionPdfFile[] {
  const slots: Partial<Record<"Capa" | "Miolo", VersionPdfFile>> = {};
  const unassigned: typeof pdfs = [];

  for (const file of pdfs) {
    const capa = nameHintsCapa(file.name);
    const miolo = nameHintsMiolo(file.name);
    if (capa && !miolo && !slots.Capa) {
      slots.Capa = { ...file, componente: "Capa" };
    } else if (miolo && !capa && !slots.Miolo) {
      slots.Miolo = { ...file, componente: "Miolo" };
    } else {
      unassigned.push(file);
    }
  }

  for (const file of unassigned) {
    const comp = assignByPageCount(file.pages);
    if (comp === "Capa" && !slots.Capa) {
      slots.Capa = { ...file, componente: "Capa" };
    } else if (comp === "Miolo" && !slots.Miolo) {
      slots.Miolo = { ...file, componente: "Miolo" };
    } else if (!slots.Capa) {
      slots.Capa = { ...file, componente: "Capa" };
    } else if (!slots.Miolo) {
      slots.Miolo = { ...file, componente: "Miolo" };
    }
  }

  const result: VersionPdfFile[] = [];
  for (const comp of ["Capa", "Miolo"] as const) {
    result.push(slots[comp] ?? absentSlot(comp));
  }
  return result;
}

/**
 * Classifica PDFs da pasta da versão.
 * Produtos com capa: sempre Capa + Miolo (ausente se faltar arquivo), exceto pasta só Capa/Miolo.
 */
export function classifyVersionPdfFiles(
  files: { name: string; path: string; pages: number }[],
  options?: ClassifyVersionPdfOptions | string,
): VersionPdfFile[] {
  const opts: ClassifyVersionPdfOptions =
    typeof options === "string" ? { versionLabel: options } : (options ?? {});
  const { versionLabel, produto, tratarComoCapaMiolo } = opts;

  const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  const singleFolder = versionFolderIsSingleComponent(versionLabel);

  if (pdfs.length === 0) {
    if (!singleFolder && produtoExigeCapaMiolo(produto)) {
      return [absentSlot("Capa"), absentSlot("Miolo")];
    }
    return [];
  }
  if (singleFolder) {
    if (pdfs.length === 1) {
      return [{ ...pdfs[0], componente: singleFolder }];
    }
    return pdfs.map((file) => {
      let comp: AnaliseComponente = singleFolder;
      if (singleFolder === "Capa" && nameHintsMiolo(file.name)) comp = "Miolo";
      if (singleFolder === "Miolo" && nameHintsCapa(file.name) && !nameHintsMiolo(file.name)) {
        comp = "Capa";
      }
      return { ...file, componente: comp };
    });
  }

  if (!produtoExigeCapaMiolo(produto)) {
    if (pdfs.length > 1 && tratarComoCapaMiolo) {
      return classifyCapaMioloProduct(pdfs);
    }
    return classifyVersionPdfFilesDefault(pdfs, versionLabel);
  }

  return classifyCapaMioloProduct(pdfs);
}

/** Pasta com 2+ PDFs em produto que não exige capa — pedir confirmação ao usuário. */
export function versionNeedsCapaMioloPrompt(
  files: { name: string }[],
  options?: Pick<ClassifyVersionPdfOptions, "produto" | "versionLabel" | "tratarComoCapaMiolo">,
): boolean {
  const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length <= 1) return false;
  if (produtoExigeCapaMiolo(options?.produto)) return false;
  if (versionFolderIsSingleComponent(options?.versionLabel) != null) return false;
  return options?.tratarComoCapaMiolo === undefined;
}

export function versionPdfFilesByComponente(
  classified: VersionPdfFile[],
): Partial<Record<AnaliseComponente, VersionPdfFile[]>> {
  const map: Partial<Record<AnaliseComponente, VersionPdfFile[]>> = {};
  for (const entry of classified) {
    (map[entry.componente] ??= []).push(entry);
  }
  return map;
}

export function versionPdfFileByComponente(
  classified: VersionPdfFile[],
): Partial<Record<AnaliseComponente, VersionPdfFile>> {
  const grouped = versionPdfFilesByComponente(classified);
  const map: Partial<Record<AnaliseComponente, VersionPdfFile>> = {};
  for (const [comp, files] of Object.entries(grouped) as [AnaliseComponente, VersionPdfFile[]][]) {
    if (files[0]) map[comp] = files[0];
  }
  return map;
}

/** Versão deve exibir sempre Capa e Miolo na árvore (slots de arquivo). */
export function versionRequiresCapaMioloSlots(
  produto: string | null | undefined,
  versionLabel?: string,
): boolean {
  return produtoExigeCapaMiolo(produto) && versionFolderIsSingleComponent(versionLabel) == null;
}
