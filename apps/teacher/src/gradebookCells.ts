/**
 * What each Gradebook cell shows, what the Host last confirmed, and which typed marks are still
 * waiting to be saved, keyed by `studentId:assignmentId`. A refresh from the Host must never
 * overwrite or cancel a mark the teacher has typed but that is not saved yet.
 */

/** "17", "17.0" and 17 are the same mark; anything else is compared as typed. */
export function sameMark(value: unknown) {
  const text = value == null ? "" : String(value).trim();
  return text !== "" && Number.isFinite(Number(text)) ? String(Number(text)) : text;
}

export function createGradeCells() {
  const shown = new Map<string, string>();
  const confirmed = new Map<string, string>();
  const waiting = new Map<string, string>();
  return {
    /** The Host's mark arrived. Returns what the cell should show: a mark still waiting wins,
     * and while one waits the value passed in may be that same mark shown early, not confirmed. */
    fromHost(key: string, value: string) {
      const mark = sameMark(value);
      if (!waiting.has(key)) confirmed.set(key, mark);
      const show = waiting.get(key) ?? mark;
      shown.set(key, show);
      return show;
    },
    /** The cell changed. Returns the mark to save, or null when it already shows that mark
     * (including the Gradebook's own writes). */
    edited(key: string, value: unknown) {
      const mark = sameMark(value);
      if ((shown.get(key) ?? "") === mark) return null;
      shown.set(key, mark);
      waiting.set(key, mark);
      return mark;
    },
    /** A save finished. Returns the mark to put back when it failed and nothing newer is waiting. */
    settled(key: string, mark: string, saved: boolean) {
      if (waiting.get(key) === mark) waiting.delete(key);
      if (saved) {
        confirmed.set(key, mark);
        return null;
      }
      if (waiting.has(key)) return null;
      const back = confirmed.get(key) ?? "";
      shown.set(key, back);
      return back;
    },
    isWaiting(key: string) {
      return waiting.has(key);
    },
  };
}
