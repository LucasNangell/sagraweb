import { useEffect, useMemo, useRef, useState } from "react";

import {
  emptyCropSides,
  type CoverLayout,
  type CoverRole,
  type CoverSheetMapping,
  type CropSidesMm,
  type ProvaWebCapaCrop,
} from "@/api/provaWeb";
import { ProvaWebCropPanel } from "./ProvaWebCropPanel";
import {
  centeredCropMm,
  coverSpreadTargetMm,
  hasAutoDetectedCrop,
  isAutoFillableCrop,
  resolveSeedCrop,
} from "./provaWebCenteredCrop";
import { useProvaWebCropMeta } from "./useProvaWebCropMeta";

const FACE_LABELS: Record<CoverRole, string> = {
  "cover-front": "Capa 1 (frente)",
  "cover-front-inside": "Capa 2 (verso da frente)",
  "cover-back-inside": "Capa 3 (verso do fundo)",
  "cover-back": "Capa 4 (fundo)",
};

const ALL_ROLES: CoverRole[] = [
  "cover-front",
  "cover-front-inside",
  "cover-back-inside",
  "cover-back",
];

const DEFAULT_SPREAD_SHEETS: CoverSheetMapping[] = [
  {
    pageIndex: 0,
    leftRole: "cover-back",
    rightRole: "cover-front",
  },
  {
    pageIndex: 1,
    leftRole: "cover-front-inside",
    rightRole: "cover-back-inside",
  },
];

function defaultPagesSheets(pageCount: number): CoverSheetMapping[] {
  const roles = ALL_ROLES.slice(0, Math.min(4, Math.max(1, pageCount)));
  return roles.map((role, i) => ({
    pageIndex: i,
    leftRole: role,
    rightRole: role,
  }));
}

export interface ProvaWebCoverWizardProps {
  ano: number;
  osId: number;
  capaPath: string;
  mioloPath: string | null;
  mioloCrop: CropSidesMm | null;
  value: ProvaWebCapaCrop;
  onChange: (next: ProvaWebCapaCrop) => void;
  formatoLabel?: string | null;
  formatoLarguraMm?: number | null;
  formatoAlturaMm?: number | null;
}

export function ProvaWebCoverWizard({
  ano,
  osId,
  capaPath,
  mioloPath,
  mioloCrop,
  value,
  onChange,
  formatoLabel = null,
  formatoLarguraMm = null,
  formatoAlturaMm = null,
}: ProvaWebCoverWizardProps) {
  const [assignRole, setAssignRole] = useState<CoverRole>("cover-front");
  const seededMetaRef = useRef(false);

  const capaMeta = useProvaWebCropMeta(ano, osId, capaPath);
  const mioloMeta = useProvaWebCropMeta(ano, osId, mioloPath);

  const mediaW = capaMeta.data?.widthMm ?? capaMeta.data?.pages[0]?.widthMm ?? 0;
  const mediaH =
    capaMeta.data?.heightMm ?? capaMeta.data?.pages[0]?.heightMm ?? 0;

  const faceW =
    formatoLarguraMm ??
    (mioloCrop && mioloMeta.data?.widthMm
      ? Math.max(
          0,
          (mioloMeta.data.widthMm ?? 0) - mioloCrop.left - mioloCrop.right,
        )
      : null);
  const faceH =
    formatoAlturaMm ??
    (mioloCrop && mioloMeta.data?.heightMm
      ? Math.max(
          0,
          (mioloMeta.data.heightMm ?? 0) - mioloCrop.top - mioloCrop.bottom,
        )
      : null);

  const spreadTarget = useMemo(() => {
    if (!faceW || !faceH) return null;
    if (value.layout !== "spread") {
      return { w: faceW, h: faceH };
    }
    return coverSpreadTargetMm({
      faceWidthMm: faceW,
      faceHeightMm: faceH,
      lombadaMm: value.lombadaMm,
      orelhaEsquerdaMm: value.orelhaEsquerdaMm ?? 0,
      orelhaDireitaMm: value.orelhaDireitaMm ?? 0,
    });
  }, [
    faceW,
    faceH,
    value.layout,
    value.lombadaMm,
    value.orelhaEsquerdaMm,
    value.orelhaDireitaMm,
  ]);

  const suggestedLayout: CoverLayout = useMemo(() => {
    if (capaMeta.data?.likelySpread) return "spread";
    const capaW = capaMeta.data?.widthMm ?? 0;
    const capaH = capaMeta.data?.heightMm ?? 0;
    let mioloW = mioloMeta.data?.widthMm ?? 0;
    if (mioloCrop && mioloW) {
      mioloW = Math.max(0, mioloW - mioloCrop.left - mioloCrop.right);
    }
    if (mioloW > 0 && capaW >= mioloW * 1.7) return "spread";
    if (capaW > 0 && capaH > 0 && capaW >= capaH * 1.55) return "spread";
    return "pages";
  }, [capaMeta.data, mioloMeta.data, mioloCrop]);

  // Seed inicial: Trim/Bleed ou formato (spread/pages) + layout.
  useEffect(() => {
    if (!capaMeta.data || seededMetaRef.current) return;
    seededMetaRef.current = true;
    const layout = value.layout || suggestedLayout;
    const target =
      layout === "spread" && faceW && faceH
        ? coverSpreadTargetMm({
            faceWidthMm: faceW,
            faceHeightMm: faceH,
            lombadaMm: value.lombadaMm,
            orelhaEsquerdaMm: value.orelhaEsquerdaMm ?? 0,
            orelhaDireitaMm: value.orelhaDireitaMm ?? 0,
          })
        : faceW && faceH
          ? { w: faceW, h: faceH }
          : null;
    const crop = resolveSeedCrop({
      suggested: capaMeta.data.suggestedCrop,
      suggestionSource: capaMeta.data.suggestionSource,
      mediaW: capaMeta.data.widthMm ?? 0,
      mediaH: capaMeta.data.heightMm ?? 0,
      targetW: target?.w,
      targetH: target?.h,
    });
    onChange({
      ...value,
      layout,
      crop,
      sheets:
        layout === "spread"
          ? DEFAULT_SPREAD_SHEETS
          : defaultPagesSheets(capaMeta.data.pageCount),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
  }, [capaMeta.data, suggestedLayout, faceW, faceH]);

  // Recalc center-fill quando lombada/orelhas/layout mudam (só se crop ainda auto).
  useEffect(() => {
    if (!seededMetaRef.current || !mediaW || !mediaH || !spreadTarget) return;
    if (!isAutoFillableCrop(value.crop)) return;
    if (hasAutoDetectedCrop(value.crop)) return;
    const next = centeredCropMm(
      mediaW,
      mediaH,
      spreadTarget.w,
      spreadTarget.h,
      "formato",
    );
    if (!next) return;
    if (
      Math.abs(next.top - value.crop.top) < 0.05 &&
      Math.abs(next.right - value.crop.right) < 0.05 &&
      Math.abs(next.bottom - value.crop.bottom) < 0.05 &&
      Math.abs(next.left - value.crop.left) < 0.05
    ) {
      return;
    }
    onChange({ ...value, crop: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on guides/target
  }, [
    spreadTarget?.w,
    spreadTarget?.h,
    mediaW,
    mediaH,
    value.layout,
    value.lombadaMm,
    value.orelhaEsquerdaMm,
    value.orelhaDireitaMm,
  ]);

  const setLayout = (layout: CoverLayout) => {
    onChange({
      ...value,
      layout,
      sheets:
        layout === "spread"
          ? DEFAULT_SPREAD_SHEETS
          : defaultPagesSheets(capaMeta.data?.pageCount ?? 4),
      lombadaMm: layout === "spread" ? value.lombadaMm : 0,
      orelhaEsquerdaMm: layout === "spread" ? value.orelhaEsquerdaMm ?? 0 : 0,
      orelhaDireitaMm: layout === "spread" ? value.orelhaDireitaMm ?? 0 : 0,
    });
  };

  const assignFace = (pageIndex: number, side: "left" | "right") => {
    const sheets = value.sheets.map((s) => ({ ...s }));
    let sheet = sheets.find((s) => s.pageIndex === pageIndex);
    if (!sheet) {
      sheet = {
        pageIndex,
        leftRole: assignRole,
        rightRole: assignRole,
      };
      sheets.push(sheet);
    }
    if (value.layout === "pages") {
      sheet.leftRole = assignRole;
      sheet.rightRole = assignRole;
    } else if (side === "left") {
      sheet.leftRole = assignRole;
    } else {
      sheet.rightRole = assignRole;
    }
    onChange({ ...value, sheets: sheets.sort((a, b) => a.pageIndex - b.pageIndex) });
  };

  const faceSlots =
    value.layout === "spread"
      ? value.sheets.flatMap((s) => [
          {
            key: `${s.pageIndex}-L`,
            pageIndex: s.pageIndex,
            side: "left" as const,
            role: s.leftRole,
          },
          {
            key: `${s.pageIndex}-R`,
            pageIndex: s.pageIndex,
            side: "right" as const,
            role: s.rightRole,
          },
        ])
      : value.sheets.map((s) => ({
          key: `${s.pageIndex}`,
          pageIndex: s.pageIndex,
          side: "left" as const,
          role: s.leftRole,
        }));

  return (
    <div className="flex flex-col gap-5">
      <section className="space-y-3 rounded-xl border border-sagra-border bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-800">
          Capa — layout
        </h3>
        <p className="text-xs text-neutral-500">
          Sugestão:{" "}
          <strong>
            {suggestedLayout === "spread"
              ? "capa aberta (spread)"
              : "páginas soltas"}
          </strong>
          .
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <LayoutChoice
            active={value.layout === "spread"}
            title="Capa aberta"
            desc="Uma página larga com frente e fundo lado a lado."
            onClick={() => setLayout("spread")}
          />
          <LayoutChoice
            active={value.layout === "pages"}
            title="Páginas soltas"
            desc="Cada face (Capa 1–4) em uma página do PDF."
            onClick={() => setLayout("pages")}
          />
        </div>
      </section>

      {value.layout === "spread" && (
        <section className="space-y-3 rounded-xl border border-sagra-border bg-white p-4">
          <h3 className="text-sm font-semibold text-neutral-800">
            Capa — lombada e orelhas
          </h3>
          <p className="text-xs text-neutral-500">
            Incluídas no formato final da capa aberta (pré-preenchimento do
            crop). Use 0 se não houver.
          </p>
          <div className="grid max-w-xl gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-neutral-600">
                Orelha esq. (mm)
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={value.orelhaEsquerdaMm ?? 0}
                onChange={(e) =>
                  onChange({
                    ...value,
                    orelhaEsquerdaMm: Math.max(
                      0,
                      Math.round(Number(e.target.value) * 10) / 10,
                    ),
                  })
                }
                className="rounded-lg border border-sagra-border px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-neutral-600">Lombada (mm)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={value.lombadaMm}
                onChange={(e) =>
                  onChange({
                    ...value,
                    lombadaMm: Math.max(
                      0,
                      Math.round(Number(e.target.value) * 10) / 10,
                    ),
                  })
                }
                className="rounded-lg border border-sagra-border px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-neutral-600">
                Orelha dir. (mm)
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={value.orelhaDireitaMm ?? 0}
                onChange={(e) =>
                  onChange({
                    ...value,
                    orelhaDireitaMm: Math.max(
                      0,
                      Math.round(Number(e.target.value) * 10) / 10,
                    ),
                  })
                }
                className="rounded-lg border border-sagra-border px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
          </div>
          {spreadTarget && (
            <p className="text-[11px] text-neutral-500">
              Alvo da capa aberta: {spreadTarget.w.toFixed(1)} ×{" "}
              {spreadTarget.h.toFixed(1)} mm
            </p>
          )}
          <LombadaPreview
            lombadaMm={value.lombadaMm}
            orelhaEsquerdaMm={value.orelhaEsquerdaMm ?? 0}
            orelhaDireitaMm={value.orelhaDireitaMm ?? 0}
          />
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-sagra-border bg-white p-4">
        <h3 className="text-sm font-semibold text-neutral-800">
          Capa — faces (Capa 1–4)
        </h3>
        <p className="text-xs text-neutral-500">
          Selecione a face e clique na região para atribuir. Padrão: pág. 1 =
          [Capa4 | Capa1], pág. 2 = [Capa2 | Capa3].
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setAssignRole(role)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                assignRole === role
                  ? "border-primary-green bg-primary-green/10 text-green-800"
                  : "border-sagra-border text-neutral-600"
              }`}
            >
              {FACE_LABELS[role]}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {faceSlots.map((slot) => (
            <button
              key={slot.key}
              type="button"
              onClick={() => assignFace(slot.pageIndex, slot.side)}
              className="rounded-xl border border-sagra-border bg-slate-50 px-3 py-3 text-left hover:border-primary-green/50"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Pág. {slot.pageIndex + 1}
                {value.layout === "spread"
                  ? slot.side === "left"
                    ? " · esquerda"
                    : " · direita"
                  : ""}
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-800">
                {FACE_LABELS[slot.role]}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-800">
          Capa — crop e preview
        </h3>
        <ProvaWebCropPanel
          ano={ano}
          osId={osId}
          relativePath={capaPath}
          title="Crop das faces (bordas externas, mm)"
          crop={value.crop}
          onChange={(crop) => onChange({ ...value, crop })}
          showPageSelector
          autoSeedCrop={false}
          formatoLabel={formatoLabel}
          formatoLarguraMm={formatoLarguraMm}
          formatoAlturaMm={formatoAlturaMm}
          seedTargetWidthMm={spreadTarget?.w ?? null}
          seedTargetHeightMm={spreadTarget?.h ?? null}
          coverGuides={
            value.layout === "spread"
              ? {
                  lombadaMm: value.lombadaMm,
                  orelhaEsquerdaMm: value.orelhaEsquerdaMm ?? 0,
                  orelhaDireitaMm: value.orelhaDireitaMm ?? 0,
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}

export function defaultCapaCrop(layout: CoverLayout = "pages"): ProvaWebCapaCrop {
  return {
    layout,
    lombadaMm: 0,
    orelhaEsquerdaMm: 0,
    orelhaDireitaMm: 0,
    crop: emptyCropSides("manual"),
    sheets:
      layout === "spread" ? DEFAULT_SPREAD_SHEETS : defaultPagesSheets(4),
  };
}

function LayoutChoice({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active
          ? "border-primary-green bg-primary-green/5 ring-1 ring-primary-green/30"
          : "border-sagra-border hover:bg-slate-50"
      }`}
    >
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{desc}</p>
    </button>
  );
}

function LombadaPreview({
  lombadaMm,
  orelhaEsquerdaMm = 0,
  orelhaDireitaMm = 0,
}: {
  lombadaMm: number;
  orelhaEsquerdaMm?: number;
  orelhaDireitaMm?: number;
}) {
  const spinePct = Math.min(40, Math.max(0, lombadaMm * 1.5));
  const earL = Math.min(48, Math.max(0, orelhaEsquerdaMm * 1.4));
  const earR = Math.min(48, Math.max(0, orelhaDireitaMm * 1.4));
  return (
    <div className="relative mx-auto h-36 max-w-md overflow-hidden rounded-lg border border-sagra-border bg-slate-200">
      {earL > 0 && (
        <div
          className="absolute inset-y-3 left-1 z-[1] rounded bg-sky-400/50"
          style={{ width: `${Math.max(4, earL)}px` }}
          title={`Orelha esq. ${orelhaEsquerdaMm} mm`}
        />
      )}
      {earR > 0 && (
        <div
          className="absolute inset-y-3 right-1 z-[1] rounded bg-sky-400/50"
          style={{ width: `${Math.max(4, earR)}px` }}
          title={`Orelha dir. ${orelhaDireitaMm} mm`}
        />
      )}
      <div className="absolute inset-y-2 left-2 right-1/2 mr-0.5 flex items-center justify-center rounded bg-white text-xs font-medium text-neutral-500">
        Capa 4
      </div>
      <div className="absolute inset-y-2 left-1/2 right-2 ml-0.5 flex items-center justify-center rounded bg-white text-xs font-medium text-neutral-500">
        Capa 1
      </div>
      <div
        className="absolute inset-y-0 left-1/2 z-10 -translate-x-1/2 bg-amber-400/70"
        style={{ width: `${Math.max(2, spinePct)}px` }}
        title={`Lombada ${lombadaMm} mm`}
      />
    </div>
  );
}
