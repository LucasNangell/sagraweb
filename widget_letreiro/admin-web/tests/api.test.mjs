import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

globalThis.window = { location: { search: "" } };
globalThis.sessionStorage = { getItem: () => "" };
const source = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { api, ApiError, HtmlApiResponse } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("usa captura compatível quando o servidor devolve HTML ou rota inexistente", async () => {
  globalThis.fetch = async () => new Response("<!doctype html><html><body>SAGRA Web</body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  assert.deepEqual(await api.screenshotCapability(), { highQuality: false });
  globalThis.fetch = async () => new Response('{"detail":"Not Found"}', { status: 404 });
  assert.deepEqual(await api.screenshotCapability(), { highQuality: false });
});

test("mantém erros de autorização e respostas JSON inválidas visíveis", async () => {
  globalThis.fetch = async () => new Response('{"detail":"Acesso negado"}', { status: 403 });
  await assert.rejects(api.screenshotCapability(), error => error instanceof ApiError && error.status === 403);
  globalThis.fetch = async () => new Response('{"highQuality":', { status: 200 });
  await assert.rejects(api.screenshotCapability(), /resposta inválida da API/);
});

test("aceita a API nova e informa HTML inesperado no resultado da captura", async () => {
  globalThis.fetch = async () => new Response('{"highQuality":true}', { status: 200 });
  assert.deepEqual(await api.screenshotCapability(), { highQuality: true });
  globalThis.fetch = async () => new Response("<!doctype html><html></html>", { status: 200 });
  await assert.rejects(api.screenshotResult(1), HtmlApiResponse);
});
