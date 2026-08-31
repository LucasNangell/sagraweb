const PREVIEWABLE_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export function isOriginalFolderName(name: string): boolean {
  const lowered = name.trim().toLowerCase();
  return lowered.startsWith("original") || lowered.startsWith("orignal");
}

export function isOriginalFolderRelative(relative: string): boolean {
  const first =
    relative.replace(/\\/g, "/").split("/").filter(Boolean)[0] ?? "";
  return isOriginalFolderName(first);
}

export function isPreviewableFileName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEWABLE_EXTENSIONS.has(ext);
}

export function joinOsAbsolutePath(rootPath: string, relative: string): string {
  const base = rootPath.replace(/[\\/]+$/, "");
  const rel = relative.replace(/\//g, "\\");
  if (!rel) {
    return base;
  }
  return `${base}\\${rel}`;
}
