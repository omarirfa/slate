/**
 * Line-art people, in the Notion manner: monochrome, no fills, one stroke
 * weight throughout, and a lot of air around them. Nothing here carries
 * information the text does not — these exist to put two human beings on a
 * page about two human beings.
 *
 * Rules the whole file obeys, so the set reads as one hand:
 *   - every stroke is STROKE units wide, round cap, round join
 *   - no fill, ever; the paper shows through
 *   - colour is `currentColor`, so the caller decides and dark mode is free
 *   - features are suggested, never drawn: no eyes, no mouths, no hands
 *
 * Geometry is written in absolute scene coordinates rather than translated
 * blocks, because the point of every scene is where the hands land — on the
 * stick, or not on it — and that is too easy to lose behind a transform.
 */

const STROKE = 2;

/** Applied once on the wrapping <g> so no child can drift out of step. */
const INK = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: STROKE,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const R = 11; // head radius
const BASE = 96; // where every figure meets the floor of the frame

type Hair = 0 | 1 | 2 | 3;

/** Four heads, different enough to tell apart at avatar size. */
function Hair({ cx, cy, kind }: { cx: number; cy: number; kind: Hair }) {
  if (kind === 1) {
    // long, falling either side of the face
    return <path d={`M${cx - R} ${cy - 2} q-3 12 0 20 M${cx + R} ${cy - 2} q3 12 0 20`} />;
  }
  if (kind === 2) {
    // tied up
    return (
      <>
        <circle cx={cx} cy={cy - R - 4} r="4" />
        <path d={`M${cx - 9} ${cy - 7} q9 -7 18 0`} />
      </>
    );
  }
  if (kind === 3) {
    // curls across the crown
    return <path d={`M${cx - 10} ${cy - 6} a4 4 0 0 1 7 -4 a4 4 0 0 1 6 0 a4 4 0 0 1 7 4`} />;
  }
  // cropped: a cap sitting just proud of the skull
  return <path d={`M${cx - R - 2} ${cy - 3} a${R + 2} ${R + 2} 0 0 1 ${(R + 2) * 2} 0`} />;
}

/** Head and shoulders standing on BASE. The torso arc is what the arms leave from. */
function Figure({ cx, hair }: { cx: number; hair: Hair }) {
  const cy = BASE - 38; // head centre — low enough that the neck closes
  return (
    <>
      <circle cx={cx} cy={cy} r={R} />
      <Hair cx={cx} cy={cy} kind={hair} />
      {/* shoulders: an 18-radius arc closing down to the floor */}
      <path d={`M${cx - 18} ${BASE} v-6 a18 18 0 0 1 36 0 v6`} />
    </>
  );
}

/**
 * An arm from the shoulder arc to a given hand position. It starts at 45° on
 * the arc so it grows out of the body instead of being stuck beside it.
 */
function Arm({ cx, toX, toY }: { cx: number; toX: number; toY: number }) {
  const dir = toX > cx ? 1 : -1;
  const sx = cx + dir * 12.7;
  const sy = BASE - 6 - 12.7;
  const midX = (sx + toX) / 2;
  const midY = Math.max(sy, toY) + 7;
  return <path d={`M${sx} ${sy} Q${midX} ${midY} ${toX} ${toY}`} />;
}

export type Scene = "between" | "apart" | "asking";

const CAPTION: Record<Scene, string> = {
  between: "Two people either side of a notched stick, a hand each on their own end.",
  apart: "Two people turned away from one another, holding a half of the split stick each.",
  asking: "One person turned toward another, who has not turned back.",
};

export default function People({ scene = "between", className }: { scene?: Scene; className?: string }) {
  const L = 56;
  const Rt = 204;

  return (
    <svg viewBox="0 0 260 108" className={className} role="img" aria-label={CAPTION[scene]} preserveAspectRatio="xMidYMid meet">
      <g {...INK}>
        {scene === "between" && (
          <>
            <Figure cx={L} hair={1} />
            <Figure cx={Rt} hair={2} />
            <Arm cx={L} toX={102} toY={64} />
            <Arm cx={Rt} toX={158} toY={64} />
            {/* the stick their hands are both on, notched across it */}
            <path d="M100 64 h60" />
            <path d="M114 58 v12 M130 58 v12 M146 58 v12" />
          </>
        )}

        {scene === "apart" && (
          <>
            {/*
              Drawn closer together than the other scenes and still not
              touching: the gap is the subject. Each half is held out past the
              shoulder so it never crosses a body — a stick through a torso
              reads as a skewer, not as ownership.
            */}
            <Figure cx={78} hair={0} />
            <Figure cx={182} hair={3} />
            <Arm cx={78} toX={38} toY={86} />
            <Arm cx={182} toX={222} toY={86} />
            <path d="M14 86 h30 M23 80 v12 M34 80 v12" />
            <path d="M216 86 h30 M225 80 v12 M236 80 v12" />
          </>
        )}

        {scene === "asking" && (
          <>
            <Figure cx={96} hair={2} />
            <Figure cx={182} hair={1} />
            {/* one reaches across the gap; the other has both arms down */}
            <Arm cx={96} toX={132} toY={58} />
            {/* the ask, left hanging */}
            <path d="M140 52 h4 M150 52 h4 M160 52 h4" />
          </>
        )}
      </g>
    </svg>
  );
}

/* ----------------------------------------------------------- name avatars */

/** Same name, same face, on every device — no state, no storage. */
function hairFor(name: string): Hair {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return (h % 4) as Hair;
}

/** A small head and shoulders to sit beside a person's name. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="30 40 52 58" className={className} aria-hidden="true" focusable="false">
      <g {...INK}>
        <Figure cx={56} hair={hairFor(name)} />
      </g>
    </svg>
  );
}
