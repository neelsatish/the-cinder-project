import { PdfViewer } from "@cinder/ui/pdf";
import { readAsset, writeAsset } from "../theme";

/** A Library PDF, read from this computer's storage. */
export function PdfPane({ fileId, storageKey, name, onClose }: { fileId: string; storageKey: string; name: string; onClose: () => void }) {
  return (
    <PdfViewer
      sourceKey={storageKey}
      name={name}
      onClose={onClose}
      load={async () => {
        let blob = await readAsset(storageKey);
        if (!blob) {
          // The pre-account-scoping key; moved forward on first read.
          blob = await readAsset(`pdf:${fileId}`);
          if (blob) await writeAsset(storageKey, blob);
        }
        if (!blob) throw new Error("missing");
        return blob;
      }}
    />
  );
}
