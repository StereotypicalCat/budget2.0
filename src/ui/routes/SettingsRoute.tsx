import { CurrencySection } from "./settings/CurrencySection.tsx";
import { PostsSection } from "./settings/PostsSection.tsx";
import { RecurringSection } from "./settings/RecurringSection.tsx";
import { DataSection } from "./settings/DataSection.tsx";
import { ColophonSection } from "./settings/ColophonSection.tsx";

/**
 * Each section is its own card. They are unrelated settings — money, posts,
 * and the export/import of everything — and running them together down one
 * column, as before, made the destructive import controls look like a
 * continuation of the harmless ones.
 *
 * No width cap of its own: the shell's `main` is already `max-w-6xl`, and the
 * `max-w-4xl` here was 256px narrower, so the card edges stepped inward when
 * you came from the month view. It also squeezed the currencies table 8px past
 * its container, which is what put a horizontal scrollbar under it and pinned
 * "remove" against the card edge.
 */
export function SettingsRoute() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl">Settings</h1>
      <CurrencySection />
      <PostsSection />
      <RecurringSection />
      <DataSection />
      <ColophonSection />
    </div>
  );
}
