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
