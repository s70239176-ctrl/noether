"""Sound design for the Noether demo: every effect and the music bed are synthesized here (no samples, no
licensing). Also builds the final stereo mix: voiceover + effects + ducked ambient bed.
"""
from __future__ import annotations

import numpy as np

SR = 48000
rng = np.random.default_rng(11)


def _t(sec: float) -> np.ndarray:
    return np.arange(int(sec * SR)) / SR


def _env(n: int, attack: float, release: float) -> np.ndarray:
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r) ** 2
    return e


def _lp(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole low-pass. Fixed cutoff: FFT convolution with the filter's exponential impulse response
    (fast on long tracks). Array cutoff (sweeps, short sounds only): per-sample recursion."""
    if np.ndim(cutoff) == 0:
        a = np.exp(-2 * np.pi * float(cutoff) / SR)
        taps = int(min(len(x), max(8, 6 / (1 - a))))
        h = (1 - a) * a ** np.arange(taps)
        n = len(x) + taps - 1
        size = 1 << (n - 1).bit_length()
        return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(h, size), size)[: len(x)]
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def _norm(x: np.ndarray, peak: float) -> np.ndarray:
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def whoosh(d: float = 1.1) -> np.ndarray:
    t = _t(d)
    n = rng.standard_normal(len(t))
    sweep = 300 + 5200 * np.sin(np.pi * t / d) ** 2
    return _norm(_lp(n, sweep) * np.sin(np.pi * t / d) ** 1.5, 0.35)


def riser(d: float = 2.6) -> np.ndarray:
    t = _t(d)
    f = 110 * (2 ** (3 * t / d))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.5 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.25
    noise = _lp(rng.standard_normal(len(t)), 800 + 6000 * t / d) * 0.4
    return _norm((tone + noise) * (t / d) ** 2 * _env(len(t), 0.01, 0.05), 0.3)


def ping(freq: float = 1320) -> np.ndarray:
    t = _t(0.9)
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t * 7) + 0.3 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-t * 11)
    return _norm(x * _env(len(t), 0.002, 0.1), 0.22)


def tick() -> np.ndarray:
    t = _t(0.09)
    x = np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 90) + 0.4 * rng.standard_normal(len(t)) * np.exp(-t * 160)
    return _norm(x, 0.16)


def click() -> np.ndarray:
    t = _t(0.12)
    x = np.sin(2 * np.pi * 900 * t) * np.exp(-t * 70) + 0.6 * rng.standard_normal(len(t)) * np.exp(-t * 220)
    return _norm(x, 0.28)


def chime() -> np.ndarray:
    t = _t(2.4)
    x = np.zeros_like(t)
    for f, a, k in [(1046.5, 1.0, 2.2), (1318.5, 0.6, 2.6), (1568.0, 0.45, 3.0), (2093.0, 0.25, 4.0)]:
        x += a * np.sin(2 * np.pi * f * t) * np.exp(-t * k)
    return _norm(x * _env(len(t), 0.004, 0.3), 0.24)


def impact() -> np.ndarray:
    t = _t(2.0)
    f = 55 * np.exp(-t * 2.5) + 32
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    crack = _lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 18)
    return _norm(body + 0.5 * crack, 0.6)


def glitch() -> np.ndarray:
    t = _t(0.8)
    x = rng.standard_normal(len(t))
    x = np.round(x * 3) / 3  # bit-crush
    gate = (np.sin(2 * np.pi * 23 * t) > 0.2).astype(float)
    tone = np.sign(np.sin(2 * np.pi * 180 * t)) * 0.4
    return _norm((x * 0.5 + tone) * gate * _env(len(t), 0.005, 0.15), 0.25)


def alarm(d: float = 2.2, soft: bool = False) -> np.ndarray:
    t = _t(d)
    f = np.where((t * 4).astype(int) % 2 == 0, 880, 660)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = np.tanh(2.2 * x) * _env(len(t), 0.02, 0.4)
    return _norm(_lp(x, 3000), 0.12 if soft else 0.24)


def denied() -> np.ndarray:
    t = _t(0.55)
    f = np.where(t < 0.22, 330, 220)
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.5 + np.sin(2 * np.pi * np.cumsum(f) / SR)
    return _norm(_lp(x, 1800) * _env(len(t), 0.005, 0.08), 0.26)


def freeze() -> np.ndarray:
    t = _t(1.8)
    x = np.zeros_like(t)
    for f in [2637, 3136, 3951, 4699, 5274]:
        x += np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t * (2 + rng.random() * 2))
    shimmer = _lp(rng.standard_normal(len(t)), 9000) * np.exp(-t * 6) * 0.6
    crack = rng.standard_normal(len(t)) * np.exp(-t * 60) * 0.8
    return _norm((x * 0.4 + shimmer + crack) * _env(len(t), 0.002, 0.4), 0.3)


def swell(d: float = 5.5) -> np.ndarray:
    t = _t(d)
    x = np.zeros_like(t)
    for f in [130.81, 196.0, 261.63, 329.63, 392.0]:
        x += np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return _norm(x * np.sin(np.pi * t / d) ** 2, 0.22)


SFX = {
    "whoosh": whoosh,
    "riser": riser,
    "ping": ping,
    "tick": tick,
    "click": click,
    "chime": chime,
    "impact": impact,
    "glitch": glitch,
    "alarm": alarm,
    "alarm_soft": lambda: alarm(1.6, soft=True),
    "denied": denied,
    "freeze": freeze,
    "swell": swell,
}


def music_bed(total: float) -> np.ndarray:
    """Slow ambient pad: A minor - F - C - G, detuned saw-ish voices through a soft low-pass, with a pulse."""
    chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 261.63, 329.63], [196.0, 246.94, 293.66]]
    bar = 8.0
    t = _t(total)
    out = np.zeros_like(t)
    for i in range(int(np.ceil(total / bar))):
        s, e = int(i * bar * SR), min(len(t), int((i + 1) * bar * SR) + int(0.6 * SR))
        seg = t[: e - s]
        voice = np.zeros_like(seg)
        for f in chords[i % 4]:
            for det in (-0.6, 0.0, 0.6):
                ph = 2 * np.pi * (f + det) * seg
                voice += np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
            voice += 0.5 * np.sin(2 * np.pi * f / 2 * seg)
        env = np.minimum(1, seg / 1.5) * np.minimum(1, (seg[-1] - seg + 1e-9) / 1.5)
        out[s:e] += voice * env
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * t)
    pulse = 0.92 + 0.08 * np.sin(2 * np.pi * 1.0 * t) ** 8
    out = _lp(out * lfo * pulse, 1400)
    return _norm(out, 0.11)


def mix(total: float, vo: list[tuple[float, np.ndarray]], fx: list[tuple[float, np.ndarray]]) -> np.ndarray:
    """Returns int16 stereo. Music ducks ~9 dB under the voice."""
    n = int(total * SR)
    voice = np.zeros(n)
    for at, w in vo:
        s = int(at * SR)
        voice[s : s + len(w)] += w[: max(0, n - s)]
    effects = np.zeros(n)
    for at, w in fx:
        s = max(0, int(at * SR))
        effects[s : s + len(w)] += w[: max(0, n - s)]
    bed = music_bed(total)
    # sidechain-style duck: envelope follower on the voice
    env = _lp(np.abs(voice), 6.0)
    duck = 1.0 - 0.65 * np.clip(env / (np.max(env) * 0.25 + 1e-9), 0, 1)
    master = voice * 1.0 + effects * 0.9 + bed * duck
    master = np.tanh(master * 1.15) * 0.9
    fade = np.ones(n)
    k = int(1.2 * SR)
    fade[:k] = np.linspace(0, 1, k)
    fade[-k:] = np.linspace(1, 0, k)
    master *= fade
    # gentle stereo width: tiny delay on the bed/effects in the right channel
    left = master
    right = np.concatenate([np.zeros(int(0.007 * SR)), master[: -int(0.007 * SR)]]) * 0.25 + master * 0.75
    stereo = np.stack([left, right], axis=1)
    return (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
