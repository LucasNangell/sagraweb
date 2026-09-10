import { StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { inspectNetworkFiles, type NetworkFilePick, type NetworkInspectionOptions, type NetworkFilesInspectionResponse } from "@/api/networkFiles";
import { useNetworkFileInspections } from "./useNetworkFileInspections";

vi.mock("@/api/networkFiles", () => ({ inspectNetworkFiles: vi.fn() }));
const file = { absolute_path: "X:/one.tif", nome: "one.tif", maquina: "KOMORI" };
const response = (pick: NetworkFilePick = file): NetworkFilesInspectionResponse => ({ files: [{ ...pick,
  type: "tif", status: "done", blank_graphics: true, preview_mime: "image/png",
}] });
let pending: { files: NetworkFilePick[]; options: NetworkInspectionOptions; resolve: (r: NetworkFilesInspectionResponse) => void; reject: (e: Error) => void }[];
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  pending = [];
  vi.mocked(inspectNetworkFiles).mockReset().mockImplementation((files, options = {}) =>
    new Promise((resolve, reject) => pending.push({ files, options, resolve, reject })));
});

it("mostra resultado parcial antes de concluir e mantém progresso junto do alerta", async () => {
  const { result } = renderHook(() => useNetworkFileInspections([file, { ...file, absolute_path: "X:/two.tif" }], true), { wrapper });
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => pending[0]!.resolve(response()));
  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(result.current.total).toBe(2);
  expect(result.current.data?.files[0]?.blank_graphics).toBe(true);
  expect(result.current.isFetching).toBe(true);
});

it("cancela a seleção anterior e não deixa respostas antigas contaminarem outra máquina", async () => {
  const { result, rerender } = renderHook(({ pick }) => useNetworkFileInspections([pick], true), { wrapper, initialProps: { pick: file } });
  await waitFor(() => expect(pending).toHaveLength(1));
  rerender({ pick: { ...file, maquina: "SM74" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]!.options.signal?.aborted).toBe(true);
  act(() => pending[0]!.resolve(response()));
  expect(result.current.data).toBeUndefined();
  act(() => pending[1]!.resolve(response({ ...file, maquina: "SM74" })));
  await waitFor(() => expect(result.current.data?.files[0]?.maquina).toBe("SM74"));
});

it("cancela ao fechar e consegue retomar ao reabrir", async () => {
  const { result, rerender } = renderHook(({ open }) => useNetworkFileInspections([file], open), { wrapper, initialProps: { open: true } });
  await waitFor(() => expect(pending).toHaveLength(1));
  rerender({ open: false });
  await waitFor(() => expect(pending[0]!.options.signal?.aborted).toBe(true));
  rerender({ open: true });
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => pending[1]!.resolve(response()));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

it("mantém resultados parciais em falha de rede e repete apenas falhas", async () => {
  const second = { ...file, absolute_path: "X:/two.tif" };
  const { result } = renderHook(() => useNetworkFileInspections([file, second], true), { wrapper });
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => { pending[0]!.resolve(response()); pending[1]!.reject(new Error("offline")); });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data?.files).toHaveLength(1);
  act(() => { void result.current.refetch(); });
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(pending[2]!.files).toEqual([second]);
  act(() => pending[2]!.resolve(response(second)));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

it("aplica uma correção durante o lote sem reiniciar a fila nem aceitar o resultado antigo", async () => {
  const { result } = renderHook(() => useNetworkFileInspections([file, { ...file, absolute_path: "X:/two.tif" }], true), { wrapper });
  await waitFor(() => expect(pending).toHaveLength(2));
  const old = { ...response().files[0]!, inspection_token: "a".repeat(64), feedback_revision: 0 };
  act(() => pending[0]!.resolve({ files: [old] }));
  await waitFor(() => expect(result.current.completed).toBe(1));
  const corrected = { ...old, blank_graphics: false, feedback_revision: 1 };
  act(() => result.current.acceptCorrection(corrected));
  await waitFor(() => expect(result.current.data?.files[0]?.blank_graphics).toBe(false));
  expect(pending).toHaveLength(2);
  expect(pending[1]!.options.signal?.aborted).toBe(false);
  act(() => pending[1]!.resolve(response({ ...file, absolute_path: "X:/two.tif" })));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.files[0]?.blank_graphics).toBe(false);
});

it("remover outro item mantém resultado e correção já concluídos, mesmo após 60 segundos", async () => {
  const second = { ...file, absolute_path: "X:/two.tif" };
  vi.mocked(inspectNetworkFiles).mockImplementation(async picks => response(picks[0]!));
  const { result, rerender } = renderHook(({ picks }) => useNetworkFileInspections(picks, true), {
    wrapper, initialProps: { picks: [file, second] },
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const corrected = { ...response().files[0]!, blank_graphics: false, feedback_revision: 1 };
  act(() => result.current.acceptCorrection(corrected));
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  try {
    rerender({ picks: [file] });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.data?.files).toEqual([corrected]);
    expect(result.current.isFetching).toBe(false);
    expect(inspectNetworkFiles).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); }
});

it("excluir de um lote de 300 preserva os concluídos e as requisições ativas; adicionar verifica só o novo", async () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ ...file, absolute_path: `X:/${i}.tif` }));
  const { result, rerender } = renderHook(({ picks }) => useNetworkFileInspections(picks, true), {
    wrapper, initialProps: { picks: files },
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => pending[0]!.resolve(response(files[0]!)));
  await waitFor(() => expect(pending).toHaveLength(3));
  rerender({ picks: files.slice(1) });
  expect(pending).toHaveLength(3);
  expect(pending[1]!.options.signal?.aborted).toBe(false);
  expect(pending[2]!.options.signal?.aborted).toBe(false);
  // Retira também um item que ainda não foi enviado, sem tocar nos ativos.
  const retained = [files[1]!, files[2]!, ...files.slice(4)];
  rerender({ picks: retained });
  for (let i = 1; i < 299; i++) {
    await waitFor(() => expect(pending.length).toBeGreaterThan(i));
    act(() => pending[i]!.resolve(response(pending[i]!.files[0]!)));
  }
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.completed).toBe(298);
  expect(pending).toHaveLength(299);
  expect(pending.some(p => p.files[0]!.absolute_path === files[3]!.absolute_path)).toBe(false);
  expect(new Set(pending.map(p => p.files[0]!.absolute_path)).size).toBe(299);
  const added = { ...file, absolute_path: "X:/new.tif" };
  rerender({ picks: [...retained, added] });
  await waitFor(() => expect(pending).toHaveLength(300));
  expect(pending[299]!.files).toEqual([added]);
  expect(result.current.completed).toBe(298);
}, 30_000);

it("excluir um arquivo ativo cancela só ele e ignora sua resposta tardia", async () => {
  const second = { ...file, absolute_path: "X:/two.tif" };
  const { result, rerender } = renderHook(({ picks }) => useNetworkFileInspections(picks, true), {
    wrapper, initialProps: { picks: [file, second] },
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  rerender({ picks: [second] });
  await waitFor(() => expect(pending[0]!.options.signal?.aborted).toBe(true));
  expect(pending[1]!.options.signal?.aborted).toBe(false);
  act(() => { pending[0]!.resolve(response()); pending[1]!.resolve(response(second)); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.files.map(f => f.absolute_path)).toEqual([second.absolute_path]);
  rerender({ picks: [] });
  expect(result.current.data).toBeUndefined();
  expect(pending).toHaveLength(2);
});

it("funciona no StrictMode do aplicativo", async () => {
  vi.mocked(inspectNetworkFiles).mockResolvedValue(response());
  const { result } = renderHook(() => useNetworkFileInspections([file], true), {
    wrapper: ({ children }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>,
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
