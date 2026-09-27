"""
Word timings for the narration → src/data/alignment.json

Forced alignment with PocketSphinx (its English model ships inside the pip
package, so nothing is downloaded): the known transcript is aligned to the
recording, giving the start and end of every word. The one recording is then
split into scenes at the pauses between them; a scene re-recorded on its own
(public/voice/scenes/<id>.wav) replaces its part.

    pip install pocketsphinx
    npm run align
"""
import io
import json
import os
import re
import subprocess
import sys
import wave

from pocketsphinx import Decoder

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
COMPOSITOR = os.path.join(ROOT, "node_modules", "@remotion", "compositor-linux-x64-gnu")
FRAME_SEC = 0.01  # PocketSphinx frames are 10 ms

# Words missing from the CMU dictionary.
EXTRA_PRONUNCIATIONS = {
    "safesearch": "S EY F S ER CH",
    "pixelate": "P IH K S AH L EY T",
    "passcode": "P AE S K OW D",
}


def spoken_tokens(text):
    """Display tokens (with punctuation and markup) → one per spoken word."""
    tokens = []
    for line_index, line in enumerate(text.split("|")):
        for raw in line.split():
            emphasis = raw.startswith("*") or raw.endswith("*") or raw.rstrip(".,").endswith("*")
            display = raw.replace("*", "")
            word = re.sub(r"[^a-z']", "", display.lower())
            tokens.append({"text": display, "word": word, "line": line_index, "em": emphasis})
    return tokens


def pcm16k(path):
    """16 kHz mono PCM. Remotion's ffmpeg has no raw muxer, so go through WAV."""
    ffmpeg = os.path.join(COMPOSITOR, "ffmpeg")
    env = dict(os.environ, LD_LIBRARY_PATH=COMPOSITOR)
    data = subprocess.run(
        [ffmpeg, "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "-"],
        check=True,
        capture_output=True,
        env=env,
    ).stdout
    with wave.open(io.BytesIO(data), "rb") as clip:
        return clip.readframes(clip.getnframes())


def duration(path):
    with wave.open(path, "rb") as clip:
        return clip.getnframes() / clip.getframerate()


def align(decoder, audio, words):
    decoder.set_align_text(" ".join(words))
    decoder.start_utt()
    decoder.process_raw(audio, full_utt=True)
    decoder.end_utt()
    return [
        (seg.word, seg.start_frame * FRAME_SEC, (seg.end_frame + 1) * FRAME_SEC)
        for seg in decoder.seg()
        if seg.word not in ("<s>", "</s>", "<sil>", "[NOISE]")
    ]


def check(scene_id, tokens, segments):
    names = [re.sub(r"\(\d+\)$", "", s[0]) for s in segments]
    expected = [t["word"] for t in tokens]
    if names != expected:
        sys.exit(f"{scene_id}: alignment failed\n  expected {expected}\n  got      {names}")


def main():
    with open(os.path.join(ROOT, "narration.json")) as f:
        narration = json.load(f)
    decoder = Decoder(samprate=16000, loglevel="FATAL")
    for word, phones in EXTRA_PRONUNCIATIONS.items():
        decoder.add_word(word, phones, True)

    voice = os.path.join(ROOT, "public", "voice")
    full = os.path.join(voice, "full.wav")
    if not os.path.exists(full):
        sys.exit("public/voice/full.wav is missing (run npm run voice)")
    per_scene = [spoken_tokens(scene["text"]) for scene in narration["scenes"]]
    for tokens in per_scene:
        missing = [t["word"] for t in tokens if decoder.lookup_word(t["word"]) is None]
        if missing:
            sys.exit(f"No pronunciation for {missing}; add them to EXTRA_PRONUNCIATIONS")

    all_tokens = [t for tokens in per_scene for t in tokens]
    segments = align(decoder, pcm16k(full), [t["word"] for t in all_tokens])
    check("full", all_tokens, segments)
    full_duration = duration(full)

    # Split the one recording into scenes at the pauses between them.
    bounds, index = [], 0
    for tokens in per_scene:
        bounds.append(segments[index : index + len(tokens)])
        index += len(tokens)

    scenes = []
    for i, (scene, tokens) in enumerate(zip(narration["scenes"], per_scene)):
        override = os.path.join(voice, "scenes", f"{scene['id']}.wav")
        if os.path.exists(override):
            # Re-recorded on its own (npm run voice -- --scene=<id>).
            segs = align(decoder, pcm16k(override), [t["word"] for t in tokens])
            check(scene["id"], tokens, segs)
            src, start, end = f"voice/scenes/{scene['id']}.wav", 0.0, duration(override)
            start = max(0.0, segs[0][1] - 0.12)
            end = min(end, segs[-1][2] + 0.3)
        else:
            segs = bounds[i]
            prev_end = bounds[i - 1][-1][2] if i > 0 else 0.0
            next_start = bounds[i + 1][0][1] if i + 1 < len(bounds) else full_duration
            src = "voice/full.wav"
            start = max(prev_end, segs[0][1] - 0.12)
            end = min(next_start, segs[-1][2] + 0.3)
        words = [
            {
                **{k: t[k] for k in ("text", "line", "em")},
                "start": round(s[1] - start, 3),
                "end": round(s[2] - start, 3),
            }
            for t, s in zip(tokens, segs)
        ]
        scenes.append(
            {"id": scene["id"], "src": src, "from": round(start, 3), "duration": round(end - start, 3), "words": words}
        )
        timing = "  ".join(f"{w['text']}@{w['start']:.2f}" for w in words)
        print(f"{scene['id']:8} {end - start:5.2f}s  {timing}")

    out = os.path.join(ROOT, "src", "data", "alignment.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump({"scenes": scenes}, f, indent=1)
        f.write("\n")
    print(f"→ {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    main()
