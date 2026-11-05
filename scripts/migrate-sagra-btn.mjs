/**
 * Migra classNames comuns de botões Tailwind → sagra-btn (preserva cor/tamanho).
 * Uso: node scripts/migrate-sagra-btn.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("apps/web/src");
const SKIP = new Set([".test.tsx", ".test.ts", "sagraBtn.ts"]);

/** @type {Array<[RegExp, string]>} */
const REPLACEMENTS = [
  // Alias legado → canônico
  [/\bge-btn-3d\b/g, "sagra-btn"],

  // Primary green CTAs
  [
    /(?:inline-flex\s+)?(?:w-full\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-primary-green\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm|base)\s+)?(?:font-(?:medium|semibold|bold)\s+)?text-white(?:\s+hover:(?:opacity-90|bg-primary-green\/\d+))?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--primary sagra-btn--md",
  ],
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+border\s+border-primary-green\s+bg-white\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-primary-green(?:\s+hover:bg-primary-green\/\d+)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--outline sagra-btn--md !text-primary-green !border-primary-green",
  ],

  // Secondary blue
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-secondary-blue\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm|base)\s+)?(?:font-(?:medium|semibold|bold)\s+)?text-white(?:\s+hover:bg-secondary-blue\/?\d*)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--secondary sagra-btn--md",
  ],

  // Neutral / gray cancel
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-neutral-600\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:bg-neutral-700)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--neutral sagra-btn--md",
  ],
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-slate-600\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:bg-slate-700)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--neutral sagra-btn--md",
  ],
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-gray-btn\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:[^\s"]+)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--neutral sagra-btn--md",
  ],

  // Danger red
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+(?:border\s+border-red-600\/\d+\s+)?bg-red-600\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:bg-red-700)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--danger sagra-btn--md",
  ],

  // Info blue
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+(?:border\s+border-blue-600\/\d+\s+)?bg-blue-600\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:bg-blue-700)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--info sagra-btn--md",
  ],

  // Outline white / slate border
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?(?:shrink-0\s+)?rounded(?:-md|-lg)?\s+border\s+border-(?:neutral|slate|sagra)-[^\s]+\s+bg-white\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm|\[11px\])\s+)?(?:font-(?:medium|semibold)\s+)?text-(?:neutral|slate)-[67]00(?:\s+hover:bg-(?:neutral|slate)-50)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--outline sagra-btn--sm",
  ],

  // Amber warning outline / fill
  [
    /(?:inline-flex\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+border\s+border-amber-[^\s]+\s+bg-(?:white|amber-50)\s+(?:px-\d(?:\.\d)?\s+py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm|\[11px\])\s+)?(?:font-(?:medium|semibold)\s+)?text-amber-[89]00(?:\s+hover:bg-amber-\d+)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--warning sagra-btn--sm",
  ],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name) && ![...SKIP].some((s) => name.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

let filesChanged = 0;
let totalHits = 0;
for (const file of walk(ROOT)) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  for (const [re, repl] of REPLACEMENTS) {
    const next = src.replace(re, () => {
      totalHits += 1;
      return repl;
    });
    src = next;
  }
  if (src !== before) {
    fs.writeFileSync(file, src);
    filesChanged += 1;
    console.log("updated", path.relative(process.cwd(), file));
  }
}

console.log(`\nDone. files=${filesChanged} replacements≈${totalHits}`);
