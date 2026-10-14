import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../components/Icon.tsx";

type HomeHeaderProps = {
  query: string;
  onQueryChange: (query: string) => void;
  templatesShown: boolean;
  onTemplatesShownChange: (shown: boolean) => void;
};

/** The 64px header: main menu, logo and name, and the search pill. */
export function HomeHeader({ query, onQueryChange, templatesShown, onTemplatesShownChange }: HomeHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="home-header">
      <div className="home-header-start">
        <button
          type="button"
          className="icon-button home-menu-button"
          aria-label="Main menu"
          data-tooltip="Main menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" size={24} />
        </button>
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={30} height={40} />
          <span>Docs</span>
        </Link>
      </div>
      <div className="search" role="search">
        <Icon name="search" size={24} />
        <input
          type="search"
          placeholder="Search"
          aria-label="Search documents"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            data-tooltip="Clear search"
            onClick={() => onQueryChange("")}
          >
            <Icon name="close" size={24} />
          </button>
        )}
      </div>
      {menuOpen && (
        <MainMenu
          templatesShown={templatesShown}
          onTemplatesShownChange={onTemplatesShownChange}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </header>
  );
}

type MainMenuProps = {
  templatesShown: boolean;
  onTemplatesShownChange: (shown: boolean) => void;
  onClose: () => void;
};

/** A drawer from the left with the document list and the home screen's settings. */
function MainMenu({ templatesShown, onTemplatesShownChange, onClose }: MainMenuProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="home-drawer"
      aria-label="Main menu"
      onCancel={onClose}
      // A click on the scrim lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="home-drawer-brand">
        <img src="/favicon.svg" alt="" width={30} height={40} />
        <span>Docs</span>
      </div>
      <nav aria-label="Apps">
        <Link to="/" className="home-drawer-item" aria-current="page" onClick={onClose}>
          <Icon name="description" size={24} className="document-icon" />
          Docs
        </Link>
      </nav>
      <div className="home-drawer-separator" />
      <label className="home-drawer-item home-drawer-setting">
        <input type="checkbox" checked={templatesShown} onChange={(event) => onTemplatesShownChange(event.target.checked)} />
        Show templates on the home screen
      </label>
    </dialog>
  );
}
