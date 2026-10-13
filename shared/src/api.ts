// Request and response shapes of the HTTP API. Timestamps are Unix milliseconds.
import type { JSONContent } from "@tiptap/core";

export type DocumentSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};

export type DocumentSort = "lastOpened" | "lastModified" | "title";

export type OpenedDocument = DocumentSummary & {
  version: number;
  content: JSONContent;
  /** Comment anchors are positions in `content` at `version`. */
  comments: CommentThread[];
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
};

export type RevisionWithContent = Revision & { content: JSONContent };

export type UploadResponse = { url: string };
