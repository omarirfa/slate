#!/usr/bin/env bash
# Builds a captioned MP4 and a GIF from the captured frames.
set -euo pipefail

cd "$(dirname "$0")"
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
FPS=6

# Caption bar: dark strip along the bottom, text in mono.
# Ranges match the shot() hold counts in film.mjs.
build_filter() {
python3 - <<'PY'
segments = [
    (0,   13,  "A loan between two friends. The terms are capabilities, not text."),
    (14,  21,  "Terms proposed  -  the other half now owes an answer"),
    (22,  27,  "One half signed. Nobody can sign for the other."),
    (28,  41,  "Both halves signed  -  the schedule starts"),
    (42,  57,  "A payment goes overdue  -  send-reminder registers itself"),
    (58,  69,  "One reminder sent. One left this month."),
    (70,  91,  "Budget spent  -  send-reminder is torn off the page"),
    (92,  103, "A third reminder is REFUSED. The tool no longer exists."),
    (104, 125, "Marcus asks for time  -  grant and decline appear on Priya"),
    (126, 135, "declare-default REFUSED  -  an unanswered request blocks it"),
    (136, 151, "Granted  -  both answers unregister"),
    (152, 169, "Light theme by default, dark on demand"),
]
font = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
parts = ["drawbox=x=0:y=ih-64:w=iw:h=64:color=0x1a1614@0.94:t=fill"]
for a, b, text in segments:
    safe = text.replace("\\", "").replace(":", "\\:").replace("'", "")
    parts.append(
        f"drawtext=fontfile={font}:text='{safe}':"
        f"fontcolor=0xF2EDE6:fontsize=21:x=(w-text_w)/2:y=h-42:"
        f"enable='between(n,{a},{b})'"
    )
print(",".join(parts))
PY
}

FILTER="$(build_filter)"

echo "· building mp4"
ffmpeg -y -loglevel error -framerate $FPS -i frames/%03d.png \
  -vf "$FILTER,scale=1360:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart \
  slate-demo.mp4

echo "· building gif palette"
ffmpeg -y -loglevel error -framerate $FPS -i frames/%03d.png \
  -vf "$FILTER,scale=1000:-2:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
  palette.png

echo "· building gif"
ffmpeg -y -loglevel error -framerate $FPS -i frames/%03d.png -i palette.png \
  -lavfi "$FILTER,scale=1000:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 slate-demo.gif

ls -la slate-demo.mp4 slate-demo.gif
