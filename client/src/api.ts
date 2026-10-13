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
  type StepsConflictResponse,
  type SubmitStepsRequest,
  type SubmitStepsResponse,
  type UploadResponse,
} from "@docs/shared";
import { RejectedError, type StepsTransport, type SubmitResult } from "./editor/sync.ts";

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

/** Sends step batches to the server. Network failures and 5xx responses are retried by the sync. */
export function stepsTransport(documentId: string): StepsTransport {
  return {
    async submit(body: SubmitStepsRequest): Promise<SubmitResult> {
      const response = await fetch(`/api/documents/${documentId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 409) {
        const conflict: StepsConflictResponse = await response.json();
        return { kind: "conflict", ...conflict };
      }
      if (response.ok) {
        const { version }: SubmitStepsResponse = await response.json();
        return { kind: "accepted", version };
      }
      const message = (await response.json().catch(() => null))?.error ?? response.statusText;
      if (response.status >= 400 && response.status < 500) throw new RejectedError(message);
      throw new ApiError(response.status, message);
    },
  };
}
