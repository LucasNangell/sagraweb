/** Hostnames que exigem login por e-mail/senha (internet), não ponto+nome (LAN). */
export function isPublicWebHostname(hostname?: string): boolean {
  const h = (
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "")
  )
    .trim()
    .toLowerCase();
  if (!h) {
    return false;
  }
  if (
    h === "cgraf.online" ||
    h === "www.cgraf.online" ||
    h === "cgrafsysvm.camara.leg.br"
  ) {
    return true;
  }
  if (h.endsWith(".cgraf.online")) {
    return true;
  }
  if (h.endsWith(".workers.dev")) {
    return true;
  }
  return false;
}
