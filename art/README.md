# Voxel art

The illustrations in `public/art/` are generated, not drawn. To change or add
one, edit these and re-run:

    python3 art/assets.py        # writes into public/art/

- `vox.py`     — the isometric renderer. Cubes as three rhombi at three shades,
                 painter's algorithm for occlusion, nearest-upscaled so the
                 pixel grid stays crisp.
- `models.py`  — the figure builder and the palette. `figure()` takes skin,
                 hair, shirt, height, style and an optional reaching arm.
- `assets.py`  — the cast (Amicia, Hugo) and the scenes they appear in.

Only two vertical faces of a cube are visible in this projection: +z
(screen-left) and +x (screen-right). Anything meant to be seen — eyes, a mouth,
a notch — must sit on the outermost layer of one of those, or it is buried
inside the solid.

Amicia and Hugo differ in silhouette, not only palette. At 28px colour alone
does not separate two characters; an outline does.
