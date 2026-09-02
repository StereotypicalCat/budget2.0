import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyUpdate, registerServiceWorker } from "../registerSw.ts";

export function UpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <div className="fixed bottom-4 right-4 flex items-center gap-3 rounded-lg border border-budget-rule bg-background p-4 text-sm shadow-lg">
      <span>A new version is ready.</span>
      <Button size="sm" onClick={applyUpdate}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setReady(false)}>
        Later
      </Button>
    </div>
  );
}
