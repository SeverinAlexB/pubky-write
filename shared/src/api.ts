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
