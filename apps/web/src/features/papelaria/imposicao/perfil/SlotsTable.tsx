import { cn } from "@sagra/ui";
import { Copy, Plus, Trash2 } from "lucide-react";

import {
  estimarPaginaPelaGrade,
  folhaMm,
  formatMm,
  problemasDeSlots,
  yUsuario,
  proximoSlotId,
  resolverSlots,
  ROTACOES,
} from "./perfilUtils";
import type { Face, PerfilImposicao, PerfilSlot, Rotacao } from "./types";

type Props = {
  perfil: PerfilImposicao;
  face: Face;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChange: (slots: PerfilSlot[]) => void;
};

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const cellInput =
  "w-full rounded border border-slate-300 px-1.5 py-1 text-xs tabular-nums text-slate-800 focus:border-secondary-blue focus:outline-none";

export function SlotsTable({ perfil, face, selectedId, onSelect, onChange }: Props) {
  const slots = perfil.slots[face];
  const manual = perfil.posicionamento === "manual";
  const estimate = perfil.pagina.fonte === "pdf" ? estimarPaginaPelaGrade(perfil) : null;
  const resolved = new Map(resolverSlots(perfil, face, estimate).map((s) => [s.id, s]));
  const problemas = problemasDeSlots(perfil, face, estimate);
  const folhaH = folhaMm(perfil)?.h ?? null;
  /** Y mostrado = a partir do canto inferior esquerdo da folha. */
  const yTela = (y: number) => (folhaH != null ? yUsuario(y, folhaH) : y);

  const patch = (id: number, next: Partial<PerfilSlot>) =>
    onChange(slots.map((s) => (s.id === id ? { ...s, ...next } : s)));

  const addSlot = () => {
    const id = proximoSlotId(slots);
    const last = slots[slots.length - 1];
    const base: PerfilSlot = { id, pagina: last?.pagina ?? 1, rotacao: last?.rotacao ?? 0 };
    if (manual) {
      // Novo slot nasce no centro da folha (X/Y = centro da página).
      const folha = folhaMm(perfil);
      onChange([
        ...slots,
        { ...base, x_mm: folha ? folha.w / 2 : 0, y_mm: folha ? folha.h / 2 : 0 },
      ]);
      onSelect(id);
      return;
    }
    const used = new Set(slots.map((s) => `${s.col},${s.row}`));
    for (let row = 0; row < perfil.grade.linhas; row += 1) {
      for (let col = 0; col < perfil.grade.colunas; col += 1) {
        if (!used.has(`${col},${row}`)) {
          onChange([...slots, { ...base, col, row }]);
          onSelect(id);
          return;
        }
      }
    }
    onChange([...slots, { ...base, col: 0, row: 0 }]);
    onSelect(id);
  };

  const duplicate = (slot: PerfilSlot) => {
    const id = proximoSlotId(slots);
    const copy: PerfilSlot = manual
      ? { ...slot, id, x_mm: (slot.x_mm ?? 0) + 5, y_mm: (slot.y_mm ?? 0) + 5 }
      : { ...slot, id };
    onChange([...slots, copy]);
    onSelect(id);
  };

  const remove = (id: number) => {
    onChange(slots.filter((s) => s.id !== id));
    if (selectedId === id) onSelect(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--xs" onClick={addSlot}>
          <Plus className="size-3" aria-hidden /> Slot
        </button>
        <button
          type="button"
          className="sagra-btn sagra-btn--outline sagra-btn--xs"
          disabled={!slots.length}
          onClick={() => onChange(slots.map((s) => ({ ...s, pagina: 1 })))}
          title="Step & repeat: a mesma página em todos os slots"
        >
          Todas = pág. 1
        </button>
        <button
          type="button"
          className="sagra-btn sagra-btn--outline sagra-btn--xs"
          disabled={!slots.length}
          onClick={() => onChange(slots.map((s, i) => ({ ...s, pagina: i + 1 })))}
          title="Cada slot recebe uma página diferente do PDF"
        >
          Sequência 1…N
        </button>
        <span className="ml-auto text-[10px] text-slate-500">
          {slots.length} slot{slots.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">Slot</th>
              <th className="px-2 py-1.5 text-left font-semibold">Pág. PDF</th>
              {manual ? (
                <>
                  <th className="px-2 py-1.5 text-left font-semibold" title="Centro da página, a partir da borda esquerda da folha">
                    X centro (mm)
                  </th>
                  <th className="px-2 py-1.5 text-left font-semibold" title="Centro da página, a partir da borda inferior da folha (Y para cima)">
                    Y centro (mm)
                  </th>
                </>
              ) : (
                <>
                  <th className="px-2 py-1.5 text-left font-semibold">Coluna</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Linha</th>
                </>
              )}
              <th className="px-2 py-1.5 text-left font-semibold">Rotação</th>
              <th className="px-2 py-1.5 text-left font-semibold">Estado</th>
              <th className="px-2 py-1.5" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                  Nenhum slot. Use “Gerar posições pela grade” ou adicione um slot.
                </td>
              </tr>
            ) : null}
            {slots.map((slot) => {
              const pos = resolved.get(slot.id);
              const prob = problemas.get(slot.id);
              return (
                <tr
                  key={slot.id}
                  className={cn(
                    "border-t border-slate-100",
                    selectedId === slot.id ? "bg-secondary-blue/5" : "hover:bg-slate-50",
                  )}
                  onClick={() => onSelect(slot.id)}
                >
                  <td className="px-2 py-1 font-semibold text-slate-700">{slot.id}</td>
                  <td className="w-20 px-2 py-1">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={cellInput}
                      value={slot.pagina}
                      aria-label={`Página do slot ${slot.id}`}
                      onChange={(e) => patch(slot.id, { pagina: Math.max(1, Math.floor(num(e.target.value) ?? 1)) })}
                    />
                  </td>
                  {manual ? (
                    <>
                      <td className="w-24 px-2 py-1">
                        <input
                          type="number"
                          step={0.1}
                          className={cellInput}
                          value={slot.x_mm ?? ""}
                          aria-label={`X do centro do slot ${slot.id}`}
                          onChange={(e) => patch(slot.id, { x_mm: num(e.target.value) })}
                        />
                      </td>
                      <td className="w-24 px-2 py-1">
                        <input
                          type="number"
                          step={0.1}
                          className={cellInput}
                          value={slot.y_mm == null ? "" : yTela(slot.y_mm)}
                          aria-label={`Y do centro do slot ${slot.id}`}
                          onChange={(e) => {
                            const v = num(e.target.value);
                            patch(slot.id, { y_mm: v == null ? undefined : yTela(v) });
                          }}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="w-20 px-2 py-1">
                        <input
                          type="number"
                          min={1}
                          max={perfil.grade.colunas}
                          className={cellInput}
                          value={slot.col != null ? slot.col + 1 : ""}
                          aria-label={`Coluna do slot ${slot.id}`}
                          onChange={(e) => {
                            const v = num(e.target.value);
                            patch(slot.id, { col: v == null ? undefined : Math.max(0, Math.floor(v) - 1) });
                          }}
                        />
                      </td>
                      <td className="w-20 px-2 py-1">
                        <input
                          type="number"
                          min={1}
                          max={perfil.grade.linhas}
                          className={cellInput}
                          value={slot.row != null ? slot.row + 1 : ""}
                          aria-label={`Linha do slot ${slot.id}`}
                          onChange={(e) => {
                            const v = num(e.target.value);
                            patch(slot.id, { row: v == null ? undefined : Math.max(0, Math.floor(v) - 1) });
                          }}
                        />
                      </td>
                    </>
                  )}
                  <td className="w-24 px-2 py-1">
                    <select
                      className={cellInput}
                      value={slot.rotacao}
                      aria-label={`Rotação do slot ${slot.id}`}
                      onChange={(e) => patch(slot.id, { rotacao: Number(e.target.value) as Rotacao })}
                    >
                      {ROTACOES.map((r) => (
                        <option key={r} value={r}>
                          {r}°
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1 text-[11px]">
                    {prob === "fora" ? (
                      <span className="font-semibold text-red-600">Fora da folha</span>
                    ) : prob === "sobrepoe" ? (
                      <span className="font-semibold text-amber-700">Sobrepõe</span>
                    ) : pos ? (
                      <span className="text-emerald-700" title={`Centro X ${formatMm(pos.cx_mm)} · Y ${formatMm(yTela(pos.cy_mm))} mm`}>
                        OK{!manual ? ` · centro ${formatMm(pos.cx_mm)}, ${formatMm(yTela(pos.cy_mm))}` : ""}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <button
                      type="button"
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicate(slot);
                      }}
                      aria-label={`Duplicar slot ${slot.id}`}
                      title="Duplicar"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(slot.id);
                      }}
                      aria-label={`Remover slot ${slot.id}`}
                      title="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
