export type LetreiroSound = {
  id: string;
  name: string;
  originalName?: string;
  size?: number;
  updatedAt?: string | null;
};

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export const MUTE_SOUND = "none";

export function clampNotificationSound(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw || raw.toLowerCase() === MUTE_SOUND) return MUTE_SOUND;
  return ID_RE.test(raw) ? raw : MUTE_SOUND;
}

/** "" = herdar global; "none" = silêncio; id = esse som. */
export function clampColumnSound(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === MUTE_SOUND) return MUTE_SOUND;
  return ID_RE.test(raw) ? raw : "";
}

export function soundLabel(sounds: LetreiroSound[], id: string): string {
  if (!id || id === MUTE_SOUND) return "Sem som";
  return sounds.find((item) => item.id === id)?.name ?? id;
}

/** Resolve som efetivo do filtro ("" herda global; "none" silencia). */
export function resolveFilterSound(columnSound?: string | null, globalSound?: string | null): string {
  const col = clampColumnSound(columnSound);
  if (col === MUTE_SOUND) return MUTE_SOUND;
  if (col) return col;
  return clampNotificationSound(globalSound);
}

export function resolveFilterAnimation(columnAnimation?: string | null, globalAnimation?: string | null): string {
  const col = (columnAnimation ?? "").trim();
  if (col) return col;
  return (globalAnimation ?? "").trim();
}
