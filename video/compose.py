"""Edits the Noether demo: one clip per scene at exactly headPad + voiceover + tailPad, live footage cut from
the real testnet recording by its event marks, burned-in captions, and the final mix (voice, effects, music).

    python video/compose.py            -> video/out/noether-demo.mp4
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import wave

import imageio_ffmpeg
import numpy as np

import audio

ROOT = pathlib.Path(__file__).resolve().parent
B = ROOT / "build"
FF = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 30
FONT = "font.ttf"  # Segoe UI Bold, copied into build/txt (ffmpeg runs there, so no drive-letter colons)

script = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
dur = json.loads((B / "durations.json").read_text())
subs = json.loads((B / "subs.json").read_text(encoding="utf-8"))
HEAD, TAIL = script["headPad"], script["tailPad"]

# Live scenes: segments of the real testnet recordings, as (source, mark, offset, length, stamp_since). length None runs
# to the end of the recording. stamp_since adds a "T+n s" real-time stamp, counted from that mark, so a viewer always
# knows how much real time has passed wherever footage was cut (e.g. while Hyperlane's relayer delivers).
SOURCES = {  # recording -> the marks where the timeline jumped to a new section (used to calibrate render lag)
    "live": ["s06_dash", "s06_map", "s07_console", "s07_dash", "s08_console", "s08_dash", "s08_map", "s09_dossier", "s10_cover", "s11_scorer"],
    "map": ["mapB", "console"],
    "mapn": ["mapN"],
}
LIVE = {
    "s06_dashboard": {"tag": "LIVE  ·  Base Sepolia  ·  Unichain Sepolia  ·  Reactive Lasna",
                      "segs": [("live", "s07_dash", 0.4, 8.6, None), ("mapn", "mapN", 0.8, 8.8, None)]},
    "s07_honest": {"tag": "LIVE  ·  honest transfer of 1,000 dUSD, Base to Unichain",
                   "segs": [("live", "s07_click", -1.2, 6.2, "s07_click"), ("live", "s07_delivered", -2.5, 8.6, "s07_click")]},
    "s08_attack": {"tag": "LIVE  ·  forged 1,000,000 mint with a stolen relayer key",
                   "segs": [("live", "s08_arm", -1.0, None, "s08_fire"), ("live", "s08_dash", 0.4, 6.0, "s08_fire"), ("map", "mapB", 0.8, 7.0, None)]},
    "s09_dossier": {"tag": "LIVE  ·  incident dossier, rebuilt from on-chain timestamps",
                    "segs": [("live", "s09_dossier", 0.4, 6.5, None), ("live", "s09_copycat", -1.5, 7.0, None)]},
    "s10_cover": {"tag": "LIVE  ·  cover pool on Base Sepolia", "segs": [("live", "s10_cover", 0.4, 13.4, None)]},
    "s11_ai": {"tag": "LIVE  ·  the neural scorer, same integer weights as react()", "segs": [("live", "s11_honest", -1.5, None, None)]},
}
SEG_END = {("live", "s08_arm"): ("s08_breached", 2.5)}  # the attack shot runs until the ledger has flipped


def run(args: list[str], cwd=None) -> None:
    r = subprocess.run([FF, "-y", "-loglevel", "error", *args], cwd=cwd)
    if r.returncode:
        raise SystemExit(f"ffmpeg failed: {' '.join(map(str, args))[:400]}")


def probe(path: pathlib.Path) -> float:
    out = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = out.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def text_file(name: str, text: str) -> str:
    p = B / "txt" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return name


def scene_length(sid: str) -> float:
    return HEAD + dur[sid] + TAIL


def card_clip(sid: str, out: pathlib.Path) -> None:
    L = scene_length(sid)
    src = B / "clips" / f"{sid}.mp4"
    run(["-i", str(src), "-vf", f"tpad=stop_mode=clone:stop_duration=2,trim=duration={L:.3f},setpts=PTS-STARTPTS,"
         f"fade=t=in:st=0:d=0.25,fade=t=out:st={L - 0.25:.3f}:d=0.25,fps={FPS},format=yuv420p",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-an", str(out)])


class Source:
    """A raw recording plus a mark-time -> video-time map. The page can render behind the wall clock (more so as
    events pile up), so each section jump is matched to the scene cut it caused and the lag is interpolated."""

    def __init__(self, name: str):
        self.path = B / "raw" / f"{name}.mp4"
        meta = json.loads((B / "raw" / f"{name}.mp4.marks.json").read_text())
        self.marks, self.length = meta["marks"], meta["length"]
        cache = B / "raw" / f"{name}.cuts.json"
        if cache.exists():
            cuts = json.loads(cache.read_text())
        else:
            err = subprocess.run([FF, "-hide_banner", "-i", str(self.path), "-vf", "scale=320:-1,select='gt(scene,0.12)',showinfo",
                                  "-f", "null", "-"], capture_output=True, text=True).stderr
            cuts = [float(x.split(":")[1]) for x in err.split() if x.startswith("pts_time:")]
            cache.write_text(json.dumps(cuts))
        pts = [(0.0, 0.0)]
        for m in SOURCES[name]:
            t = self.marks[m]
            hit = [c for c in cuts if t - 0.2 <= c <= t + 6]
            if hit:
                pts.append((t, hit[0]))
        self.cal = sorted(pts)
        print(f"  {name}: lag " + ", ".join(f"{a:.0f}s:+{b - a:.1f}" for a, b in self.cal[1:]))

    def v(self, t: float) -> float:
        xs, ys = [a for a, _ in self.cal], [b - a for a, b in self.cal]
        return t + float(np.interp(t, xs, ys))


_sources: dict = {}


def source(name: str) -> Source:
    if name not in _sources:
        _sources[name] = Source(name)
    return _sources[name]


def live_clip(sid: str, out: pathlib.Path) -> None:
    spec = LIVE[sid]
    L = scene_length(sid)
    names = list(dict.fromkeys(seg[0] for seg in spec["segs"]))
    windows = []
    for src, mark, off, ln, since in spec["segs"]:
        S = source(src)
        start = S.v(S.marks[mark] + off)
        if (src, mark) in SEG_END:
            m2, o2 = SEG_END[(src, mark)]
            ln = S.v(S.marks[m2] + o2) - start
        if ln is None:
            ln = S.length - start - 0.3
        stamp0 = (S.marks[mark] + off) - S.marks[since] if since else None
        windows.append((names.index(src), start, min(ln, S.length - start), stamp0))
    total = sum(w[2] for w in windows)
    speed = min(max(total / L, 0.66), 2.2)
    print(f"  {sid}: {len(windows)} segments, {total:.1f}s of footage -> {L:.1f}s (x{speed:.2f})")
    tag = text_file(f"{sid}_tag.txt", spec["tag"])
    fc, parts = [], []
    for k in range(len(names)):
        idx = [i for i, w in enumerate(windows) if w[0] == k]
        fc.append(f"[{k}:v]split={len(idx)}" + "".join(f"[r{i}]" for i in idx))
    for i, (_, s, ln, stamp0) in enumerate(windows):
        z = 0.045
        chain = (f"[r{i}]trim=start={s:.3f}:duration={ln:.3f},setpts=PTS-STARTPTS,tmix=frames=5:weights='1 2 3 2 1',"
                 f"scale=w='trunc(1920*(1+{z}*t/{ln:.3f})/2)*2':h=-2:eval=frame:flags=bicubic,crop=1920:1080,setsar=1")
        if stamp0 is not None:
            stamp = "T+%{eif\\:max(0\\," + f"t+{stamp0:.2f}" + ")\\:d} s"
            chain += (f",drawtext=fontfile='{FONT}':text='{stamp}':x=w-tw-60:y=60:fontsize=32:"
                      f"fontcolor=white:box=1:boxcolor=0x2086ff@0.9:boxborderw=14")
        chain += f"[p{i}]"
        fc.append(chain)
        parts.append(f"[p{i}]")
    fc.append("".join(parts) + f"concat=n={len(parts)}:v=1:a=0,setpts=PTS/{speed:.4f},fps={FPS},"
              f"tpad=stop_mode=clone:stop_duration=6,trim=duration={L:.3f},setpts=PTS-STARTPTS,"
              f"drawtext=fontfile='{FONT}':textfile='{tag}':x=74:y=60:fontsize=30:fontcolor=white:box=1:boxcolor=0x01040e@0.8:boxborderw=16,"
              f"drawbox=x=44:y=44:w=10:h=66:color=0xff4d5e@1:t=fill,"
              f"fade=t=in:st=0:d=0.25,fade=t=out:st={L - 0.25:.3f}:d=0.25,format=yuv420p[v]")
    fcs = B / "txt" / f"{sid}.fc"
    fcs.write_text(";\n".join(fc), encoding="utf-8")
    inputs = []
    for n in names:
        inputs += ["-i", str(source(n).path)]
    font = B / "txt" / FONT
    if not font.exists():
        font.write_bytes(pathlib.Path("C:/Windows/Fonts/segoeuib.ttf").read_bytes())
    run([*inputs, "-filter_complex_script", fcs.name, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(out)],
        cwd=B / "txt")


def chunks(start: float, end: float, text: str, limit: int = 64) -> list[tuple[float, float, str]]:
    """Splits a sentence into caption-sized pieces at punctuation, timing each by its share of characters."""
    if len(text) <= limit:
        return [(start, end, text)]
    words, pieces, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > limit:
            pieces.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
        if cur.endswith((",", ":", ";")) and len(cur) > limit * 0.45:
            pieces.append(cur)
            cur = ""
    if cur:
        pieces.append(cur)
    total = sum(len(p) for p in pieces)
    out, t = [], start
    for p in pieces:
        d = (end - start) * len(p) / total
        out.append((t, t + d, p))
        t += d
    return out


def ass_time(t: float) -> str:
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def write_ass(starts: dict[str, float]) -> pathlib.Path:
    lines = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
        "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Cap,Segoe UI,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H500E0401,-1,0,0,0,100,100,0,0,3,14,0,2,200,200,46,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for sid, t0 in starts.items():
        for s, e, text in subs[sid]:
            for cs, ce, ct in chunks(s, e, text):
                a, b = t0 + HEAD + cs, t0 + HEAD + ce - 0.02
                lines.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Cap,,0,0,0,,{{\\fad(120,120)}}{ct}")
    p = B / "captions.ass"
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def read_wav(path: pathlib.Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
        return x.reshape(-1, w.getnchannels()).mean(axis=1)


def main() -> None:
    import sys
    only = set(sys.argv[1:])
    if only:  # preview individual scenes: python video/compose.py s08_attack
        (B / "scenes").mkdir(parents=True, exist_ok=True)
        for sid in only:
            (live_clip if sid in LIVE else card_clip)(sid, B / "scenes" / f"{sid}.mp4")
        return
    scenes_dir = B / "scenes"
    scenes_dir.mkdir(parents=True, exist_ok=True)

    starts, t = {}, 0.0
    files = []
    for sc in script["scenes"]:
        sid = sc["id"]
        out = scenes_dir / f"{sid}.mp4"
        print(sid)
        import os
        keep = os.environ.get("REUSE") and out.exists() and sid not in os.environ.get("REBUILD", "").split(",")
        if keep:  # REUSE=1 REBUILD=a,b re-renders only the listed scenes
            pass
        elif sc["type"] == "card":
            card_clip(sid, out)
        else:
            live_clip(sid, out)
        starts[sid] = t
        t += scene_length(sid)
        files.append(out)
    total = t

    lst = B / "scenes.txt"
    lst.write_text("\n".join(f"file '{f.as_posix()}'" for f in files), encoding="utf-8")
    run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(B / "picture.mp4")])

    # sound: voice at each scene's headPad, cues relative to the voice (t >= 0) or to the scene's end (t < 0)
    vo, fx = [], []
    sfx_cache: dict[str, np.ndarray] = {}
    for sc in script["scenes"]:
        sid = sc["id"]
        vo.append((starts[sid] + HEAD, read_wav(B / "vo" / f"{sid}.wav")))
        end = starts[sid] + scene_length(sid)
        for name, at in sc.get("sfx", []):
            w = sfx_cache.setdefault(name, audio.SFX[name]())
            fx.append((starts[sid] + HEAD + at if at >= 0 else end + at, w))
    print(f"mixing {total:.1f}s of audio")
    mixed = audio.mix(total, vo, fx)
    wav_out = B / "mix.wav"
    with wave.open(str(wav_out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(audio.SR)
        w.writeframes(mixed.tobytes())

    ass = write_ass(starts)
    out = ROOT / "out" / "noether-demo.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    fonts = B / "fonts"  # libass gets the caption font from here (ffmpeg runs in build/, so paths stay relative)
    fonts.mkdir(exist_ok=True)
    for f in ("segoeui.ttf", "segoeuib.ttf"):
        if not (fonts / f).exists():
            (fonts / f).write_bytes(pathlib.Path("C:/Windows/Fonts", f).read_bytes())
    run(["-i", "picture.mp4", "-i", "mix.wav", "-vf", f"subtitles={ass.name}:fontsdir=fonts",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)], cwd=B)
    print(f"wrote {out} ({probe(out):.1f}s)")


if __name__ == "__main__":
    main()
