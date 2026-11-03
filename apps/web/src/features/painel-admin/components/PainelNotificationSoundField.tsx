import { useRef, useState } from "react";

import {
  CUSTOM_NOTIFICATION_PRESET,
  MUTE_NOTIFICATION_PRESET,
  NOTIFICATION_SOUND_PRESETS,
  playNotificationSound,
  readCustomNotificationFile,
} from "@/features/dashboard-setor/notificationSounds";
import type { DashboardNotificationSound } from "@/features/dashboard-setor/types";

export function PainelNotificationSoundField({
  title,
  value,
  fallback,
  onChange,
}: {
  title: string;
  value: DashboardNotificationSound | undefined;
  fallback?: DashboardNotificationSound;
  onChange: (next: DashboardNotificationSound) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const displayed = value ?? fallback;
  const selected = displayed?.preset || "suave";

  const choose = (sound: DashboardNotificationSound) => {
    setError(null);
    onChange(sound);
    void playNotificationSound(sound);
  };

  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">
        {title}
      </legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {NOTIFICATION_SOUND_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rounded border px-2 py-1.5 text-left text-xs font-semibold ${
              selected === preset.id
                ? "border-secondary-blue bg-sky-50 text-slate-800"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            aria-pressed={selected === preset.id}
            onClick={() => choose({ preset: preset.id })}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={`rounded border px-2 py-1.5 text-left text-xs font-semibold ${
            selected === MUTE_NOTIFICATION_PRESET
              ? "border-secondary-blue bg-sky-50 text-slate-800"
              : "border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
          aria-pressed={selected === MUTE_NOTIFICATION_PRESET}
          onClick={() => choose({ preset: MUTE_NOTIFICATION_PRESET })}
        >
          Sem som
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) {
              return;
            }
            void readCustomNotificationFile(file)
              .then((custom) => {
                choose({
                  preset: CUSTOM_NOTIFICATION_PRESET,
                  customName: custom.name,
                  customDataUrl: custom.dataUrl,
                });
              })
              .catch((err) => {
                setError(
                  err instanceof Error ? err.message : "Falha ao ler o MP3.",
                );
              });
          }}
        />
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => fileRef.current?.click()}
        >
          Enviar MP3
        </button>
        {selected === CUSTOM_NOTIFICATION_PRESET && displayed?.customName ? (
          <span className="text-xs text-slate-600">
            Arquivo: {displayed.customName}
          </span>
        ) : null}
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          onClick={() => void playNotificationSound(displayed)}
        >
          Ouvir
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </fieldset>
  );
}
