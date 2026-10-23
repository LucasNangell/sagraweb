/**
 * Windows 11 25H2 recusa junctions do pnpm (UNKNOWN ao abrir package.json).
 * Substitui os links workspace @sagra/* por copias reais, sem atravessar o junction.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  {
    dest: path.join(root, "apps", "web", "node_modules", "@sagra", "ui"),
    src: path.join(root, "packages", "ui"),
  },
  {
    dest: path.join(root, "apps", "web", "node_modules", "@sagra", "api-types"),
    src: path.join(root, "packages", "api-types"),
  },
];

function isReparsePoint(dir) {
  try {
    return Boolean(fs.lstatSync(dir).isSymbolicLink());
  } catch {
    return false;
  }
}

function packageJsonReadable(dir) {
  try {
    fs.accessSync(path.join(dir, "package.json"), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function removeDest(dest) {
  if (!fs.existsSync(dest) && !isReparsePoint(dest)) {
    try {
      fs.lstatSync(dest);
    } catch {
      return;
    }
  }
  try {
    if (process.platform === "win32") {
      execFileSync("cmd.exe", ["/c", "rmdir", dest], { stdio: "ignore" });
    }
  } catch {
    /* rmdir sem /s remove junction; se for pasta real, cai no fallback */
  }
  if (packageJsonReadable(dest) || isReparsePoint(dest) || fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3 });
  }
}

function copyPackage(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (entry) => {
      const rel = path.relative(src, entry);
      const parts = rel.split(path.sep);
      return !parts.includes("node_modules") && !parts.includes("dist");
    },
  });
}

let changed = 0;
for (const { src, dest } of packages) {
  if (!packageJsonReadable(src)) {
    console.warn(`[materialize] origem ilegivel, ignorado: ${src}`);
    continue;
  }
  if (packageJsonReadable(dest) && !isReparsePoint(dest)) {
    continue;
  }
  removeDest(dest);
  copyPackage(src, dest);
  if (!packageJsonReadable(dest)) {
    throw new Error(`[materialize] falhou ao copiar ${src} -> ${dest}`);
  }
  changed += 1;
  console.log(`[materialize] ${path.relative(root, dest)}`);
}

if (changed === 0) {
  console.log("[materialize] workspace @sagra ja em pastas reais");
}
