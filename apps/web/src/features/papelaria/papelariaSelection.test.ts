import { afterEach, describe, expect, it } from "vitest";

import {
  osRowFromPapelariaSession,
  sameOsRow,
} from "./papelariaSelection";
import { PAPELARIA_SESSION_KEYS } from "./papelariaSession";

describe("papelariaSelection", () => {
  afterEach(() => {
    sessionStorage.removeItem(PAPELARIA_SESSION_KEYS.osId);
    sessionStorage.removeItem(PAPELARIA_SESSION_KEYS.osAno);
    sessionStorage.removeItem(PAPELARIA_SESSION_KEYS.targetProduct);
  });

  it("monta stub de OS a partir do sessionStorage", () => {
    sessionStorage.setItem(PAPELARIA_SESSION_KEYS.osId, "5123");
    sessionStorage.setItem(PAPELARIA_SESSION_KEYS.osAno, "2026");
    sessionStorage.setItem(PAPELARIA_SESSION_KEYS.targetProduct, "Ct Visita");

    expect(osRowFromPapelariaSession()).toEqual({
      nr_os: 5123,
      ano: 2026,
      produto: "Ct Visita",
    });
  });

  it("retorna null sem OS na sessão", () => {
    expect(osRowFromPapelariaSession()).toBeNull();
  });

  it("compara Nr/Ano da seleção", () => {
    expect(
      sameOsRow({ nr_os: 1, ano: 2026 }, { nr_os: 1, ano: 2026 }),
    ).toBe(true);
    expect(
      sameOsRow({ nr_os: 1, ano: 2026 }, { nr_os: 2, ano: 2026 }),
    ).toBe(false);
    expect(sameOsRow(null, { nr_os: 1, ano: 2026 })).toBe(false);
  });
});
