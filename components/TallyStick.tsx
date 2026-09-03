/**
 * The one image this app should have.
 *
 * A tally stick was a length of hazel notched across its width to record a
 * debt, then split lengthways so lender and borrower each kept a half. The
 * notches ran across the split, so neither half could be altered alone and
 * either half proved the other. That is exactly what a slate is, and it is
 * where the name comes from — so the drawing is the argument, not decoration.
 *
 * Everything is drawn from theme tokens, so it crosses light and dark with the
 * rest of the page and costs nothing to load.
 */

type Variant = "split" | "notches" | "paired";

/** Notch positions along the stick, in user units. */
const NOTCHES = [104, 148, 192, 236, 280, 324];

const W = 30; // thickness of one half
const LEFT = 52;
const RIGHT = 392;

/**
 * One half of the stick, drawn as a slab with a sawn end. `dir` is which way
 * the split face points: -1 for the upper half, +1 for the lower.
 */
function Half({ top, dir }: { top: number; dir: -1 | 1 }) {
  const bottom = top + W;
  const outer = dir === -1 ? top : bottom;
  const inner = dir === -1 ? bottom : top;
  const half = (inner - outer) / 2;
  return (
    <>
      <path
        d={`M${LEFT} ${outer} H${RIGHT} l16 ${half} l-16 ${half} H${LEFT} l-10 ${-half} z`}
        fill="var(--tally-face)"
        stroke="var(--tally-edge)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* A little grain, off-centre so it reads as wood rather than a bar. */}
      <path
        d={`M${LEFT + 26} ${top + W * 0.36} h118 M${LEFT + 188} ${top + W * 0.62} h150`}
        stroke="var(--tally-grain)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.45"
      />
    </>
  );
}

export default function TallyStick({
  variant = "split",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  // How many notches are cut, and how far apart the halves are drawn.
  const cut = variant === "notches" ? 2 : NOTCHES.length;
  const gap = variant === "paired" ? 36 : variant === "split" ? 26 : 16;

  const mid = 60;
  const topY = mid - gap / 2 - W;
  const botY = mid + gap / 2;

  const label =
    variant === "notches"
      ? "A tally stick with two of its six notches cut, and four still to spend."
      : variant === "paired"
        ? "The two halves of a split tally stick, held apart — one for each person."
        : "A tally stick split lengthways, its notches running across both halves.";

  return (
    <svg viewBox="0 0 440 120" className={className} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <Half top={topY} dir={-1} />
      <Half top={botY} dir={1} />

      {/*
        Each notch is cut through both halves at the same position, so a notch
        only exists if the two halves agree — which is the whole point, and the
        reason neither half can be altered alone. A cut notch is inked through
        the wood; an uncut one is only lightly scored.
      */}
      {NOTCHES.map((x, i) => {
        const isCut = i < cut;
        const stroke = isCut ? "var(--tally-notch)" : "var(--tally-grain)";
        const width = isCut ? 3 : 1.25;
        return (
          <g key={x} strokeLinecap="round">
            <line x1={x} y1={topY + 2} x2={x} y2={topY + W - 2} stroke={stroke} strokeWidth={width} />
            <line x1={x} y1={botY + 2} x2={x} y2={botY + W - 2} stroke={stroke} strokeWidth={width} />
            {/* Carried across the gap, faintly: the alignment is the proof. */}
            {isCut && (
              <line
                x1={x}
                y1={topY + W}
                x2={x}
                y2={botY}
                stroke={stroke}
                strokeWidth="1"
                strokeDasharray="1.5 3"
                opacity="0.55"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
