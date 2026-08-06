import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console: ${msg.text()}`);
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  await page.fill("#ponto", "918713");
  await page.fill("#nome", "Smoke Test");
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15_000,
  });

  await page.waitForTimeout(2000);

  const text = await page.locator("body").innerText();
  const hasFilters = text.includes("Filtros de Pesquisa");
  const hasTable = text.includes("Nr OS") || text.includes("Carregando");

  console.log("URL:", page.url());
  console.log("Has filters:", hasFilters);
  console.log("Has table:", hasTable);
  console.log("Body preview:", text.slice(0, 400).replace(/\s+/g, " "));
  if (errors.length) {
    console.log("Errors:", errors.slice(0, 10));
  }

  await browser.close();
  process.exit(hasFilters || hasTable ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
