#!/usr/bin/env python3
"""Deterministic 24.000 s music bed for the DAW-promo film.

120 BPM, 4/4, 12 bars (2.0 s per bar), A minor.
All sound is synthesized with numpy/scipy; no samples, no network.

Output: bed.wav  48 kHz / stereo / 16-bit PCM / exactly 1,152,000 frames.
"""

from __future__ import annotations

import numpy as np
from scipy import signal
from scipy.io import wavfile

# ----------------------------------------------------------------------------
# Global constants
# ----------------------------------------------------------------------------
SR = 48_000
DUR = 24.0
N = int(round(SR * DUR))  # 1,152,000
BAR = 2.0
BEAT = 0.5
EIGHTH = 0.25
SEED = 20261027
OUT = "bed.wav"

PEAK_TARGET_DBFS = -1.2
CLIP_DRIVE = 1.55

rng = np.random.default_rng(SEED)

# ----------------------------------------------------------------------------
# Harmony
# ----------------------------------------------------------------------------
A2, B2, C3, D3, E3, F2, G2, G3, A3, B3 = (
    110.00, 123.47, 130.81, 146.83, 164.81,
    87.31, 98.00, 196.00, 220.00, 246.94,
)

# (start_bar, n_bars, name, pad notes, root for sub, arp notes)
SEGMENTS = [
    (1, 2, "Am9",   [A2, C3, E3, G3, B3],        A2,    [A3, 261.63, 329.63, 392.00, 493.88]),
    (3, 2, "Fmaj7", [F2, A2, C3, E3],            F2,    [174.61, A3, 261.63, 329.63]),
    (5, 2, "Cmaj7", [C3, E3, G3, B3],            C3,    [261.63, 329.63, 392.00, 493.88]),
    (7, 2, "G6",    [G2, B2, D3, E3],            G2,    [392.00, 493.88, 587.33, 659.26]),
    (9, 2, "Am9",   [A2, C3, E3, G3, B3],        A2,    [440.00, 523.25, 659.26, 783.99, 987.77]),
    (11, 1, "Fmaj7", [F2, A2, C3, E3],           F2,    [349.23, 440.00, 523.25, 659.26]),
    (12, 1, "G6",   [G2, B2, D3, E3],            G2,    []),
]


def bar_time(bar: int) -> float:
    return (bar - 1) * BAR


# ----------------------------------------------------------------------------
# Tiny synth helpers
# ----------------------------------------------------------------------------
def saw(f: float, n: int, cents: float = 0.0, phase: float = 0.0) -> np.ndarray:
    """Naive saw; aliasing lives above the pad low-pass, acceptable here."""
    ff = f * 2.0 ** (cents / 1200.0)
    ph = (np.arange(n) * (ff / SR) + phase) % 1.0
    return 2.0 * ph - 1.0


def square(f: float, n: int, cents: float = 0.0, phase: float = 0.0) -> np.ndarray:
    ff = f * 2.0 ** (cents / 1200.0)
    ph = (np.arange(n) * (ff / SR) + phase) % 1.0
    return np.where(ph < 0.5, 1.0, -1.0)


def env_ar(n: int, attack: float, release: float) -> np.ndarray:
    e = np.ones(n)
    a = min(int(attack * SR), n)
    r = min(int(release * SR), n)
    if a > 0:
        e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, a))
    if r > 0:
        e[-r:] *= 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, r))
    return e


def add(buf: np.ndarray, start: float, sig: np.ndarray) -> None:
    s = int(round(start * SR))
    e = min(len(buf), s + len(sig))
    if s >= len(buf):
        return
    buf[s:e] += sig[: e - s]


def time_varying_lowpass(x: np.ndarray, keys, block: int = 2400) -> np.ndarray:
    """2nd-order Butterworth LP whose cutoff follows linear keyframes."""
    times = np.array([k[0] for k in keys], dtype=float)
    freqs = np.array([k[1] for k in keys], dtype=float)
    fc = np.interp(np.arange(len(x)) / SR, times, freqs)
    y = np.empty_like(x)
    zi = np.zeros((1, 2))
    for s in range(0, len(x), block):
        e = min(len(x), s + block)
        sos = signal.butter(2, min(float(fc[(s + e) // 2]), 0.45 * SR),
                            btype="lowpass", fs=SR, output="sos")
        y[s:e], zi = signal.sosfilt(sos, x[s:e], zi=zi)
    return y


# ----------------------------------------------------------------------------
# PAD: 3 detuned saws per note, wide stereo, slow filter opening
# ----------------------------------------------------------------------------
def render_pad() -> tuple[np.ndarray, np.ndarray]:
    left = np.zeros(N)
    right = np.zeros(N)
    lp_keys = [(0.0, 800), (8.0, 1500), (16.0, 2600), (20.0, 2200),
               (22.0, 2800), (24.0, 2800)]
    for start_bar, n_bars, _name, notes, _root, _arp in SEGMENTS:
        t0 = bar_time(start_bar)
        length = n_bars * BAR + 0.9  # release tail
        n = min(int(length * SR), N - int(t0 * SR))
        e = env_ar(n, attack=0.40, release=0.90)
        for f in notes:
            p = rng.random()
            for j, (cl, cr) in enumerate(zip((-6.4, -0.4, 6.4), (-5.6, 0.4, 5.6))):
                add(left, t0, e * 0.050 * saw(f, n, cl, p + 0.31 * j))
                add(right, t0, e * 0.050 * saw(f, n, cr, p + 0.31 * j + 0.37))
    left = time_varying_lowpass(left, lp_keys)
    right = time_varying_lowpass(right, lp_keys)
    # tame the naive-saw top end a touch more
    sos = signal.butter(2, 3200, btype="lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, left), signal.sosfilt(sos, right)


# ----------------------------------------------------------------------------
# SUB: sine an octave below chord root, bars 4-10 + bar 12
# ----------------------------------------------------------------------------
def render_sub() -> np.ndarray:
    sub = np.zeros(N)
    for start_bar, n_bars, _name, _notes, root, _arp in SEGMENTS:
        if start_bar < 4 or start_bar == 11:
            continue
        t0 = bar_time(start_bar)
        if start_bar == 12:
            n = min(int(1.6 * SR), N - int(t0 * SR))
            e = env_ar(n, attack=0.05, release=1.4)
            gain = 0.18
        else:
            n = min(int(n_bars * BAR * SR), N - int(t0 * SR))
            e = env_ar(n, attack=0.15, release=0.20)
            gain = 0.26
        t = np.arange(n) / SR
        add(sub, t0, gain * e * np.sin(2 * np.pi * (root / 2.0) * t))
    return sub


# ----------------------------------------------------------------------------
# KICK
# ----------------------------------------------------------------------------
def kick_hit(dur: float = 0.40, big: bool = False) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    if big:
        f = 34.0 + 40.0 * np.exp(-t / 0.06)
        amp = np.exp(-t / 0.42)
        click = 0.20 * np.exp(-t / 0.006) * rng.standard_normal(n)
    else:
        f = 45.0 + 50.0 * np.exp(-t / 0.025)
        amp = np.exp(-t / 0.075)
        click = 0.10 * np.exp(-t / 0.004) * rng.standard_normal(n)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * amp
    body[-1] = 0.0
    return body + click


def kick_times() -> list[float]:
    times: list[float] = []
    for bar in range(4, 11):  # bars 4..10 inclusive
        b0 = bar_time(bar)
        times += [b0 + 0.5 * k for k in range(4)]
    return times


def render_kick() -> np.ndarray:
    bus = np.zeros(N)
    for t0 in kick_times():
        add(bus, t0, 0.62 * kick_hit())
    add(bus, 22.0, 0.80 * kick_hit(dur=1.8, big=True))  # bar 12 downbeat
    return bus


# ----------------------------------------------------------------------------
# HATS: filtered noise, off-beat 8ths, seeded velocity
# ----------------------------------------------------------------------------
def render_hats() -> np.ndarray:
    bus = np.zeros(N)
    n = int(0.14 * SR)
    sos = signal.butter(2, 8000, btype="highpass", fs=SR, output="sos")
    for bar in range(1, 13):
        b0 = bar_time(bar)
        for k in range(4):
            t0 = b0 + 0.5 * k + EIGHTH
            if t0 >= DUR - 0.15:
                continue
            vel = 0.75 + 0.5 * rng.random()
            noise = rng.standard_normal(n)
            noise = signal.sosfilt(sos, noise)
            t = np.arange(n) / SR
            burst = noise * np.exp(-t / 0.012)  # ~35 ms audible decay
            burst[: int(0.001 * SR)] *= np.linspace(0, 1, int(0.001 * SR))
            burst[-1] = 0.0
            add(bus, t0, 0.055 * vel * burst)
    return bus


# ----------------------------------------------------------------------------
# PLUCK: saw+square 8th arpeggio, bars 7-11, ping-pong dotted-8th delay
# ----------------------------------------------------------------------------
def pluck_note(f: float, dur: float = 0.42) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = rng.random()
    osc = 0.65 * saw(f, n, 0.0, p) + 0.35 * square(f, n, 0.0, p)
    e = env_ar(n, attack=0.004, release=0.30)
    e *= np.exp(-t / 0.11)
    sos = signal.butter(2, 3600, btype="lowpass", fs=SR, output="sos")
    y = signal.sosfilt(sos, osc * e)
    y[-1] = 0.0
    return y


def render_pluck() -> np.ndarray:
    bus = np.zeros(N)
    pattern = [0, 1, 2, 3, 1, 2, 3, 2]
    for start_bar, n_bars, _name, _notes, _root, arp in SEGMENTS:
        if not arp or start_bar < 7:
            continue
        for b in range(n_bars):
            t_bar = bar_time(start_bar + b)
            for i in range(8):
                idx = pattern[i] % len(arp)
                add(bus, t_bar + i * EIGHTH, 0.16 * pluck_note(arp[idx]))
    # ping-pong: dotted-8th taps, alternating channels, 25 % feedback
    d = int(0.375 * SR)
    left = bus.copy() * 0.85
    right = bus.copy() * 0.85
    for k in range(1, 7):
        g = 0.38 * (0.25 ** (k - 1))
        tap = np.zeros(N)
        tap[k * d:] = bus[: N - k * d]
        if k % 2 == 1:
            right += g * tap
        else:
            left += g * tap
    return left, right


# ----------------------------------------------------------------------------
# RISER (bar 11) + IMPACT (bar 12)
# ----------------------------------------------------------------------------
def render_riser() -> tuple[np.ndarray, np.ndarray]:
    t0, length = 20.0, 2.0
    n = int(length * SR)
    t = np.arange(n) / SR
    sos = signal.butter(2, 2000, btype="highpass", fs=SR, output="sos")
    amp = 0.30 * (t / length) ** 2.4
    left = np.zeros(N)
    right = np.zeros(N)
    add(left, t0, signal.sosfilt(sos, rng.standard_normal(n)) * amp)
    add(right, t0, signal.sosfilt(sos, rng.standard_normal(n)) * amp)
    return left, right


def render_impact() -> tuple[np.ndarray, np.ndarray]:
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    f = 30.0 + 32.0 * np.exp(-t / 0.05)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.40)
    thump = rng.standard_normal(n) * np.exp(-t / 0.035) * 0.35
    sos = signal.butter(2, 700, btype="lowpass", fs=SR, output="sos")
    thump = signal.sosfilt(sos, thump)
    mono = np.tanh(1.8 * (boom + thump)) / 1.8
    mono[-1] = 0.0
    left = np.zeros(N)
    right = np.zeros(N)
    add(left, 22.0, 0.62 * mono)
    add(right, 22.0, 0.62 * mono)
    return left, right


# ----------------------------------------------------------------------------
# Sidechain ducking (pad+sub), ~3 dB per kick
# ----------------------------------------------------------------------------
def duck_env(times: list[float], depth_db: float = 3.0,
             tau: float = 0.11) -> np.ndarray:
    depth = 1.0 - 10.0 ** (-depth_db / 20.0)
    env = np.ones(N)
    for t0 in times:
        s = int(t0 * SR)
        n = min(int(0.35 * SR), N - s)
        if n <= 0:
            continue
        t = np.arange(n) / SR
        env[s:s + n] *= 1.0 - depth * np.exp(-t / tau)
    return env


# ----------------------------------------------------------------------------
# Arrangement + mix
# ----------------------------------------------------------------------------
def main() -> None:
    pad_l, pad_r = render_pad()
    sub = render_sub()
    kick = render_kick()
    hats = render_hats()
    pluck_l, pluck_r = render_pluck()
    riser_l, riser_r = render_riser()
    imp_l, imp_r = render_impact()

    duck = duck_env(kick_times())
    pad_l *= duck
    pad_r *= duck
    sub *= duck

    left = pad_l + sub + kick + hats + pluck_l + riser_l + imp_l
    right = pad_r + sub + kick + hats + pluck_r + riser_r + imp_r
    mix = np.stack([left, right], axis=1)

    # master chain: DC block -> gentle soft clip -> 1.5 s fade -> peak norm
    sos = signal.butter(2, 20, btype="highpass", fs=SR, output="sos")
    mix = signal.sosfilt(sos, mix, axis=0)
    mix = np.tanh(mix * CLIP_DRIVE) / np.tanh(CLIP_DRIVE)

    fade_start = DUR - 1.5
    n_fade = int(1.5 * SR)
    u = np.linspace(0.0, 1.0, n_fade)
    mix[-n_fade:] *= (0.5 + 0.5 * np.cos(np.pi * u))[:, None]
    mix = mix - mix.mean(axis=0)

    peak = float(np.max(np.abs(mix)))
    target = 10.0 ** (PEAK_TARGET_DBFS / 20.0)
    mix *= target / peak
    mix[0, :] *= np.linspace(0.0, 1.0, 8)[0]  # guard: first sample silent
    mix[-1, :] = 0.0

    pcm = np.clip(np.round(mix * 32767.0), -32768, 32767).astype(np.int16)
    assert pcm.shape == (N, 2), pcm.shape
    wavfile.write(OUT, SR, pcm)

    peak_db = 20 * np.log10(np.max(np.abs(pcm.astype(np.float64))) / 32768.0)
    dc = float(np.mean(pcm.astype(np.float64)))
    print(f"frames   : {pcm.shape[0]} ({pcm.shape[0] / SR:.3f} s)")
    print(f"peak     : {peak_db:.2f} dBFS")
    print(f"dc offset: {dc:.6f}")
    print(f"first    : {pcm[0].tolist()}  last: {pcm[-1].tolist()}")


if __name__ == "__main__":
    main()
