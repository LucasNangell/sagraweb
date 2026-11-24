import { describe, expect, it } from "vitest";

import {
  isHistorySelectionAdditive,
  nextHistorySelectionKeys,
  nextHistorySelectionRows,
  sortHistoryRowsNewestFirst,
} from "./osHistoryMultiselect";

describe("nextHistorySelectionKeys", () => {
  it("substitui a seleção sem modificador", () => {
    expect(nextHistorySelectionKeys(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("adiciona a linha com Ctrl quando ainda não estava marcada", () => {
    expect(nextHistorySelectionKeys(["a"], "b", true)).toEqual(["a", "b"]);
  });

  it("remove a linha com Ctrl quando já estava marcada", () => {
    expect(nextHistorySelectionKeys(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("pode deixar a seleção vazia ao desmarcar a única linha com Ctrl", () => {
    expect(nextHistorySelectionKeys(["a"], "a", true)).toEqual([]);
  });
});

describe("nextHistorySelectionRows", () => {
  const getKey = (row: { id: string }) => row.id;

  it("substitui as linhas sem modificador", () => {
    expect(
      nextHistorySelectionRows([{ id: "a" }], { id: "b" }, getKey, false),
    ).toEqual([{ id: "b" }]);
  });

  it("adiciona ou remove com Ctrl", () => {
    expect(
      nextHistorySelectionRows([{ id: "a" }], { id: "b" }, getKey, true),
    ).toEqual([{ id: "a" }, { id: "b" }]);
    expect(
      nextHistorySelectionRows(
        [{ id: "a" }, { id: "b" }],
        { id: "a" },
        getKey,
        true,
      ),
    ).toEqual([{ id: "b" }]);
  });
});

describe("sortHistoryRowsNewestFirst", () => {
  it("ordena pela posição na lista (mais novo = último)", () => {
    const all = [{ id: "old" }, { id: "mid" }, { id: "new" }];
    expect(
      sortHistoryRowsNewestFirst(
        [{ id: "old" }, { id: "new" }, { id: "mid" }],
        all,
        (row) => row.id,
      ),
    ).toEqual([{ id: "new" }, { id: "mid" }, { id: "old" }]);
  });
});

describe("isHistorySelectionAdditive", () => {
  it("é aditivo com Ctrl ou Meta", () => {
    expect(isHistorySelectionAdditive({ ctrlKey: true, metaKey: false })).toBe(
      true,
    );
    expect(isHistorySelectionAdditive({ ctrlKey: false, metaKey: true })).toBe(
      true,
    );
    expect(isHistorySelectionAdditive({ ctrlKey: false, metaKey: false })).toBe(
      false,
    );
  });
});
