import { CurrencySection } from "./settings/CurrencySection.tsx";
import { PostsSection } from "./settings/PostsSection.tsx";
import { DataSection } from "./settings/DataSection.tsx";

export function SettingsRoute() {
  return (
    <div className="max-w-4xl space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <CurrencySection />
      <PostsSection />
      <DataSection />
    </div>
  );
}
