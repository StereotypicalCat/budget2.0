import type { ReactNode } from "react";
import { useDataset } from "../../hooks/useDataset.ts";
import { BUILD_VERSION } from "../../buildVersion.ts";
import { Section } from "../../components/Section.tsx";

const REPO = "github.com/StereotypicalCat/budget2.0";

/**
 * Production notes, in the old sense of the word: where this came from, what it
 * was set in, and what it is written on.
 *
 * The schema version is here rather than only in the export because it is the
 * number that matters when someone opens a backup and wonders what will read
 * it. The build stamp is here because the source link invites bug reports, and
 * "which build" is the first thing anyone will ask.
 *
 * No licence is claimed for the app itself: there is no LICENSE file in the
 * repository, and asserting one in the UI would be worse than saying nothing.
 * The font licences ARE committed, beside the files, so those are named.
 */
export function ColophonSection() {
  const dataset = useDataset();

  return (
    <Section title="Colophon" hint="Envelope budgeting that lives entirely in your browser.">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[7.5rem_1fr]">
        <Entry label="Source">
          {/* rel="noreferrer" is deliberate, not boilerplate: an app whose
              whole position is that the data never leaves the browser should
              not hand this page's URL to another origin on the way out. */}
          <a
            href={`https://${REPO}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-budget-accent underline underline-offset-2 hover:no-underline"
          >
            {REPO}
          </a>
          <span aria-hidden="true" className="ml-1 text-budget-ink-muted">
            &#8599;
          </span>
        </Entry>
        <Entry label="Built with">Bun, React 19, Tailwind 4, shadcn/ui</Entry>
        <Entry label="Typefaces">
          Inter and JetBrains Mono, self-hosted under the SIL Open Font License 1.1
        </Entry>
        <Entry label="Storage">
          IndexedDB in this browser
          <span className="text-budget-ink-muted"> · </span>
          schema version{" "}
          <span className="font-money">{dataset.settings.schemaVersion}</span>
        </Entry>
        <Entry label="Build">
          <span className="font-money">{BUILD_VERSION}</span>
        </Entry>
      </dl>
    </Section>
  );
}

function Entry({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
