import {
  defaultPaperSize,
  type CommentThread,
  type CreateCommentRequest,
  type CreateDocumentRequest,
  type DocumentSort,
  type DocumentSummary,
  type OpenedDocument,
  type Revision,
  type RevisionWithContent,
  type UploadResponse,
} from "@docs/shared";

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
  /** Creates a blank document on the paper size used in the user's locale. */
  createDocument: (title?: string) =>
    request<DocumentSummary>("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title, paperSize: defaultPaperSize(navigator.language) } satisfies CreateDocumentRequest),
    }),
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
  exportUrl: (id: string, format: "md" | "docx") => `/api/documents/${id}/export/${format}`,
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
  deleteCommentReply: (id: string, commentId: number, messageId: number) =>
    request<CommentThread>(`/api/documents/${id}/comments/${commentId}/messages/${messageId}`, { method: "DELETE" }),
};
