import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

const EMBED_HANDLE = "badgeflow-embed";

type ExtensionsApi = () => Promise<{ type: string; activations: { handle: string; status: string }[] }[]>;

// Whether the BadgeFlow app embed is on in the published theme, straight
// from Shopify (App Bridge app.extensions(): no scopes, no theme access).
// Starts from the stored value, re-checks on mount and on demand, and
// stores changes so pages that can't check (and the server) stay in step.
export function useEmbedStatus(stored: boolean) {
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const [active, setActive] = useState(stored);
  // null = not checked yet, false = App Bridge couldn't answer.
  const [checked, setChecked] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const api = (shopify as unknown as { app?: { extensions?: ExtensionsApi } }).app;
      if (!api?.extensions) {
        setChecked(false);
        return;
      }
      const extensions = await api.extensions();
      const on = extensions
        .filter((e) => e.type === "theme_app_extension")
        .some((e) => e.activations.some((a) => a.handle === EMBED_HANDLE && a.status === "active"));
      setActive(on);
      setChecked(true);
      if (on !== stored) {
        fetcher.submit({ intent: "embed-status", active: on ? "1" : "0" }, { method: "post", action: "/app/setup" });
      }
    } catch {
      setChecked(false);
    } finally {
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { active, autoChecked: checked === true, checking, recheck: check };
}
