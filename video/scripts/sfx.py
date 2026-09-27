"""
Sound effects for the film → public/sfx/*.wav

Every sound is synthesized here from noise, sine sweeps and envelopes, so
there are no samples to license. Nothing is melodic: whooshes, taps, clicks,
a low swell and airy textures only (the film has no music).

    pip install numpy
    npm run sfx
"""
import os
import wave

import numpy as np

SR = 48000
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "sfx")
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def env(n, attack, release, curve=3.0):
    """Attack/release envelope over n samples (times in seconds)."""
    a = max(1, int(attack * SR))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a) ** 2
    r = max(1, n - a)
    e[a:] = np.exp(-curve * np.linspace(0, 1, r)) * (1 - np.linspace(0, 1, r) ** 4)
    return e


def biquad(x, kind, freq, q=0.707):
    """RBJ biquad; `freq` may be a per-sample array (time-varying, updated per block)."""
    freq = np.broadcast_to(np.asarray(freq, dtype=float), x.shape)
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    block = 64
    for start in range(0, len(x), block):
        f = min(max(freq[start], 20.0), SR * 0.45)
        w0 = 2 * np.pi * f / SR
        alpha = np.sin(w0) / (2 * q)
        cos = np.cos(w0)
        if kind == "lp":
            b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
        elif kind == "hp":
            b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        else:  # band-pass, constant peak gain
            b = [alpha, 0.0, -alpha]
        a0, a1, a2 = 1 + alpha, -2 * cos, 1 - alpha
        b0, b1, b2 = b[0] / a0, b[1] / a0, b[2] / a0
        a1, a2 = a1 / a0, a2 / a0
        for i in range(start, min(start + block, len(x))):
            xn = x[i]
            yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, xn, y1, yn
            y[i] = yn
    return y


def room(x, size=0.9, mix=0.22):
    """Soft synthetic room: decaying filtered-noise impulse, FFT convolution."""
    n = int(size * SR)
    ir = rng.standard_normal(n) * np.exp(-6.5 * np.linspace(0, 1, n))
    ir = biquad(ir, "lp", 5200)
    ir /= np.sqrt((ir**2).sum())
    size_fft = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size_fft) * np.fft.rfft(ir, size_fft), size_fft)[: len(x) + n]
    dry = np.concatenate([x, np.zeros(n)])
    return dry * (1 - mix) + wet * mix * 1.6


def pan(x, position):
    """Equal-power pan; `position` in -1 … 1, scalar or per-sample."""
    p = np.broadcast_to(np.asarray(position, dtype=float), x.shape)
    angle = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(angle), x * np.sin(angle)], axis=1)


def save(name, x, peak_db=-4.0):
    if x.ndim == 1:
        x = pan(x, 0.0)
    fade = min(len(x), int(0.01 * SR))
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (peak_db / 20)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print(f"sfx/{name}.wav  {len(x) / SR:.2f}s")


# ── Sounds ───────────────────────────────────────────────────────────────


def whoosh(sec=0.95, lo=280, hi=3200, peak=0.42, width=0.8):
    """Air past the camera: band-passed noise sweeping up then down, panning across."""
    t = t_axis(sec)
    shape = np.where(t < peak, (t / peak) ** 1.5, np.exp(-4 * (t - peak) / (sec - peak)))
    freq = lo + (hi - lo) * shape
    # Swept low-pass (4th order) for the body, a softer resonant band on top: warm, not hissy.
    body = biquad(biquad(noise(sec), "lp", freq * 1.4), "lp", freq * 1.4)
    edge = biquad(biquad(noise(sec), "bp", freq, q=1.6), "lp", freq * 2.0)
    x = body + 0.45 * edge + 0.3 * biquad(noise(sec), "lp", 380)
    x *= shape**1.2 * env(len(t), 0.02, 0.3, 0.5)
    st = pan(x, np.linspace(-width, width, len(t)))
    return np.stack([room(st[:, 0], 0.7, 0.18), room(st[:, 1], 0.7, 0.18)], axis=1)


def swell(sec=1.6):
    """A rising breath of filtered noise that lands on the next beat."""
    t = t_axis(sec)
    rise = (t / sec) ** 2.4
    x = biquad(noise(sec), "lp", 300 + 5000 * rise) * rise
    x += 0.4 * biquad(noise(sec), "bp", 900 + 2600 * rise, q=2.0) * rise
    x[-int(0.03 * SR) :] *= np.linspace(1, 0, int(0.03 * SR))
    return room(x, 1.0, 0.25)


def boom(sec=2.8):
    """A deep, soft impact: a falling sub sine with a felt body of low noise."""
    t = t_axis(sec)
    f = 44 + 70 * np.exp(-t * 7)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.9)
    body = biquad(noise(sec), "lp", 180) * np.exp(-t * 5) * 0.6
    thump = biquad(noise(sec), "lp", 900) * np.exp(-t * 40) * 0.5
    x = sub + body + thump
    x *= env(len(t), 0.004, 1.0, 0.1)
    return room(x, 1.6, 0.3)


def shimmer(sec=1.3):
    """Airy high sparkle: fluttering high-passed noise, no pitch."""
    t = t_axis(sec)
    flutter = 0.6 + 0.4 * np.sin(2 * np.pi * 13 * t) * np.sin(2 * np.pi * 3.1 * t)
    x = biquad(noise(sec), "hp", 7000) * flutter
    x *= env(len(t), 0.25, 0.8, 2.5)
    st = pan(x, np.sin(2 * np.pi * 0.6 * t) * 0.7)
    return np.stack([room(st[:, 0], 1.2, 0.35), room(st[:, 1], 1.2, 0.35)], axis=1)


def click(sec=0.09, tone=2600):
    """A crisp interface click: a tiny filtered transient with a short body."""
    t = t_axis(sec)
    x = biquad(noise(sec), "bp", tone, q=1.4) * np.exp(-t * 180)
    x += 0.5 * np.sin(2 * np.pi * (tone * 0.42) * t) * np.exp(-t * 120)
    return room(x, 0.25, 0.12)


def tap(sec=0.07):
    """A soft key tap."""
    t = t_axis(sec)
    x = biquad(noise(sec), "bp", 1500, q=1.0) * np.exp(-t * 220)
    x += 0.6 * biquad(noise(sec), "lp", 350) * np.exp(-t * 90)
    return room(x, 0.25, 0.1)


def pop(sec=0.16):
    """A rounded pop for things that appear (a quick downward blip, not a note)."""
    t = t_axis(sec)
    f = 340 + 520 * np.exp(-t * 55)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 34)
    x += 0.2 * biquad(noise(sec), "bp", 3000, q=1.2) * np.exp(-t * 300)
    return room(x, 0.35, 0.14)


def scan(sec=0.9):
    """A light electronic sweep for a scan line passing over an image."""
    t = t_axis(sec)
    freq = 1800 + 5200 * (t / sec)
    x = biquad(biquad(noise(sec), "bp", freq, q=6.0), "lp", 9000)
    x *= np.sin(np.pi * t / sec) ** 1.5
    st = pan(x, np.linspace(-0.4, 0.4, len(t)))
    return np.stack([room(st[:, 0], 0.5, 0.2), room(st[:, 1], 0.5, 0.2)], axis=1)


def crunch(sec=0.32):
    """Digital pixel crunch: sample-and-hold noise, stepped down in rate."""
    t = t_axis(sec)
    n = len(t)
    held = np.repeat(rng.standard_normal(n // 180 + 1), 180)[:n]
    x = biquad(biquad(held, "bp", 1400, q=0.8), "lp", 3200) * env(n, 0.005, 0.25, 4)
    x += 0.25 * biquad(biquad(noise(sec), "hp", 3000), "lp", 7000) * np.exp(-t * 30)
    return room(x, 0.4, 0.15)


def latch(sec=0.35):
    """A lock closing: two small mechanical clacks."""
    t = t_axis(sec)
    x = np.zeros(len(t))
    for at, gain, tone in ((0.0, 0.8, 1800), (0.055, 1.0, 1100)):
        i = int(at * SR)
        seg = t_axis(sec - at)
        c = biquad(noise(sec - at), "bp", tone, q=2.2) * np.exp(-seg * 160)
        c += 0.5 * biquad(noise(sec - at), "lp", 260) * np.exp(-seg * 60)
        x[i:] += gain * c
    return room(x, 0.3, 0.12)


def rush(sec=2.2):
    """A long, low rush of air under the image wall speeding up."""
    t = t_axis(sec)
    shape = np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 1.4
    x = biquad(noise(sec), "lp", 500 + 2200 * shape) * shape
    st = pan(x, np.linspace(-0.5, 0.5, len(t)))
    return np.stack([room(st[:, 0], 1.0, 0.2), room(st[:, 1], 1.0, 0.2)], axis=1)


def main():
    save("whoosh", whoosh())
    save("whoosh-soft", whoosh(0.6, 400, 2400, 0.25, 0.4), -8)
    save("swell", swell())
    save("boom", boom(), -2)
    save("shimmer", shimmer(), -10)
    save("click", click())
    save("tick", click(0.06, 4200), -8)
    save("tap", tap(), -6)
    save("pop", pop(), -6)
    save("scan", scan(), -10)
    save("crunch", crunch(), -8)
    save("latch", latch(), -4)
    save("rush", rush(), -6)


if __name__ == "__main__":
    main()
