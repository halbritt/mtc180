"""Crop an animated GIF to the union bounding box of all non-background pixels across frames."""
from pathlib import Path
import shutil
import sys
import numpy as np
from PIL import Image


def main():
    gif_path = Path(sys.argv[1])
    im = Image.open(gif_path)
    n = im.n_frames
    durations, rgb_frames = [], []
    bg_ref = None
    x0, y0, x1, y1 = 10**9, 10**9, 0, 0

    for i in range(n):
        im.seek(i)
        durations.append(im.info.get("duration", 55))
        fr = im.convert("RGB")
        rgb_frames.append(fr)
        arr = np.asarray(fr, dtype=np.int16)
        if bg_ref is None:
            bg_ref = arr[0, 0]
        ys, xs = np.where(np.abs(arr - bg_ref).max(axis=2) > 10)
        if len(xs) > 0:
            x0, y0 = min(x0, int(xs.min())), min(y0, int(ys.min()))
            x1, y1 = max(x1, int(xs.max())), max(y1, int(ys.max()))

    w, h = rgb_frames[0].size
    pad = 38
    cx0, cy0 = max(0, x0 - pad), max(0, y0 - pad)
    cx1, cy1 = min(w, x1 + pad), min(h, y1 + pad)
    cropped = [
        fr.crop((cx0, cy0, cx1, cy1)).quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        for fr in rgb_frames
    ]
    cropped[0].save(gif_path, save_all=True, append_images=cropped[1:], duration=durations, loop=0, optimize=True)
    for extra in sys.argv[2:]:
        shutil.copy2(gif_path, extra)


if __name__ == "__main__":
    main()
