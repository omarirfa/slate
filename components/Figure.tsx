/**
 * The generated voxel art (see art/), as components.
 *
 * `width` and `height` are the assets' real pixel dimensions. Giving both lets
 * the browser reserve the right box before the image loads, so nothing on the
 * page jumps; `height: auto` in CSS keeps the ratio as the width scales down to
 * the column. Every asset is at least twice its display size, so none upscale.
 */

const SCENES = {
  pair: { src: "/art/hero-pair.png", w: 741, h: 525,
    alt: "Amicia and Hugo either side of a notched stick, a hand each on their own end." },
  asking: { src: "/art/asking.png", w: 687, h: 480,
    alt: "One person turned toward another, who has not turned back; the ask hangs unanswered between them." },
  apart: { src: "/art/apart.png", w: 777, h: 534,
    alt: "Two people turned away from one another, a half of the split stick on the ground in front of each." },
  desk: { src: "/art/desk.png", w: 669, h: 408,
    alt: "A person at a desk with an open ledger." },
} as const;

export type Scene = keyof typeof SCENES;

export default function Figure({ scene, className }: { scene: Scene; className?: string }) {
  const s = SCENES[scene];
  return <img className={className} src={s.src} width={s.w} height={s.h} alt={s.alt} />;
}

/**
 * A small head-and-shoulders for a party. Keyed on role rather than on the
 * typed-in name: the two characters are the lender and the borrower, and a
 * slate can be opened between any two names.
 */
const CAST = {
  lender: { src: "/art/avatar-amicia.png", w: 73, h: 79 },
  borrower: { src: "/art/avatar-hugo.png", w: 61, h: 76 },
} as const;

export function Avatar({ role, className }: { role: "lender" | "borrower"; className?: string }) {
  const a = CAST[role];
  // Decorative: the name it belongs to is always the next thing read.
  return <img className={className} src={a.src} width={a.w} height={a.h} alt="" aria-hidden="true" />;
}
