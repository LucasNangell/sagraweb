import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Transpila o módulo puro em memória, sem exigir runtime TS ou alterar o build.
const protocol = ts.transpileModule(readFileSync(new URL("../src/desktop.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { desktopTargetGuard, matchesDesktopJob, moveWindowScript, parseDesktopResult, parseQuickButtons, supportsLargeScreenshot, validWindowIdentity, windowActionScript } = await import(`data:text/javascript;base64,${Buffer.from(protocol).toString("base64")}`);

const windowRow = { handle: "12345", processId: 120, processStart: "639000000000000000", title: "Relatório <1>", processName: "WINWORD", state: "normal", fullscreen: false, monitorId: "DISPLAY1" };
const monitors = [{ id: "DISPLAY1", name: "Monitor 1", primary: true }, { id: "DISPLAY2", name: "Monitor 2", primary: false }];
const date = "2026-11-03T20:00:00Z";
const reply = windows => JSON.stringify({ type: "windows", windows, monitors, capturedAt: date, truncated: false });
const target = { hostName: "PC-SALA", windowsUser: "DOMINIO\\ana" };
const job = { ...target, name: "sagra-desktop/windows/request-1" };
const templatePath = fileURLToPath(new URL("../src/desktopScripts/windows.ps1", import.meta.url));
const template = readFileSync(templatePath, "utf8");
const screenshotPath = fileURLToPath(new URL("../src/desktopScripts/screenshot.ps1", import.meta.url));
const image = readFileSync(new URL("./fixtures/desktop-preview.jpg", import.meta.url)).toString("base64");
const shot = { type: "screenshot", mime: "image/jpeg", image, width: 1280, height: 720, originalWidth: 1920, originalHeight: 1080, capturedAt: date };

test("verifica a versão da estação, sem presumir capacidade para versões desconhecidas", () => {
  assert.equal(supportsLargeScreenshot("2.15.0"), false);
  assert.equal(supportsLargeScreenshot("2.39.9"), false);
  assert.equal(supportsLargeScreenshot("2.40.2"), true);
  assert.equal(supportsLargeScreenshot("3.0.0+build"), true);
  assert.equal(supportsLargeScreenshot(""), null);
  assert.equal(supportsLargeScreenshot("desconhecida"), null);
});

test("correlaciona somente a solicitação exata do host e usuário completo", () => {
  assert.equal(matchesDesktopJob(job, job.name, { hostName: "pc-sala", windowsUser: "dominio\\ANA" }), true);
  assert.equal(matchesDesktopJob(job, "request-2", target), false);
  assert.equal(matchesDesktopJob(job, job.name, { ...target, windowsUser: "OUTRO\\ana" }), false);
  assert.equal(matchesDesktopJob(job, job.name, { ...target, hostName: "PC-OUTRO" }), false);
});

test("guardas de destino rejeitam identidade incompleta e protegem literais PowerShell", () => {
  assert.throws(() => desktopTargetGuard({ hostName: "", windowsUser: "ana" }));
  assert.throws(() => desktopTargetGuard({ hostName: "PC", windowsUser: "ana\nexit" }));
  const escaped = desktopTargetGuard({ hostName: "PC'1", windowsUser: "DOM\\d'ana" });
  assert.ok(escaped.includes("'PC''1'"));
  assert.ok(escaped.includes("'DOM\\d''ana'"));
});

test("aceita lista vazia e lista com identidade e estado válidos", () => {
  assert.deepEqual(parseDesktopResult(reply([])).windows, []);
  assert.deepEqual(parseDesktopResult(reply([windowRow])).windows, [windowRow]);
});

test("rejeita IDs negativos, não numéricos, acima de Int64 e processos inválidos", () => {
  for (const handle of ["-1", "0", "12; Stop-Process", "9223372036854775808", "<script>"]) assert.equal(validWindowIdentity({ ...windowRow, handle }), false);
  assert.equal(validWindowIdentity({ ...windowRow, processId: 1.5 }), false);
  assert.equal(validWindowIdentity({ ...windowRow, processStart: "0" }), false);
});

test("rejeita resposta truncada, tipo desconhecido e listas excessivas", () => {
  for (const raw of ['{"type":', '{"type":"html"}', "x".repeat(900 * 1024 + 1), reply(Array(101).fill(windowRow))]) assert.throws(() => parseDesktopResult(raw));
  assert.throws(() => parseDesktopResult(reply([{ ...windowRow, title: "x".repeat(201) }])));
});

test("captura JPEG do mock cabe inteira no limite do canal e preserva as dimensões", () => {
  const raw = JSON.stringify(shot);
  assert.ok(raw.length < 65536);
  assert.equal(parseDesktopResult(raw).image, image);
  assert.equal(parseDesktopResult(raw).width, 1280);
});

test("aceita JPEG válido acima do antigo limite de 45 KB", () => {
  const original = Buffer.from(image, "base64");
  const comment = Buffer.alloc(50004, 65);
  comment[0] = 255; comment[1] = 254; comment.writeUInt16BE(50002, 2);
  const larger = Buffer.concat([original.subarray(0, 2), comment, original.subarray(2)]).toString("base64");
  assert.equal(parseDesktopResult(JSON.stringify({ ...shot, image: larger })).image, larger);
});

test("aceita PNG sem perdas e rejeita dimensão divergente ou arquivo truncado", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAukAAAAASUVORK5CYII=";
  const result = { ...shot, mime: "image/png", image: png, width: 1, height: 1 };
  assert.equal(parseDesktopResult(JSON.stringify(result)).mime, "image/png");
  assert.throws(() => parseDesktopResult(JSON.stringify({ ...result, width: 2 })));
  assert.throws(() => parseDesktopResult(JSON.stringify({ ...result, image: png.slice(0, -12) })));
});

test("rejeita SVG, JPEG truncado, MIME adulterado e captura grande demais", () => {
  for (const patch of [{ mime: "image/svg+xml" }, { image: btoa("<svg onload=alert(1)>") }, { image: "/9j/" }, { image: image.slice(0, -4) }, { width: 100000 }, { width: 1281 }, { height: 721 }, { capturedAt: "ontem" }, { image: "A".repeat(866672) }]) assert.throws(() => parseDesktopResult(JSON.stringify({ ...shot, ...patch })));
});

test("valida monitores e protege a movimentação contra interpolação", () => {
  assert.deepEqual(parseDesktopResult(reply([windowRow])).monitors, monitors);
  assert.throws(() => parseDesktopResult(reply([{ ...windowRow, monitorId: "outro" }])));
  assert.throws(() => moveWindowScript(template, windowRow, "DISPLAY1'; exit; '"));
  assert.match(moveWindowScript(template, windowRow, "DISPLAY2"), /::Move\(\[long\]12345, \[int\]120, \[long\]639000000000000000, 'DISPLAY2'\)/);
});

test("rejeita JPEG com dimensões internas adulteradas antes da exibição", () => {
  const altered = Buffer.from(image, "base64");
  const sof = altered.indexOf(Buffer.from([255, 192]));
  assert.ok(sof > 0);
  altered.writeUInt16BE(50000, sof + 7);
  assert.throws(() => parseDesktopResult(JSON.stringify({ ...shot, image: altered.toString("base64") })));
});

test("ação aceita apenas identidades e verbos permitidos, sem interpolar título", () => {
  const safe = windowActionScript(template, { ...windowRow, title: "'; Stop-Process -Id 1; '" }, "close");
  assert.ok(!safe.includes("Stop-Process"));
  assert.throws(() => windowActionScript(template, { ...windowRow, handle: "1; exit" }, "close"));
  assert.throws(() => windowActionScript(template, windowRow, "kill"));
  assert.match(windowActionScript(template, windowRow, "refresh"), /::Act\(\[long\]12345, \[int\]120, \[long\]639000000000000000, 'refresh'\)/);
});

test("atalhos persistidos aceitam somente IDs únicos positivos e no máximo vinte", () => {
  assert.deepEqual(parseQuickButtons('[1,1,-2,"3",null,2.5,4]'), [1,4]);
  assert.deepEqual(parseQuickButtons("inválido"), []);
  assert.deepEqual(parseQuickButtons('{"id":1}'), []);
  assert.equal(parseQuickButtons(JSON.stringify(Array.from({ length: 30 }, (_, i) => i + 1))).length, 20);
});

test("controle compila e fullscreen remove os estados max/min sem executar operações de janela", { skip: process.platform !== "win32", timeout: 30000 }, () => {
  const escaped = templatePath.replaceAll("'", "''");
  const check = `. '${escaped}'; foreach ($style in @(0x10CF0000,0x30CF0000,0x11CF0000)) { $result = [SagraDesktop]::FullscreenStyle($style); if (($result -band 0x21C40000) -ne 0 -or ($result -band 0x100B0000) -ne ($style -band 0x100B0000)) { throw 'Fullscreen não preservou os bits de estilo esperados.' } }`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", check], { encoding: "utf8", windowsHide: true, timeout: 25000 });
});

test("script de captura tem sintaxe válida no Windows PowerShell sem capturar a tela", { skip: process.platform !== "win32", timeout: 15000 }, () => {
  const escaped = screenshotPath.replaceAll("'", "''");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }`], { encoding: "utf8", windowsHide: true, timeout: 10000 });
});
