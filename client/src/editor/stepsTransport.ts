import type { StepsConflictResponse, SubmitStepsRequest, SubmitStepsResponse } from "@docs/shared";
import { ApiError } from "../api.ts";
import { RejectedError, type StepsTransport, type SubmitResult } from "./sync.ts";

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
