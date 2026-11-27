import { ApiError, outboxEntries, removeOutbox, type CinderApi } from "@cinder/ui";
import { flushSubmissionOutbox } from "./classroomState";

export type SubmissionPayload = {
  assignmentId: string;
  doc: Record<string, unknown>;
  text: string;
  note: string;
};

export const REJECTED_HAND_IN = "Work waiting to be sent was rejected by Cinder Host. Your note is still saved on this computer.";

/** Sends this student's offline hand-ins to the Host; safe to call from anywhere, any number of times. */
export function sendQueuedHandIns(api: CinderApi, scope: string) {
  return flushSubmissionOutbox(scope, {
    entries: outboxEntries,
    remove: removeOutbox,
    send: (payload) => {
      const work = payload as SubmissionPayload;
      return api.submitWork(work.assignmentId, work.doc, work.text, work.note);
    },
    failure: (error) => (error instanceof ApiError ? { status: error.status, offline: error.offline } : null),
  });
}
