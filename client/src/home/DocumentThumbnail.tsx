import type { DocumentSummary } from "@pubky-write/shared";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { PagePreview } from "./PagePreview.tsx";

/** Previews already loaded, by document and modification time, so going back to the list draws them at once. */
const loaded = new Map<string, JSONContent>();

/** Shared by all tiles: one observer is cheaper than one per tile with hundreds of documents. */
let observer: IntersectionObserver | null = null;
const onVisible = new Map<Element, () => void>();

function observe(element: Element, callback: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        onVisible.get(entry.target)?.();
        observer!.unobserve(entry.target);
        onVisible.delete(entry.target);
      }
    },
    // Start loading a little before tiles scroll into view.
    { rootMargin: "300px 0px" },
  );
  onVisible.set(element, callback);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    onVisible.delete(element);
  };
}

/** The thumbnail of a document tile; its content is fetched once the tile is near the viewport. */
export function DocumentThumbnail({ document, width }: { document: DocumentSummary; width: number }) {
  const key = `${document.id}:${document.updatedAt}`;
  const [content, setContent] = useState<JSONContent | null>(() => loaded.get(key) ?? null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded.has(key)) {
      setContent(loaded.get(key)!);
      return;
    }
    let cancelled = false;
    const stop = observe(box.current!, () => {
      api.getPreview(document.id, document.updatedAt).then(
        (preview) => {
          loaded.set(key, preview.content);
          if (!cancelled) setContent(preview.content);
        },
        // Without a preview the tile stays a blank page.
        () => {},
      );
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [key, document.id, document.updatedAt]);

  return (
    <div ref={box} className="document-thumbnail">
      {content && <PagePreview content={content} width={width} />}
    </div>
  );
}
