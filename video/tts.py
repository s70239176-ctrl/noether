"""Voiceover: renders each scene's narration with a neural voice (edge-tts) and records its duration.

    python video/tts.py            -> video/build/vo/<scene>.wav and video/build/durations.json
"""
import asyncio
import json
import pathlib
import subprocess
import time

import edge_tts
import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parent
BUILD = ROOT / "build" / "vo"
FF = imageio_ffmpeg.get_ffmpeg_exe()


def duration(path: pathlib.Path) -> float:
    out = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = out.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


async def render(text: str, voice: str, rate: str, mp3: pathlib.Path) -> None:
    for attempt in range(6):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(str(mp3))
            if mp3.stat().st_size > 1000:
                return
        except Exception as e:  # network hiccups
            print(f"  retry {attempt + 1}: {e}")
        time.sleep(4)
    raise RuntimeError(f"TTS failed for {mp3.name}")


def main() -> None:
    script = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    BUILD.mkdir(parents=True, exist_ok=True)
    import sys
    only = set(sys.argv[1:])  # re-render just these scenes: python video/tts.py s10_cover
    dpath = ROOT / "build" / "durations.json"
    durations = json.loads(dpath.read_text()) if only and dpath.exists() else {}
    for sc in script["scenes"]:
        if only and sc["id"] not in only:
            continue
        mp3 = BUILD / f"{sc['id']}.mp3"
        wav = BUILD / f"{sc['id']}.wav"
        asyncio.run(render(sc["say"], script["voice"], script["rate"], mp3))
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(mp3), "-ar", "48000", "-ac", "2", str(wav)], check=True)
        durations[sc["id"]] = round(duration(wav), 3)
        print(f"{sc['id']}: {durations[sc['id']]:.2f}s")
    dpath.write_text(json.dumps(durations, indent=2))
    print("total narration:", round(sum(durations.values()), 1), "s")


if __name__ == "__main__":
    main()
