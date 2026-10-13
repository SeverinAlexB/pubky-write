// Where the cards of the comment margin go: each card wants the top of its anchor's line,
// cards never overlap, and the active card sits exactly at its anchor.

/** Space between stacked cards, in pixels. */
export const CARD_GAP = 8;

export type CardBox<Key> = {
  key: Key;
  /** The top of the line with the start of the commented text, in margin coordinates. */
  anchorTop: number;
  height: number;
};

/**
 * Card tops for `cards`, which must be in document order. Cards after the active one (or all
 * cards if none is active) are pushed down to keep `CARD_GAP` between them; cards before the
 * active one move up when they would reach into it.
 */
export function layoutCards<Key>(cards: CardBox<Key>[], activeKey: Key | null, gap = CARD_GAP): Map<Key, number> {
  const tops = cards.map((card) => card.anchorTop);
  const active = cards.findIndex((card) => card.key === activeKey);
  const start = Math.max(active, 0);

  // Downwards from the active card (or the first card).
  for (let i = start + 1; i < cards.length; i++) {
    tops[i] = Math.max(tops[i]!, tops[i - 1]! + cards[i - 1]!.height + gap);
  }
  if (active > 0) {
    // The cards above keep their own stacking, then move up out of the active card's way.
    for (let i = 1; i < active; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + cards[i - 1]!.height + gap);
    for (let i = active - 1; i >= 0; i--) tops[i] = Math.min(tops[i]!, tops[i + 1]! - gap - cards[i]!.height);
  }
  return new Map(cards.map((card, i) => [card.key, tops[i]!]));
}
