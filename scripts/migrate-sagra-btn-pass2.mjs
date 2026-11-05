/**
 * Segunda passada: CTAs com h-* / flex / py sem px / class order diferente.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("apps/web/src");

/** @type {Array<[RegExp, string]>} */
const REPLACEMENTS = [
  [
    /!text-primary-green\s+!border-primary-green/g,
    "",
  ],
  [
    /sagra-btn sagra-btn--outline sagra-btn--md\s+/g,
    (m, offset, src) => {
      // Convert green outline leftovers only when previous !text was nearby — handled separately
      return m;
    },
  ],

  // flex/w-full primary (login, forms)
  [
    /\b(?:flex|inline-flex)\s+(?:h-(?:7|8|9|10)\s+)?(?:w-full\s+)?(?:shrink-0\s+)?(?:cursor-pointer\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-primary-green\s+(?:px-\d(?:\.\d)?\s+)?(?:py-\d(?:\.\d)?\s+)?(?:text-(?:\[11px\]|xs|sm|base)\s+)?(?:font-(?:medium|semibold|bold)\s+)?text-white(?:\s+shadow-sm)?(?:\s+transition)?(?:\s+hover:(?:opacity-90|bg-primary-green\/\d+|brightness-\d+))?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--primary sagra-btn--md",
  ],

  // secondary flex/h
  [
    /\b(?:flex|inline-flex)\s+(?:h-(?:7|8|9|10)\s+)?(?:w-full\s+)?(?:shrink-0\s+)?(?:items-center\s+)?(?:justify-center\s+)?(?:gap-\d(?:\.\d)?\s+)?rounded(?:-md|-lg)?\s+bg-secondary-blue\s+(?:px-\d(?:\.\d)?\s+)?(?:py-\d(?:\.\d)?\s+)?(?:text-(?:\[10px\]|\[11px\]|xs|sm)\s+)?(?:font-(?:medium|semibold|bold)\s+)?text-white(?:\s+shadow-sm)?(?:\s+transition)?(?:\s+hover:bg-secondary-blue\/?\d*)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--secondary sagra-btn--md",
  ],

  // compact primary/secondary without inline-flex prefix already handled
  [
    /\brounded(?:-md|-lg)?\s+bg-primary-green\s+(?:px-\d(?:\.\d)?\s+)?(?:py-\d(?:\.\d)?\s+)?(?:text-(?:\[10px\]|\[11px\]|xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:opacity-90)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--primary sagra-btn--sm",
  ],
  [
    /\b(?:flex-1\s+)?rounded(?:-md|-lg)?\s+bg-secondary-blue\s+(?:px-\d(?:\.\d)?\s+)?(?:py-\d(?:\.\d)?\s+)?(?:text-(?:\[11px\]|xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+hover:bg-secondary-blue\/?\d*)?(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--secondary sagra-btn--md",
  ],
  [
    /\b(?:flex-1\s+)?rounded(?:-md|-lg)?\s+bg-primary-green\s+(?:px-\d(?:\.\d)?\s+)?(?:py-\d(?:\.\d)?\s+)?(?:text-(?:xs|sm)\s+)?(?:font-(?:medium|semibold)\s+)?text-white(?:\s+disabled:[^\s"]+)*/g,
    "sagra-btn sagra-btn--primary sagra-btn--md",
  ],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(name) && !name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

let filesChanged = 0;
let hits = 0;
for (const file of walk(ROOT)) {
  let src = fs.readFileSync(file, "utf8");
  // Skip non-button contexts for header bars: don't touch lines with <header
  const before = src;
  for (const [re, repl] of REPLACEMENTS) {
    if (typeof repl === "function") continue;
    src = src.replace(re, () => {
      hits += 1;
      return repl;
    });
  }
  // Fix green outline buttons
  src = src.replace(
    /sagra-btn sagra-btn--outline sagra-btn--md\s*(?:!text-primary-green\s*)?(?:!border-primary-green\s*)?/g,
    "sagra-btn sagra-btn--primary-outline sagra-btn--md ",
  );
  src = src.replace(
    /inline-flex shrink-0 sagra-btn sagra-btn--primary-outline sagra-btn--md/g,
    "sagra-btn sagra-btn--primary-outline sagra-btn--md",
  );
  if (src !== before) {
    fs.writeFileSync(file, src);
    filesChanged += 1;
    console.log("updated", path.relative(process.cwd(), file));
  }
}
console.log(`\nDone. files=${filesChanged} hits≈${hits}`);
