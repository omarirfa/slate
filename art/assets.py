"""Assets for the walkthrough. Two named characters plus the scenes they appear in."""
from vox import render, box
from models import *

# Amicia lends; Hugo borrows. Distinct silhouette, hair and palette so they are
# told apart at 36px, not only in a caption.
AMICIA  = dict(skin=1, hair=0, shirt=0, style="long")   # long dark hair, teal
HUGO = dict(skin=2, hair=2, shirt=2, style="crop")  # cropped fair hair, blue


def crop(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def avatar(who, scale=1):
    v = {}
    figure(v, 0, 0, height=3, **who)
    return crop(render(v, (200, 220), (86, 176), scale=scale))


def pair(scale=3):
    """Amicia and Hugo either side of the notched stick."""
    v = {}
    ground(v, -13, -5, 27, 14)
    figure(v, -10, -2, arm="right", **AMICIA)
    figure(v, 6, -2, arm="left", **HUGO)
    stick(v, -4, 4, -1, 9, [1, 4, 7])
    return crop(render(v, (430, 320), (215, 200), scale=scale))


def asking(scale=3):
    """One turned toward the other, who has not turned back — /problem."""
    v = {}
    ground(v, -12, -5, 25, 13)
    figure(v, -8, -1, arm="right", **AMICIA)
    figure(v, 5, -1, **HUGO)
    # The ask, hanging in the air between them and never answered. Raised clear
    # of both heads and spaced, or it reads as a smudge on somebody's face.
    # Screen-x is (x - z), so stepping z along with x cancels out and the dots
    # pile onto the nearest face. Vary x alone, at a fixed z, above both heads.
    for x in (-1, 1, 3):
        v[(x, 10, 1)] = ACCENT
    return crop(render(v, (430, 320), (215, 205), scale=scale))


def apart(scale=3):
    """Turned away, a half each, held clear of the body — /why-webmcp."""
    v = {}
    ground(v, -14, -5, 29, 14)
    figure(v, -10, -2, arm="left", **AMICIA)
    figure(v, 6, -2, arm="right", **HUGO)
    # A half each, set down on the ground in front of its owner. Placed at
    # x - z rather than beside them: in this projection a lower x drifts up and
    # left, so anything "beside" a figure lands on their head instead.
    stick(v, -12, 0, 5, 4, [1])
    stick(v, 5, 0, 6, 4, [2])
    return crop(render(v, (500, 330), (250, 205), scale=scale))


def desk(scale=3):
    v = {}
    ground(v, -10, -6, 22, 15)
    figure(v, -4, 1, height=4, **AMICIA)
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
        "avatar-amicia.png":  avatar(AMICIA, 1),
        "avatar-hugo.png": avatar(HUGO, 1),
        "hero-pair.png":     pair(3),
        "asking.png":        asking(3),
        "apart.png":         apart(3),
        "desk.png":          desk(3),
    }
    for n, im in out.items():
        im.save(os.path.join(out_dir, n))
        print(f"  {n:20} {im.size[0]}x{im.size[1]}")
