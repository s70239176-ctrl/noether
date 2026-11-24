"""Sentence timings for burned-in captions: asks the same neural voice for its sentence boundaries
(the audio itself is not re-rendered) and writes video/build/subs.json {scene: [[start, end, text], ...]}."""
import asyncio, json, pathlib, time
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent


async def boundaries(text, voice, rate):
    out = []
    async for ch in edge_tts.Communicate(text, voice, rate=rate).stream():
        if ch["type"] in ("SentenceBoundary", "WordBoundary"):
            out.append((ch["type"], ch["offset"] / 1e7, (ch["offset"] + ch["duration"]) / 1e7, ch["text"]))
    return out


def main():
    script = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    import sys
    only = set(sys.argv[1:])
    out = ROOT / "build" / "subs.json"
    res = json.loads(out.read_text(encoding="utf-8")) if only and out.exists() else {}
    for sc in script["scenes"]:
        if only and sc["id"] not in only:
            continue
        for attempt in range(6):
            try:
                b = asyncio.run(boundaries(sc["say"], script["voice"], script["rate"]))
                if b:
                    break
            except Exception as e:
                print("retry", e)
            time.sleep(3)
        res[sc["id"]] = [[round(s, 2), round(e, 2), t] for _, s, e, t in b]
        print(sc["id"], len(b), b[0][0] if b else None)
    out.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")


main()
