import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDataset } from "../../hooks/useDataset.ts";
import { downloadBlob } from "../../download.ts";
import { store, currentMonth } from "../../../store/index.ts";
import {
  describeDataset,
  exportDatasetJson,
  exportFilename,
  parseDatasetJson,
} from "../../../export/json.ts";
import { buildOds, odsFilename } from "../../../export/ods.ts";
import type { Dataset } from "../../../domain/types.ts";

export function DataSection() {
  const dataset = useDataset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  function exportJson() {
    downloadBlob(
      exportFilename(currentMonth),
      new Blob([exportDatasetJson(dataset)], { type: "application/json" }),
    );
  }

  function exportOds() {
    downloadBlob(
      odsFilename(currentMonth),
      new Blob([buildOds(dataset) as BlobPart], {
        type: "application/vnd.oasis.opendocument.spreadsheet",
      }),
    );
  }

  async function chooseFile(file: File) {
    setError(null);
    try {
      setPending(parseDatasetJson(await file.text()));
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function confirmImport() {
    if (!pending) return;
    // Back up first: import replaces everything, and this is the user's only
    // copy. Order matters — the backup must download before the destructive
    // replace, never after.
    exportJson();
    await store.replace(pending);
    setPending(null);
  }

  const counts = describeDataset(dataset);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Your data</h2>
      <p className="text-xs text-muted-foreground">
        Everything lives in this browser. Export regularly — it is both your
        backup and how you move your budget to another device.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportJson}>
          Export JSON
        </Button>
        <Button variant="outline" onClick={exportOds}>
          Export ODS (spreadsheet)
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          Import JSON…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void chooseFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {error && <p className="text-sm text-destructive">Could not import: {error}</p>}

      {pending && (
        <div className="space-y-2 rounded border border-destructive p-3 text-sm">
          <p className="font-medium">This replaces everything currently stored.</p>
          <p>
            Now: {counts.posts} posts, {counts.months} months, {counts.purchases} purchases.
            <br />
            After import: {describeDataset(pending).posts} posts,{" "}
            {describeDataset(pending).months} months,{" "}
            {describeDataset(pending).purchases} purchases.
          </p>
          <p className="text-xs text-muted-foreground">
            A backup of your current data will download first.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void confirmImport()}>
              Replace my data
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
