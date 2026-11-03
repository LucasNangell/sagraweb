"""Gera toques curtos originais (PCM WAV) para notificação do painel.

Os arquivos são síntese própria, sem samples de terceiros.
"""
from __future__ import annotations

import math
import os
import struct
import wave

RATE = 22050
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sounds")


def write_wav(name: str, samples: list[float]) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        frames = bytearray()
        for sample in samples:
            clipped = max(-0.98, min(0.98, sample))
            frames.extend(struct.pack("<h", int(clipped * 32767)))
        wav.writeframes(bytes(frames))


def tone(
    freq: float,
    duration: float,
    *,
    amp: float = 0.28,
    attack: float = 0.008,
    release: float = 0.12,
    decay: float = 0.0,
) -> list[float]:
    n = int(duration * RATE)
    out: list[float] = []
    for i in range(n):
        t = i / RATE
        env = 1.0
        if t < attack:
            env = t / attack if attack else 1.0
        elif release and t > duration - release:
            env = max(0.0, (duration - t) / release)
        if decay:
            env *= math.exp(-decay * t)
        out.append(amp * env * math.sin(2 * math.pi * freq * t))
    return out


def mix(*parts: list[float]) -> list[float]:
    length = max((len(p) for p in parts), default=0)
    out = [0.0] * length
    for part in parts:
        for i, value in enumerate(part):
            out[i] += value
    peak = max((abs(v) for v in out), default=1.0)
    if peak > 0.9:
        scale = 0.9 / peak
        out = [v * scale for v in out]
    return out


def silence(duration: float) -> list[float]:
    return [0.0] * int(duration * RATE)


def concat(*parts: list[float]) -> list[float]:
    out: list[float] = []
    for part in parts:
        out.extend(part)
    return out


def noise_burst(duration: float, amp: float = 0.22) -> list[float]:
    n = int(duration * RATE)
    seed = 12345
    out: list[float] = []
    prev = 0.0
    for i in range(n):
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        white = (seed / 0x7FFFFFFF) * 2 - 1
        # ruído um pouco mais “madeira”
        prev = prev * 0.6 + white * 0.4
        t = i / RATE
        env = math.exp(-18 * t)
        out.append(amp * env * prev)
    return out


def main() -> None:
    suave = mix(
        concat(silence(0.0), tone(587.33, 0.42, amp=0.22, decay=4.2)),
        concat(silence(0.12), tone(783.99, 0.42, amp=0.2, decay=4.5)),
    )
    write_wav("suave.wav", suave)

    write_wav("ping.wav", tone(1396.91, 0.28, amp=0.26, attack=0.004, decay=9.0, release=0.08))

    chime = mix(
        concat(silence(0.0), tone(1046.5, 0.38, amp=0.2, decay=5.0)),
        concat(silence(0.09), tone(1318.51, 0.38, amp=0.18, decay=5.2)),
        concat(silence(0.18), tone(1567.98, 0.42, amp=0.16, decay=5.5)),
    )
    write_wav("chime.wav", chime)

    bell = mix(
        tone(659.25, 0.7, amp=0.22, decay=3.2, release=0.2),
        tone(1318.51, 0.55, amp=0.08, decay=6.0, release=0.15),
    )
    write_wav("bell.wav", bell)

    knock = concat(
        noise_burst(0.12, 0.28),
        silence(0.08),
        noise_burst(0.12, 0.22),
    )
    write_wav("knock.wav", knock)

    write_wav("pop.wav", tone(392.0, 0.16, amp=0.3, attack=0.002, decay=22.0, release=0.04))

    bright = mix(
        concat(silence(0.0), tone(523.25, 0.22, amp=0.18, decay=7.0)),
        concat(silence(0.07), tone(659.25, 0.22, amp=0.18, decay=7.0)),
        concat(silence(0.14), tone(783.99, 0.28, amp=0.2, decay=6.0)),
    )
    write_wav("bright.wav", bright)

    pulse = concat(
        tone(740.0, 0.11, amp=0.24, attack=0.004, decay=10.0, release=0.03),
        silence(0.07),
        tone(740.0, 0.11, amp=0.2, attack=0.004, decay=10.0, release=0.03),
    )
    write_wav("pulse.wav", pulse)

    drop_n = int(0.45 * RATE)
    drop = []
    for i in range(drop_n):
        t = i / RATE
        freq = 880.0 * (0.5 ** (t / 0.45))
        env = math.exp(-3.2 * t)
        if t < 0.01:
            env *= t / 0.01
        drop.append(0.24 * env * math.sin(2 * math.pi * freq * t))
    write_wav("drop.wav", drop)

    print(f"sons gerados em {os.path.abspath(OUT_DIR)}")


if __name__ == "__main__":
    main()
