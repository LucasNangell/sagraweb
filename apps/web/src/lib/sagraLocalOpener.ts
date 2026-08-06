const LOCAL_OPENER_BASE = "http://127.0.0.1:5566";

async function postLocalOpener(
  endpoint: "open-folder" | "open-file",
  path: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_OPENER_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function tryOpenFolderLocally(path: string): Promise<boolean> {
  return postLocalOpener("open-folder", path);
}

export async function tryOpenFileLocally(path: string): Promise<boolean> {
  return postLocalOpener("open-file", path);
}

export async function openPathLocally(
  path: string,
  kind: "folder" | "file",
): Promise<boolean> {
  return kind === "file" ? tryOpenFileLocally(path) : tryOpenFolderLocally(path);
}
