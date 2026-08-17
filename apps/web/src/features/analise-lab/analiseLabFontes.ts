import type {
  AnaliseLabComponente,
  AnaliseLabCropScope,
  AnaliseLabFonte,
} from "@/api/analiseLab";
import {
  emptyCropSides,
  type CropSidesMm,
  type ProvaWebCropJson,
} from "@/api/provaWeb";
import { defaultCapaCrop } from "@/features/prova-web/ProvaWebCoverWizard";

export function normalizeRelPath(path: string): string {
  return (path || "").trim().replace(/\\/g, "/");
}

export function pageCropKey(path: string, sourcePage: number): string {
  return `${normalizeRelPath(path)}#${sourcePage}`;
}

export function identityLabCropJson(
  modo: "unico" | "capa_miolo",
): ProvaWebCropJson {
  const zero = emptyCropSides("manual");
  const lab = { all: null, files: {}, pages: {}, mioloCentral: false };
  if (modo === "capa_miolo") {
    return {
      miolo: zero,
      capa: defaultCapaCrop("pages"),
      lab,
    };
  }
  return { unico: zero, lab };
}

export function deriveLegacyPaths(
  fontes: AnaliseLabFonte[],
  modo: "unico" | "capa_miolo",
): {
  arquivo_unico: string | null;
  arquivo_capa: string | null;
  arquivo_miolo: string | null;
} {
  const first = (comp: AnaliseLabComponente) =>
    fontes.find((f) => f.componente === comp)?.path ?? null;
  if (modo === "capa_miolo") {
    return {
      arquivo_unico: null,
      arquivo_capa: first("Capa"),
      arquivo_miolo: first("Miolo"),
    };
  }
  return {
    arquivo_unico: first("Arq. Único"),
    arquivo_capa: null,
    arquivo_miolo: null,
  };
}

function nameHintsCapa(name: string): boolean {
  return name.toLowerCase().includes("capa");
}

function nameHintsMiolo(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("miolo") ||
    lower.includes("texto") ||
    lower.includes("conteudo") ||
    lower.includes("conteúdo")
  );
}

export function seedLabFontes(
  files: { path: string; name: string }[],
  modo: "unico" | "capa_miolo",
): AnaliseLabFonte[] {
  if (!files.length) return [];
  if (modo === "unico") {
    return [{ path: files[0].path, componente: "Arq. Único", ordem: 0 }];
  }

  const fontes: AnaliseLabFonte[] = [];
  let capaOrdem = 0;
  let mioloOrdem = 0;
  for (const file of files) {
    const capa = nameHintsCapa(file.name);
    const miolo = nameHintsMiolo(file.name);
    if (capa && !miolo) {
      fontes.push({ path: file.path, componente: "Capa", ordem: capaOrdem++ });
    } else if (miolo && !capa) {
      fontes.push({ path: file.path, componente: "Miolo", ordem: mioloOrdem++ });
    }
  }

  const used = new Set(fontes.map((f) => f.path));
  if (!fontes.some((f) => f.componente === "Capa") && files[0]) {
    fontes.push({ path: files[0].path, componente: "Capa", ordem: 0 });
    used.add(files[0].path);
    capaOrdem = 1;
  }
  if (!fontes.some((f) => f.componente === "Miolo")) {
    const rest = files.filter((f) => !used.has(f.path));
    rest.forEach((file, index) => {
      fontes.push({ path: file.path, componente: "Miolo", ordem: index });
    });
  }
  return fontes;
}

export function fontesForComponent(
  fontes: AnaliseLabFonte[],
  componente: AnaliseLabComponente,
): AnaliseLabFonte[] {
  return fontes
    .filter((f) => f.componente === componente)
    .slice()
    .sort((a, b) => a.ordem - b.ordem || a.path.localeCompare(b.path, "pt-BR"));
}

export function canGenerateLabFontes(
  fontes: AnaliseLabFonte[],
  modo: "unico" | "capa_miolo",
): boolean {
  if (modo === "unico") {
    return fontesForComponent(fontes, "Arq. Único").length >= 1;
  }
  return (
    fontesForComponent(fontes, "Capa").length >= 1 &&
    fontesForComponent(fontes, "Miolo").length >= 1
  );
}

export function moveFonte(
  fontes: AnaliseLabFonte[],
  path: string,
  direction: -1 | 1,
): AnaliseLabFonte[] {
  const target = fontes.find((f) => f.path === path);
  if (!target) return fontes;
  const slot = fontesForComponent(fontes, target.componente);
  const index = slot.findIndex((f) => f.path === path);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= slot.length) return fontes;
  const swapped = slot.slice();
  const [item] = swapped.splice(index, 1);
  swapped.splice(nextIndex, 0, item);
  const others = fontes.filter((f) => f.componente !== target.componente);
  return [
    ...others,
    ...swapped.map((f, ordem) => ({ ...f, ordem })),
  ];
}

export function assignFonte(
  fontes: AnaliseLabFonte[],
  path: string,
  componente: AnaliseLabComponente | null,
): AnaliseLabFonte[] {
  const without = fontes.filter((f) => f.path !== path);
  if (!componente) return reindexFontes(without);
  const slotLen = fontesForComponent(without, componente).length;
  return reindexFontes([
    ...without,
    { path, componente, ordem: slotLen },
  ]);
}

function reindexFontes(fontes: AnaliseLabFonte[]): AnaliseLabFonte[] {
  const byComp: Record<string, number> = {};
  return fontes
    .slice()
    .sort(
      (a, b) =>
        a.componente.localeCompare(b.componente) ||
        a.ordem - b.ordem ||
        a.path.localeCompare(b.path, "pt-BR"),
    )
    .map((fonte) => {
      const ordem = byComp[fonte.componente] ?? 0;
      byComp[fonte.componente] = ordem + 1;
      return { ...fonte, ordem };
    });
}

export function swapCropLeftRight(crop: CropSidesMm): CropSidesMm {
  return { ...crop, left: crop.right, right: crop.left };
}

export function resolveLabPageCrop(
  cropJson: ProvaWebCropJson | null | undefined,
  args: {
    path: string;
    sourcePage: number;
    componente: AnaliseLabComponente | string;
    sequencePage?: number | null;
  },
): CropSidesMm {
  const lab = cropJson?.lab;
  const pageKey = pageCropKey(args.path, args.sourcePage);
  const pageCrop = lab?.pages?.[pageKey];
  if (pageCrop) return { ...emptyCropSides(), ...pageCrop };
  const fileCrop = lab?.files?.[normalizeRelPath(args.path)];
  let crop: CropSidesMm | null = fileCrop
    ? { ...emptyCropSides(), ...fileCrop }
    : null;
  if (!crop && args.componente === "Capa" && cropJson?.capa?.crop) {
    crop = { ...emptyCropSides(), ...cropJson.capa.crop };
  }
  if (!crop && args.componente === "Miolo" && cropJson?.miolo) {
    crop = { ...emptyCropSides(), ...cropJson.miolo };
  }
  if (!crop && args.componente === "Arq. Único" && cropJson?.unico) {
    crop = { ...emptyCropSides(), ...cropJson.unico };
  }
  if (!crop && lab?.all) crop = { ...emptyCropSides(), ...lab.all };
  if (!crop) crop = emptyCropSides("manual");

  const seq = args.sequencePage ?? args.sourcePage;
  if (
    args.componente === "Miolo" &&
    lab?.mioloCentral &&
    seq >= 1 &&
    seq % 2 === 0
  ) {
    return swapCropLeftRight(crop);
  }
  return crop;
}

export const CROP_SCOPE_LABELS: Record<AnaliseLabCropScope, string> = {
  page: "Página atual",
  file: "Todas as páginas deste arquivo",
  component: "Todas as páginas deste componente",
  all: "Todas as páginas de todos os arquivos",
  miolo_central: "Miolo central (ímpar esq. / par dir.)",
};
