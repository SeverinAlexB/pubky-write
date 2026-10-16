import { documentTemplates, type DocumentTemplate } from "@pubky-write/shared";
import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { PagePreview } from "./PagePreview.tsx";

const PREVIEW_WIDTH = 142;

type TemplatesBandProps = {
  /** Creates a document from a template, or a blank one without. */
  onCreate: (template?: DocumentTemplate) => void;
  onHide: () => void;
};

/** "Start a new document": the blank document and the built-in templates. */
export function TemplatesBand({ onCreate, onHide }: TemplatesBandProps) {
  const [expanded, setExpanded] = useState(false);
  const blank = <BlankTile key="blank" onCreate={() => onCreate()} />;
  const tile = (template: DocumentTemplate) => <TemplateTile key={template.id} template={template} onCreate={() => onCreate(template)} />;

  return (
    <section className={`templates-band${expanded ? " is-expanded" : ""}`} aria-labelledby="start-heading">
      <div className="home-column">
        <div className="templates-header">
          <h2 id="start-heading">Start a new document</h2>
          <button type="button" className="template-gallery-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            Template gallery
            <Icon name={expanded ? "unfold_less" : "unfold_more"} size={20} />
          </button>
          <Menu
            label={<Icon name="more_vert" />}
            buttonClassName="icon-button"
            ariaLabel="Template options"
            align="end"
            entries={[{ label: "Hide all templates", onSelect: onHide }]}
          />
        </div>
        {expanded ? (
          (["Recently used", "Personal", "Work"] as const).map((category) => (
            <div key={category} className="template-category">
              <h3>{category}</h3>
              <ul className="template-row" aria-label={category}>
                {category === "Recently used" ? blank : documentTemplates.filter((template) => template.category === category).map(tile)}
              </ul>
            </div>
          ))
        ) : (
          <ul className="template-row" aria-label="Templates">
            {blank}
            {documentTemplates.map(tile)}
          </ul>
        )}
      </div>
    </section>
  );
}

function BlankTile({ onCreate }: { onCreate: () => void }) {
  return (
    <li>
      <button type="button" className="template-tile" onClick={onCreate}>
        <span className="template-preview template-preview-blank">
          <svg viewBox="0 0 48 48" width={64} height={64} aria-hidden>
            <path d="M22 8h4v14h14v4H26v14h-4V26H8v-4h14z" fill="currentColor" />
          </svg>
        </span>
        <span className="template-name">Blank document</span>
      </button>
    </li>
  );
}

function TemplateTile({ template, onCreate }: { template: DocumentTemplate; onCreate: () => void }) {
  return (
    <li>
      <button type="button" className="template-tile" onClick={onCreate}>
        <span className="template-preview">
          <PagePreview content={template.content} width={PREVIEW_WIDTH} />
        </span>
        <span className="template-name">{template.name}</span>
        <span className="template-subtitle">{template.subtitle}</span>
      </button>
    </li>
  );
}
