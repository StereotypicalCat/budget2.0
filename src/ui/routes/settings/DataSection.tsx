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
import { Section } from "../../components/Section.tsx";

export function DataSection() {
  const dataset = useDataset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Dataset | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared by every export button and by the pre-import backup below.
  // `buildOds` in particular can throw (e.g. MissingRateError when a
  // currency in use has no configured rate), and a throw out of a plain
  // onClick handler is invisible to React's error boundary — so every
  // export path funnels through here and reports failure via the same
  // error state the import flow already uses. Returns whether it succeeded,
  // so callers that depend on the export (the import backup) can tell.
  function runExport(build: () => { filename: string; blob: Blob }): boolean {
    try {
      setError(null);
      const { filename, blob } = build();
      downloadBlob(filename, blob);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Could not export: ${message}`);
      return false;
    }
  }

  function buildJsonExport() {
    return {
      filename: exportFilename(currentMonth),
      blob: new Blob([exportDatasetJson(dataset)], { type: "application/json" }),
    };
  }

  function exportJson() {
    runExport(buildJsonExport);
  }

  function exportOds() {
    runExport(() => ({
      filename: odsFilename(currentMonth),
      blob: new Blob([buildOds(dataset) as BlobPart], {
        type: "application/vnd.oasis.opendocument.spreadsheet",
      }),
    }));
  }

  async function chooseFile(file: File) {
    setError(null);
    setConfirmingReset(false);
    try {
      setPending(parseDatasetJson(await file.text()));
    } catch (cause) {
      setPending(null);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Could not import: ${message}`);
    }
  }

  async function confirmImport() {
    if (!pending) return;
    // Back up first: import replaces everything, and this is the user's only
    // copy. Order matters — the backup must download before the destructive
    // replace, never after. If the backup itself fails, abort rather than
    // destroy the only copy of the user's data.
    if (!runExport(buildJsonExport)) return;
    // The write itself can still fail — a full disk, evicted storage, a
    // private-mode quota. Unguarded it is an unhandled rejection: the button
    // appears to do nothing and the dialog stays open with no explanation.
    // `pending` is deliberately kept on failure so the user can retry.
    try {
      await store.replace(pending);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Could not import: ${message}. Your data has not been changed.`);
      return;
    }
    setPending(null);
  }

  /**
   * Back to a brand-new browser: the seed posts, the seed currency table and
   * the baked rates. `store.reset()` is the same call `load()` makes on a
   * first run, so the two cannot drift apart.
   *
   * Order of operations is the import flow's, for the import flow's reason:
   * this is the user's only copy, so the backup must download BEFORE the
   * destructive write, and a backup that fails aborts the reset rather than
   * destroying data no one has a copy of.
   */
  async function confirmReset() {
    if (!runExport(buildJsonExport)) return;
    try {
      await store.reset();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Could not reset: ${message}. Your data has not been changed.`);
      return;
    }
    setConfirmingReset(false);
  }

  const counts = describeDataset(dataset);

  return (
    <Section
      title="Your data"
      hint="Everything lives in this browser. Export regularly — it is both your backup and how you move your budget to another device."
    >
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
        <Button
          variant="outline"
          className="ms-auto border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive/5 hover:text-destructive"
          onClick={() => {
            setError(null);
            setPending(null);
            setConfirmingReset(true);
          }}
        >
          Reset everything…
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

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {confirmingReset && (
        <div className="mt-4 space-y-3 rounded-md border border-destructive/60 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">This deletes everything in this browser.</p>
          <p>
            Now: {counts.posts} posts, {counts.months} months, {counts.purchases} purchases,{" "}
            {dataset.currencies.length} currencies.
            <br />
            After reset: the three starter posts (Video Games, Food, Events and Social), the
            DKK / USD / EUR currency table with the built-in exchange rates, this month at
            zero income, and no purchases. Your own posts, currencies, income and allocation
            history are all replaced.
          </p>
          <p className="text-xs text-muted-foreground">
            A backup of your current data will download first.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void confirmReset()}>
              Reset my data
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {pending && (
        <div className="mt-4 space-y-3 rounded-md border border-destructive/60 bg-destructive/5 p-4 text-sm">
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
    </Section>
  );
}
