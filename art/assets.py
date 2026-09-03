"""Assets for the walkthrough. Two named characters plus the scenes they appear in."""
from vox import render, box
from models import *

# Priya lends; Marcus borrows. Distinct silhouette, hair and palette so they are
# told apart at 36px, not only in a caption.
PRIYA  = dict(skin=1, hair=0, shirt=0, style="long")   # long dark hair, teal
MARCUS = dict(skin=2, hair=2, shirt=2, style="crop")  # cropped fair hair, blue


def crop(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def avatar(who, scale=1):
    v = {}
    figure(v, 0, 0, height=3, **who)
    return crop(render(v, (200, 220), (86, 176), scale=scale))


def pair(scale=3):
    """Priya and Marcus either side of the notched stick."""
    v = {}
    ground(v, -13, -5, 27, 14)
    figure(v, -10, -2, arm="right", **PRIYA)
    figure(v, 6, -2, arm="left", **MARCUS)
    stick(v, -4, 4, -1, 9, [1, 4, 7])
    return crop(render(v, (430, 320), (215, 200), scale=scale))


def desk(scale=3):
    v = {}
    ground(v, -10, -6, 22, 15)
    figure(v, -4, 1, height=4, **PRIYA)
    box(v, -3, 0, -4, 10, 3, 4, DESK)
    box(v, -1, 3, -3, 5, 1, 2, PAPER)
    for x in range(0, 3):
        v[(x, 4, -3)] = ACCENT
    box(v, 5, 3, -3, 1, 3, 3, INK)
    return crop(render(v, (420, 320), (200, 210), scale=scale))


if __name__ == "__main__":
    import os
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "art")
    os.makedirs(out_dir, exist_ok=True)
    out = {
        "avatar-priya.png":  avatar(PRIYA, 1),
        "avatar-marcus.png": avatar(MARCUS, 1),
        "hero-pair.png":     pair(3),
        "desk.png":          desk(3),
    }
    for n, im in out.items():
        im.save(os.path.join(out_dir, n))
        print(f"  {n:20} {im.size[0]}x{im.size[1]}")
