import type {
  DashboardNotificationSound,
  DashboardNotificationSounds,
  DashboardPriorityType,
  DashboardSoundSlot,
} from "./types";

export const NOTIFICATION_SOUND_SLOTS: Array<{
  id: DashboardSoundSlot;
  title: string;
}> = [
  { id: "high", title: "Prioridade alta (Prometido)" },
  { id: "medium", title: "Prioridade média (Solicitado)" },
  { id: "normal", title: "Prioridade normal" },
];

export const NOTIFICATION_SOUND_PRESETS = [
  { id: "suave", label: "Suave", file: "suave.wav" },
  { id: "ping", label: "Ping", file: "ping.wav" },
  { id: "chime", label: "Sino", file: "chime.wav" },
  { id: "bell", label: "Sino grave", file: "bell.wav" },
  { id: "knock", label: "Toque", file: "knock.wav" },
  { id: "pop", label: "Estalo", file: "pop.wav" },
  { id: "bright", label: "Brilho", file: "bright.wav" },
  { id: "pulse", label: "Pulso", file: "pulse.wav" },
  { id: "drop", label: "Queda", file: "drop.wav" },
] as const;

export type NotificationSoundPresetId =
  (typeof NOTIFICATION_SOUND_PRESETS)[number]["id"];

export const DEFAULT_NOTIFICATION_PRESET: NotificationSoundPresetId = "suave";
export const CUSTOM_NOTIFICATION_PRESET = "custom";
export const MUTE_NOTIFICATION_PRESET = "none";
export const MAX_CUSTOM_NOTIFICATION_BYTES = 350_000;

const PRESET_IDS = new Set<string>(
  NOTIFICATION_SOUND_PRESETS.map((item) => item.id),
);

export function isNotificationPresetId(
  value: string,
): value is NotificationSoundPresetId {
  return PRESET_IDS.has(value);
}

export function normalizeNotificationSound(
  raw: unknown,
  options?: { keepDefault?: boolean },
): DashboardNotificationSound | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as DashboardNotificationSound;
  const preset = String(parsed.preset || "").trim();
  if (preset === MUTE_NOTIFICATION_PRESET) {
    return { preset: MUTE_NOTIFICATION_PRESET };
  }
  if (preset === CUSTOM_NOTIFICATION_PRESET) {
    const customDataUrl = String(parsed.customDataUrl || "").trim();
    const customName = String(parsed.customName || "").trim();
    if (!isCustomNotificationDataUrl(customDataUrl)) {
      return undefined;
    }
    return {
      preset: CUSTOM_NOTIFICATION_PRESET,
      customDataUrl,
      ...(customName ? { customName } : {}),
    };
  }
  if (!isNotificationPresetId(preset)) {
    return undefined;
  }
  if (preset === DEFAULT_NOTIFICATION_PRESET && !options?.keepDefault) {
    return undefined;
  }
  return { preset };
}

export function normalizeNotificationSounds(
  raw: unknown,
): DashboardNotificationSounds | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const parsed = raw as DashboardNotificationSounds;
  const high = normalizeNotificationSound(parsed.high, { keepDefault: true });
  const medium = normalizeNotificationSound(parsed.medium, { keepDefault: true });
  const normal = normalizeNotificationSound(parsed.normal, { keepDefault: true });
  const sounds: DashboardNotificationSounds = {
    ...(high ? { high } : {}),
    ...(medium ? { medium } : {}),
    ...(normal ? { normal } : {}),
  };
  return Object.keys(sounds).length > 0 ? sounds : undefined;
}

export function soundSlotFromPriorityType(
  type: DashboardPriorityType,
): DashboardSoundSlot {
  if (type === "priority-high") {
    return "high";
  }
  if (type === "priority-medium") {
    return "medium";
  }
  return "normal";
}

export function pickHighestSoundSlot(
  types: Iterable<DashboardPriorityType>,
): DashboardSoundSlot {
  let slot: DashboardSoundSlot = "normal";
  for (const type of types) {
    if (type === "priority-high") {
      return "high";
    }
    if (type === "priority-medium") {
      slot = "medium";
    }
  }
  return slot;
}

export function resolveNotificationSoundForSlot(
  sounds: DashboardNotificationSounds | undefined,
  slot: DashboardSoundSlot,
  legacy?: DashboardNotificationSound,
): DashboardNotificationSound | undefined {
  return sounds?.[slot] ?? legacy;
}

export function isCustomNotificationDataUrl(value: string): boolean {
  return /^data:audio\/(mpeg|mp3|mp4);base64,/i.test(value);
}

export function notificationSoundSrc(
  sound: DashboardNotificationSound | undefined,
): string | null {
  if (sound?.preset === MUTE_NOTIFICATION_PRESET) {
    return null;
  }
  if (sound?.preset === CUSTOM_NOTIFICATION_PRESET) {
    return sound.customDataUrl && isCustomNotificationDataUrl(sound.customDataUrl)
      ? sound.customDataUrl
      : null;
  }
  const presetId =
    sound?.preset && isNotificationPresetId(sound.preset)
      ? sound.preset
      : DEFAULT_NOTIFICATION_PRESET;
  const preset = NOTIFICATION_SOUND_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    return null;
  }
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}sounds/${preset.file}`;
}

let lastPlayAt = 0;
let currentClip: HTMLAudioElement | null = null;

export function resetNotificationSoundPlayback(): void {
  lastPlayAt = 0;
  currentClip = null;
}

export async function playNotificationSound(
  sound: DashboardNotificationSound | undefined,
): Promise<void> {
  const src = notificationSoundSrc(sound);
  if (!src) {
    return;
  }
  const now = Date.now();
  if (now - lastPlayAt < 350) {
    return;
  }
  lastPlayAt = now;
  try {
    currentClip?.pause();
    const clip = new Audio(src);
    clip.preload = "auto";
    currentClip = clip;
    clip.currentTime = 0;
    await clip.play();
  } catch (error) {
    console.warn("[painel] falha ao tocar notificação", error);
  }
}

export async function readCustomNotificationFile(
  file: File,
): Promise<{ name: string; dataUrl: string }> {
  const name = file.name.trim() || "arquivo.mp3";
  if (!/\.mp3$/i.test(name) && file.type !== "audio/mpeg" && file.type !== "audio/mp3") {
    throw new Error("Envie um arquivo .mp3.");
  }
  if (file.size > MAX_CUSTOM_NOTIFICATION_BYTES) {
    throw new Error("O MP3 deve ter no máximo 350 KB.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (!isCustomNotificationDataUrl(result) && !result.startsWith("data:audio/")) {
        reject(new Error("Arquivo de áudio inválido."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
  const normalized = dataUrl.replace(/^data:audio\/[^;]+/i, "data:audio/mpeg");
  if (!isCustomNotificationDataUrl(normalized)) {
    throw new Error("Envie um arquivo .mp3.");
  }
  return { name, dataUrl: normalized };
}
