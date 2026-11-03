import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const classic = readFileSync(
  resolve(here, "../dashboard-setor/dashboard-setor.css"),
  "utf8",
);
const modern = readFileSync(resolve(here, "./dashboard-setor-modern.css"), "utf8");

describe("responsividade alinhada ao painel/setor", () => {
  it.each([
    "@media screen and (max-width: 1024px)",
    "@media screen and (min-width: 2560px)",
    "@media screen and (max-height: 800px)",
    "@media screen and (max-width: 768px)",
    "@media screen and (max-width: 600px)",
    "repeat(auto-fit, minmax(130px, 1fr))",
    "grid-template-columns: repeat(3, 1fr) !important",
  ])("compartilha a regra %s", (rule) => {
    expect(classic).toContain(rule);
    expect(modern).toContain(rule);
  });
});
