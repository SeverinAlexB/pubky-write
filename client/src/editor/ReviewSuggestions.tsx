// Tools > Review suggested edits: a card at the top right of the editor area that steps through
// the suggestions, previews accepting or rejecting all of them, and accepts or rejects them.
import type { Suggestion } from "@pubky-write/shared";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import type { SuggestionView } from "./suggesting.ts";

const views: { view: SuggestionView; label: string }[] = [
  { view: "suggestions", label: "Show suggested edits" },
  { view: "accepted", label: "Preview accept all" },
  { view: "rejected", label: "Preview reject all" },
];

type ReviewSuggestionsProps = {
  suggestions: Suggestion[];
  activeId: string | null;
  view: SuggestionView;
  onViewChange: (view: SuggestionView) => void;
  /** Makes a suggestion active and scrolls to it. */
  onSelect: (id: string) => void;
  onResolve: (action: "accept" | "reject", id: string | null) => void;
  onClose: () => void;
};

export function ReviewSuggestions({ suggestions, activeId, view, onViewChange, onSelect, onResolve, onClose }: ReviewSuggestionsProps) {
  const count = suggestions.length;
  const index = suggestions.findIndex((suggestion) => suggestion.id === activeId);
  const current = index >= 0 ? suggestions[index]! : suggestions[0];

  const go = (direction: 1 | -1) => {
    if (count === 0) return;
    const next = index < 0 ? (direction > 0 ? 0 : count - 1) : (index + direction + count) % count;
    onSelect(suggestions[next]!.id);
  };

  /** Accepts or rejects the selected suggestion and selects the one after it. */
  const resolveCurrent = (action: "accept" | "reject") => {
    if (!current) return;
    const position = suggestions.indexOf(current);
    const following = suggestions[position + 1] ?? (position > 0 ? suggestions[0] : undefined);
    onResolve(action, current.id);
    if (following && following.id !== current.id) onSelect(following.id);
  };

  return (
    <div
      className="find-bar review-card"
      role="dialog"
      aria-label="Suggested edits"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="review-header">
        <h2 className="review-title">Suggested edits</h2>
        <button
          type="button"
          className="icon-button find-button"
          aria-label="Previous"
          data-tooltip="Previous"
          disabled={count === 0}
          onClick={() => go(-1)}
        >
          <Icon name="keyboard_arrow_up" />
        </button>
        <button
          type="button"
          className="icon-button find-button"
          aria-label="Next"
          data-tooltip="Next"
          disabled={count === 0}
          onClick={() => go(1)}
        >
          <Icon name="keyboard_arrow_down" />
        </button>
        <button type="button" className="icon-button find-button" aria-label="Close" data-tooltip="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <Menu
        label={
          <>
            <span>{views.find((candidate) => candidate.view === view)!.label}</span>
            <Icon name="arrow_drop_down" />
          </>
        }
        buttonClassName="review-view-button"
        entries={views.map((candidate) => ({
          label: candidate.label,
          checked: candidate.view === view,
          onSelect: () => onViewChange(candidate.view),
        }))}
      />
      <div className="review-actions">
        <div className="split-button is-outlined">
          <button type="button" className="split-button-main" disabled={!current} onClick={() => resolveCurrent("reject")}>
            Reject
          </button>
          <Menu
            label={<Icon name="arrow_drop_down" />}
            ariaLabel="More reject options"
            buttonClassName="split-button-arrow"
            align="end"
            disabled={count === 0}
            entries={[{ label: `Reject all (${count})`, onSelect: () => onResolve("reject", null) }]}
          />
        </div>
        <div className="split-button is-filled">
          <button type="button" className="split-button-main" disabled={!current} onClick={() => resolveCurrent("accept")}>
            Accept
          </button>
          <Menu
            label={<Icon name="arrow_drop_down" />}
            ariaLabel="More accept options"
            buttonClassName="split-button-arrow"
            align="end"
            disabled={count === 0}
            entries={[{ label: `Accept all (${count})`, onSelect: () => onResolve("accept", null) }]}
          />
        </div>
      </div>
    </div>
  );
}
