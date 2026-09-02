import { CurrencySection } from "./settings/CurrencySection.tsx";
import { PostsSection } from "./settings/PostsSection.tsx";
import { DataSection } from "./settings/DataSection.tsx";
import { ColophonSection } from "./settings/ColophonSection.tsx";

/**
 * Each section is its own card. They are unrelated settings — money, posts,
 * and the export/import of everything — and running them together down one
 * column, as before, made the destructive import controls look like a
 * continuation of the harmless ones.
 */
export function SettingsRoute() {
  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-2xl">Settings</h1>
      <CurrencySection />
      <PostsSection />
      <DataSection />
      <ColophonSection />
    </div>
  );
}
