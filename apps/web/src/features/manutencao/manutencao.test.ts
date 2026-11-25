import { describe, expect, it } from "vitest";

import type { ManutencaoPedido } from "@/api/manutencao";
import { canAccessRoute, getVisibleNavItems } from "@/components/layout/nav-config";
import { PERMISSION_CATALOG } from "@/features/acesso/permissionCatalog";
import { parsePermissionsFromApi } from "@/features/auth/permissions";

type PermsInput = Parameters<typeof parsePermissionsFromApi>[0];

import {
  agruparPedidos,
  formatData,
  formatDuracao,
  moverItem,
  normalizarBusca,
  tempoRelativo,
} from "./manutencaoUi";
import { ordenarMaquinas } from "./useManutencaoData";

describe("Manutenção — acesso", () => {
  it("esconde sem nenhuma das permissões", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true } as PermsInput);
    expect(getVisibleNavItems(perms, true).some((i) => i.to === "/manutencao")).toBe(false);
    expect(canAccessRoute(perms, "/manutencao")).toBe(false);
  });

  it.each(["sb_manutencao_gerencia", "sb_manutencao_operador"])(
    "mostra com %s isolada",
    (key) => {
      const perms = parsePermissionsFromApi({ sb_inicio: true, [key]: true } as unknown as PermsInput);
      expect(getVisibleNavItems(perms, true).some((i) => i.to === "/manutencao")).toBe(true);
      expect(canAccessRoute(perms, "/manutencao")).toBe(true);
    },
  );

  it("as duas abas têm permissões independentes no catálogo do admin", () => {
    const keys = PERMISSION_CATALOG.filter((e) => e.category === "manutencao").map((e) => e.key);
    expect(keys).toEqual(["sb_manutencao_gerencia", "sb_manutencao_operador"]);
  });
});

function pedido(partial: Partial<ManutencaoPedido>): ManutencaoPedido {
  return {
    id: 1,
    maquina_id: 1,
    titulo: "x",
    prioridade: "normal",
    status: "fila",
    maquina_parada: false,
    solucao_passos: [],
    ...partial,
  };
}

describe("Manutenção — utilitários", () => {
  it("formata durações", () => {
    expect(formatDuracao(null)).toBe("—");
    expect(formatDuracao(42)).toBe("42 min");
    expect(formatDuracao(60)).toBe("1 h");
    expect(formatDuracao(190)).toBe("3 h 10 min");
    expect(formatDuracao(60 * 24 * 2 + 60 * 4)).toBe("2 d 4 h");
  });

  it("tempo relativo", () => {
    const now = new Date("2026-11-25T12:00:00");
    expect(tempoRelativo("2026-11-25T11:59:40", now)).toBe("agora");
    expect(tempoRelativo("2026-11-25T11:30:00", now)).toBe("há 30 min");
    expect(tempoRelativo(null, now)).toBe("—");
  });

  it("formata data pura sem fuso", () => {
    expect(formatData("2026-01-05")).toBe("05/01/2026");
  });

  it("move itens sem mutar", () => {
    const base = [1, 2, 3, 4];
    expect(moverItem(base, 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moverItem(base, 0, 10)).toEqual([2, 3, 4, 1]);
    expect(base).toEqual([1, 2, 3, 4]);
  });

  it("agrupa pedidos por coluna e ordena a fila pela posição", () => {
    const { fila, execucao, finalizados } = agruparPedidos([
      pedido({ id: 1, status: "fila", posicao_fila: 2 }),
      pedido({ id: 2, status: "fila", posicao_fila: 1 }),
      pedido({ id: 3, status: "pausado", iniciado_em: "2026-11-25T10:00:00" }),
      pedido({ id: 4, status: "em_execucao", iniciado_em: "2026-11-25T09:00:00" }),
      pedido({ id: 5, status: "concluido", concluido_em: "2026-11-20T10:00:00" }),
      pedido({ id: 6, status: "cancelado", cancelado_em: "2026-11-24T10:00:00" }),
    ]);
    expect(fila.map((p) => p.id)).toEqual([2, 1]);
    expect(execucao.map((p) => p.id)).toEqual([4, 3]);
    expect(finalizados.map((p) => p.id)).toEqual([6, 5]);
  });

  it("normaliza busca sem acentos", () => {
    expect(normalizarBusca("  Encadernação ")).toBe("encadernacao");
  });

  it("ordena máquinas em ordem alfabética", () => {
    const nomes = ordenarMaquinas([
      { nome: "Speed Master 74", codigo: "MAQ-0006" },
      { nome: "alceadeira AM Graphics", codigo: "MAQ-0009" },
      { nome: "Capeadeira Capa Dura", codigo: "MAQ-0017" },
      { nome: "Capeadeira", codigo: "MAQ-0008" },
      { nome: "Encadernadora Perfuramax 50", codigo: "MAQ-0018" },
      { nome: "Encadernadora Perfuramax", codigo: "MAQ-0019" },
    ]).map((m) => m.nome);
    expect(nomes).toEqual([
      "alceadeira AM Graphics",
      "Capeadeira",
      "Capeadeira Capa Dura",
      "Encadernadora Perfuramax",
      "Encadernadora Perfuramax 50",
      "Speed Master 74",
    ]);
  });
});

describe("detectarPushEstado", () => {
  it("pede para ativar quando a permissão ainda não foi dada", async () => {
    const { detectarPushEstado } = await import("./components/ManutencaoNotificacoesCard");
    const original = window.Notification;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default" },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    const nav = navigator as Navigator & { serviceWorker?: unknown };
    const hadSw = "serviceWorker" in navigator;
    if (!hadSw) {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { getRegistration: async () => undefined },
      });
    }
    try {
      expect(await detectarPushEstado()).toBe("desativado");
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: { permission: "denied" },
      });
      expect(await detectarPushEstado()).toBe("bloqueado");
    } finally {
      Object.defineProperty(window, "Notification", { configurable: true, value: original });
      if (!hadSw) delete (nav as { serviceWorker?: unknown }).serviceWorker;
    }
  });
});
