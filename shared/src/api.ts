// Request and response shapes of the HTTP API. Timestamps are Unix milliseconds.
import type { JSONContent } from "@tiptap/core";

export type DocumentSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};

export type CreateDocumentRequest = {
  title?: string;
  /** Paper size of the new document, chosen from the user's locale (see defaultPaperSize). */
  paperSize?: string;
  /** Page settings saved with "Set as default" in Page setup (see pageSetup.ts); invalid values are ignored. */
  pageSetup?: Record<string, unknown>;
  /** Starts from a built-in template (see templates.ts); the title defaults to the template's name. */
  template?: string;
};

/** "Last modified by me" and "Last modified" are the same order while there is one user. */
export type DocumentSort = "lastOpened" | "lastModifiedByMe" | "lastModified" | "title";

/** The top of a document's first page, for its thumbnail in the document list. */
export type DocumentPreview = { content: JSONContent };

/** POST /api/documents/import: the new document and the kinds of content that could not be converted. */
export type ImportResponse = { document: DocumentSummary; dropped: string[] };

export type OpenedDocument = DocumentSummary & {
  version: number;
  content: JSONContent;
  /** Comment anchors are positions in `content` at `version`. */
  comments: CommentThread[];
  /** Replies on suggestions, by suggestion id (the suggestions themselves are in `content`). */
  suggestionReplies: Record<string, CommentMessage[]>;
};

export type CommentMessage = {
  id: number;
  body: string;
  createdAt: number;
};

export type CommentThread = {
  id: number;
  /** Anchor range; `from === to` means the commented text was deleted. */
  from: number;
  to: number;
  quote: string;
  resolved: boolean;
  createdAt: number;
  messages: CommentMessage[];
};

/** Positions are in the document at `version`, which must be the server's current version. */
export type CreateCommentRequest = {
  version: number;
  from: number;
  to: number;
  body: string;
};

/** A batch of ProseMirror steps (as JSON) built on top of `version`. */
export type SubmitStepsRequest = {
  clientId: string;
  version: number;
  steps: unknown[];
};

export type SubmitStepsResponse = { version: number };

/** Returned with status 409 when `version` is behind the server. */
export type StepsConflictResponse = {
  version: number;
  steps: unknown[];
  clientIds: string[];
};

export type Revision = {
  id: number;
  version: number;
  startedAt: number;
  endedAt: number;
  restoredFrom: number | null;
  /** Given with "Name this version"; null for unnamed versions. */
  name: string | null;
};

export type RevisionWithContent = Revision & { content: JSONContent };

export type UploadResponse = { url: string };
