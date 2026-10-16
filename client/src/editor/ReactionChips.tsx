// Emoji reactions under a comment message (spec 20): a chip per emoji with its count, the user's
// own in the primary colours. On the active card a chip toggles the user's reaction and a last
// chip adds one; idle cards and All comments show the chips only.
import type { Reaction } from "@docs/shared";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { emojiName, loadedEmoji, loadEmoji } from "./emoji/emojiData.ts";

/** "You reacted with :grinning_face:", once the emoji names have loaded. */
function reactedText(reaction: Reaction): string {
  const name = emojiName(reaction.emoji);
  const label = name ? `:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}:` : reaction.emoji;
  return reaction.mine ? `You reacted with ${label}` : `Reacted with ${label}`;
}

type ReactionChipsProps = {
  reactions: Reaction[];
  /** Toggles the user's reaction; without it the chips are only shown. */
  onToggle?: (emoji: string, on: boolean) => void;
  /** Opens the emoji picker under the element (the "Add emoji reaction" chip). */
  onAdd?: (anchor: HTMLElement) => void;
};

export function ReactionChips({ reactions, onToggle, onAdd }: ReactionChipsProps) {
  // The tooltips name the emoji: their names come with the emoji data.
  const [, setNamesLoaded] = useState(() => loadedEmoji() !== null);
  useEffect(() => {
    if (!loadedEmoji()) void loadEmoji().then(() => setNamesLoaded(true));
  }, []);
  if (reactions.length === 0) return null;
  return (
    <div className="reaction-chips" role="group" aria-label="Reactions">
      {reactions.map((reaction) => {
        const className = `reaction-chip${reaction.mine ? " is-mine" : ""}`;
        const content = (
          <>
            <span className="reaction-chip-emoji">{reaction.emoji}</span>
            <span className="reaction-chip-count">{reaction.count}</span>
          </>
        );
        return onToggle ? (
          <button
            key={reaction.emoji}
            type="button"
            className={className}
            aria-pressed={reaction.mine}
            data-tooltip={reactedText(reaction)}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(reaction.emoji, !reaction.mine);
            }}
          >
            {content}
          </button>
        ) : (
          <span key={reaction.emoji} className={className} data-tooltip={reactedText(reaction)}>
            {content}
          </span>
        );
      })}
      {onAdd && (
        <button
          type="button"
          className="reaction-chip reaction-chip-add"
          aria-label="Add emoji reaction"
          data-tooltip="Add emoji reaction"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onAdd(event.currentTarget);
          }}
        >
          <Icon name="add_reaction" size={16} />
        </button>
      )}
    </div>
  );
}
