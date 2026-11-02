#!/usr/bin/env python3
"""Deterministic 224.000 s music bed for the LearnRise promo.

224 s = 6720 frames @ 30 fps, the film contract. Everything is synthesized
with numpy/scipy from a fixed seed: no samples, no network, no wall clock.
The mix script (scripts/mix-audio.mjs) re-runs this only when the output is
missing, so the same bytes appear on every clean build.

Output: out/audio/bed-224.wav — 48 kHz / stereo / 16-bit PCM, 10,752,000 frames.

Musical shape: seven 32 s chord segments with a 6 s crossfade, an octave-down
sub, and a soft two-bar pulse. The programme level is deliberately low; the
mix script normalises it to -25 LUFS before ducking.
"""

from __future__ import annotations

import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48_000
DUR = 224.0
N = int(round(SR * DUR))
SEED = 20261103
OUT = os.path.join("out", "audio", "bed-224.wav")

SEGMENT = 32.0
CROSSFADE = 6.0
PEAK_TARGET_DBFS = -9.0

rng = np.random.default_rng(SEED)

A2, C3, D3, E3, F2, G2, G3, B2, B3 = (
    110.00, 130.81, 146.83, 164.81, 87.31, 98.00, 196.00, 123.47, 246.94,
)

# (name, pad notes, sub root) — 7 × 32 s = 224 s.
CHORDS = [
    ("Am9", [A2, 130.81, 164.81, 196.00, 246.94], A2),
    ("Fmaj7", [F2, 110.00, 130.81, 164.81], F2),
    ("Cmaj7", [130.81, 164.81, 196.00, 246.94], 130.81),
    ("G6", [G2, B2, D3, E3], G2),
    ("Am9", [A2, 130.81, 164.81, 196.00, 246.94], A2),
    ("Fmaj7", [F2, 110.00, 130.81, 164.81], F2),
    ("G6", [G2, B2, D3, E3], G2),
]


def cosine_ramp(n: int, rising: bool) -> np.ndarray:
    if n <= 0:
        return np.zeros(0)
    u = np.linspace(0.0, 1.0, n)
    return (1.0 - 0.5 * (1.0 - np.cos(np.pi * u))) if rising else (
        0.5 * (1.0 + np.cos(np.pi * u))
    )


def segment_envelope(n: int, index: int, total: int) -> np.ndarray:
    env = np.ones(n)
    attack = int((2.5 if index == 0 else CROSSFADE) * SR)
    release = int((0 if index == total - 1 else CROSSFADE) * SR)
    attack = min(attack, n)
    release = min(release, n)
    if attack:
        env[:attack] *= cosine_ramp(attack, rising=True)
    if release:
        env[-release:] *= cosine_ramp(release, rising=False)
    return env


def add(buf: np.ndarray, start: float, sig: np.ndarray) -> None:
    s = int(round(start * SR))
    e = min(len(buf), s + len(sig))
    if s >= len(buf):
        return
    buf[s:e] += sig[: e - s]


def render_pads() -> tuple[np.ndarray, np.ndarray]:
    left = np.zeros(N)
    right = np.zeros(N)
    for index, (_name, notes, _root) in enumerate(CHORDS):
        start = index * SEGMENT
        length = SEGMENT + (0 if index == len(CHORDS) - 1 else CROSSFADE)
        n = min(int(round(length * SR)), N - int(round(start * SR)))
        if n <= 0:
            continue
        t = np.arange(n) / SR
        env = segment_envelope(n, index, len(CHORDS))
        for note_index, freq in enumerate(notes):
            # Two detuned partials per note; fixed phases keep this repeatable.
            for detune_cents, pan in ((-5.0, -0.55), (5.0, 0.55)):
                f = freq * 2.0 ** (detune_cents / 1200.0)
                phase = (note_index * 0.37 + (0.19 if detune_cents < 0 else 0.61)) % 1.0
                tone = np.sin(2.0 * np.pi * f * t + 2.0 * np.pi * phase)
                tone += 0.12 * np.sin(2.0 * np.pi * 2.0 * f * t)
                gain = 0.032
                lg = gain * (0.5 - 0.5 * pan)
                rg = gain * (0.5 + 0.5 * pan)
                add(left, start, env * tone * lg)
                add(right, start, env * tone * rg)
    return left, right


def render_sub() -> np.ndarray:
    sub = np.zeros(N)
    for index, (_name, _notes, root) in enumerate(CHORDS):
        start = index * SEGMENT
        length = SEGMENT + (0 if index == len(CHORDS) - 1 else CROSSFADE)
        n = min(int(round(length * SR)), N - int(round(start * SR)))
        if n <= 0:
            continue
        t = np.arange(n) / SR
        env = segment_envelope(n, index, len(CHORDS)) * 0.55
        add(sub, start, env * 0.11 * np.sin(2.0 * np.pi * (root / 2.0) * t))
    return sub


def render_pulse() -> tuple[np.ndarray, np.ndarray]:
    left = np.zeros(N)
    right = np.zeros(N)
    hit_n = int(0.55 * SR)
    t = np.arange(hit_n) / SR
    freq = 46.0 + 18.0 * np.exp(-t / 0.06)
    phase = 2.0 * np.pi * np.cumsum(freq) / SR
    hit = np.sin(phase) * np.exp(-t / 0.20)
    hit *= cosine_ramp(hit_n, rising=False) ** 0.5
    hit[-1] = 0.0
    start = 4.0
    while start < DUR - 1.0:
        add(left, start, 0.10 * hit)
        add(right, start, 0.10 * hit)
        start += 4.0
    return left, right


def main() -> None:
    pad_l, pad_r = render_pads()
    sub = render_sub()
    pulse_l, pulse_r = render_pulse()

    left = pad_l + 0.5 * sub + pulse_l
    right = pad_r + 0.5 * sub + pulse_r
    mix = np.stack([left, right], axis=1).astype(np.float64)

    # DC block -> gentle saturation -> global fades -> peak normalise.
    sos = signal.butter(2, 24, btype="highpass", fs=SR, output="sos")
    mix = signal.sosfilt(sos, mix, axis=0)
    mix = np.tanh(1.25 * mix) / np.tanh(1.25)

    fade_in = int(1.5 * SR)
    fade_out = int(4.0 * SR)
    mix[:fade_in] *= cosine_ramp(fade_in, rising=True)[:, None]
    mix[-fade_out:] *= cosine_ramp(fade_out, rising=False)[:, None]
    mix = mix - mix.mean(axis=0)
    mix[-1, :] = 0.0

    peak = float(np.max(np.abs(mix)))
    target = 10.0 ** (PEAK_TARGET_DBFS / 20.0)
    mix *= target / peak

    pcm = np.clip(np.round(mix * 32767.0), -32768, 32767).astype(np.int16)
    assert pcm.shape == (N, 2), pcm.shape
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wavfile.write(OUT, SR, pcm)

    peak_db = 20 * np.log10(np.max(np.abs(pcm.astype(np.float64))) / 32768.0)
    print(f"bed     : {OUT}")
    print(f"frames  : {pcm.shape[0]} ({pcm.shape[0] / SR:.3f} s)")
    print(f"peak    : {peak_db:.2f} dBFS")
    print(f"seed    : {SEED}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - CLI surface
        sys.stderr.write(f"make-bed: {error}\n")
        sys.exit(1)
