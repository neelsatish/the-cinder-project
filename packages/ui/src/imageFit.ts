/** The longest side Claude reads at full detail on current models; larger photos are shrunk by the provider anyway, so sending more only costs upload time. */
export const MAX_PHOTO_EDGE = 2576;

/** Scales a photo down to fit `maxEdge` on its longest side, never up. */
export function fitWithin(width: number, height: number, maxEdge = MAX_PHOTO_EDGE) {
  const longest = Math.max(width, height);
  if (!(longest > 0)) throw new Error("That photo has no size.");
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The images in a clipboard paste, from either of the two places browsers put them. */
export function imageFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
