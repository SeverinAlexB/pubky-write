import {
  defaultPaperSize,
  type CommentMessage,
  type CommentThread,
  type CreateCommentRequest,
  type CreateDocumentRequest,
  type DocumentPreview,
  type DocumentSort,
  type DocumentSummary,
  type ImportResponse,
  type OpenedDocument,
  type Revision,
  type RevisionWithContent,
  type StepsConflictResponse,
  type UploadResponse,
} from "@pubky-write/shared";
import { storedPageSetupDefaults } from "./pageSetupDefaults.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined;
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.error ?? response.statusText);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  listDocuments: (options: { query?: string; sort?: DocumentSort }) => {
    const params = new URLSearchParams();
    if (options.query) params.set("q", options.query);
    if (options.sort) params.set("sort", options.sort);
    return request<DocumentSummary[]>(`/api/documents?${params}`);
  },
  /**
   * Creates a blank document, or one from a built-in template, on the paper size used in the
   * user's locale and with the page setup saved as the default, if any.
   */
  createDocument: (options: { title?: string; template?: string } = {}) =>
    request<DocumentSummary>("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        ...options,
        paperSize: defaultPaperSize(navigator.language),
        pageSetup: storedPageSetupDefaults(),
      } satisfies CreateDocumentRequest),
    }),
  /** Converts a Word or Markdown file into a new document. */
  importDocument: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("paperSize", defaultPaperSize(navigator.language));
    return request<ImportResponse>("/api/documents/import", { method: "POST", body: form });
  },
  /** `updatedAt` makes the URL change with the document, so the browser may cache each preview. */
  getPreview: (id: string, updatedAt: number) =>
    request<DocumentPreview>(`/api/documents/${id}/preview?v=${updatedAt}`),
  /** The title of a web page, fetched by the server; null when it has none or cannot be read. */
  linkTitle: async (url: string) => (await request<{ title: string | null }>(`/api/link-preview?url=${encodeURIComponent(url)}`)).title,
  /** The server's steps after `since`, for restoring edits kept in the browser. */
  stepsSince: (id: string, since: number) => request<StepsConflictResponse>(`/api/documents/${id}/steps?since=${since}`),
  /** Ends another editor session whose kept edits this one restores; the steps after `since`. */
  endSession: (id: string, clientId: string, since: number) =>
    request<StepsConflictResponse>(`/api/documents/${id}/sessions/${encodeURIComponent(clientId)}/end`, {
      method: "POST",
      body: JSON.stringify({ since }),
    }),
  /** Copies an image from the web into the uploads (for pasted images). */
  uploadRemoteImage: (url: string) => request<UploadResponse>("/api/uploads/remote", { method: "POST", body: JSON.stringify({ url }) }),
  copyDocument: (id: string) => request<DocumentSummary>(`/api/documents/${id}/copy`, { method: "POST" }),
  openDocument: (id: string) => request<OpenedDocument>(`/api/documents/${id}`),
  renameDocument: (id: string, title: string) =>
    request<DocumentSummary>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  listRevisions: (id: string) => request<Revision[]>(`/api/documents/${id}/revisions`),
  getRevision: (id: string, revisionId: number) =>
    request<RevisionWithContent>(`/api/documents/${id}/revisions/${revisionId}`),
  restoreRevision: (id: string, revisionId: number) =>
    request<{ version: number }>(`/api/documents/${id}/revisions/${revisionId}/restore`, { method: "POST" }),
  /** Names a version; a blank name removes it. */
  nameRevision: (id: string, revisionId: number, name: string) =>
    request<Revision>(`/api/documents/${id}/revisions/${revisionId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  nameCurrentVersion: (id: string, name: string) =>
    request<Revision>(`/api/documents/${id}/revisions/current/name`, { method: "POST", body: JSON.stringify({ name }) }),
  copyRevision: (id: string, revisionId: number) =>
    request<DocumentSummary>(`/api/documents/${id}/revisions/${revisionId}/copy`, { method: "POST" }),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<UploadResponse>("/api/uploads", { method: "POST", body: form });
  },
  /** `tab`: a tab's id, or "all" for every tab. */
  exportUrl: (id: string, format: "md" | "docx", tab: string) => `/api/documents/${id}/export/${format}?tab=${encodeURIComponent(tab)}`,
  createComment: (id: string, comment: CreateCommentRequest) =>
    request<CommentThread>(`/api/documents/${id}/comments`, { method: "POST", body: JSON.stringify(comment) }),
  replyToComment: (id: string, commentId: number, body: string) =>
    request<CommentThread>(`/api/documents/${id}/comments/${commentId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  setCommentResolved: (id: string, commentId: number, resolved: boolean) =>
    request<CommentThread>(`/api/documents/${id}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved }),
    }),
  deleteComment: (id: string, commentId: number) =>
    request<void>(`/api/documents/${id}/comments/${commentId}`, { method: "DELETE" }),
  editCommentMessage: (id: string, commentId: number, messageId: number, body: string) =>
    request<CommentThread>(`/api/documents/${id}/comments/${commentId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  /** Adds (`on`) or removes the user's emoji reaction to a comment message. */
  setReaction: (id: string, commentId: number, messageId: number, emoji: string, on: boolean) =>
    on
      ? request<CommentThread>(`/api/documents/${id}/comments/${commentId}/messages/${messageId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        })
      : request<CommentThread>(`/api/documents/${id}/comments/${commentId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
          method: "DELETE",
        }),
  deleteCommentReply: (id: string, commentId: number, messageId: number) =>
    request<CommentThread>(`/api/documents/${id}/comments/${commentId}/messages/${messageId}`, { method: "DELETE" }),
  /** Replies on a suggestion; each call returns all of the suggestion's replies. */
  replyToSuggestion: (id: string, suggestionId: string, body: string) =>
    request<CommentMessage[]>(`/api/documents/${id}/suggestions/${encodeURIComponent(suggestionId)}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  deleteSuggestionReply: (id: string, suggestionId: string, replyId: number) =>
    request<CommentMessage[]>(`/api/documents/${id}/suggestions/${encodeURIComponent(suggestionId)}/replies/${replyId}`, {
      method: "DELETE",
    }),
};
