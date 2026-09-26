import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useToast } from "../components/toast";

// Shows a toast whenever a route action returns a fresh { ok, message }
// result — e.g. after a delete, save, or status change on the same page.
export function useActionToast(data: { ok?: boolean; message?: string; isError?: boolean } | undefined | null) {
  const { show } = useToast();
  useEffect(() => {
    if (data?.message) {
      show(data.message, { isError: data.isError ?? !data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}

export type ToastMessage = string | { message: string; isError?: boolean; duration?: number };

// Shows a toast based on a one-shot `?toast=<key>` query param — for actions
// that redirect to a different page (e.g. save draft, then land on the list).
// Clears the param afterward so refreshing or navigating back doesn't replay it.
export function useQueryToast(messages: Record<string, ToastMessage>) {
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const key = searchParams.get("toast");

  useEffect(() => {
    const entry = key ? messages[key] : undefined;
    if (!key || !entry) return;
    if (typeof entry === "string") show(entry);
    else show(entry.message, { isError: entry.isError, duration: entry.duration });
    const next = new URLSearchParams(searchParams);
    next.delete("toast");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// What a saved campaign does on the storefront, in the merchant's words.
// Mirrors PublishOutcome in storefront-sync.server.ts.
export function campaignToasts(embedConfirmed: boolean): Record<string, ToastMessage> {
  const embedNote = embedConfirmed ? "" : " Turn on the app embed in Store setup so shoppers can see it.";
  return {
    "draft-saved": "Draft saved",
    published: embedConfirmed
      ? "Campaign published — badges are live"
      : { message: `Campaign published.${embedNote}`, duration: 8000 },
    scheduled: `Campaign scheduled.${embedNote}`.trim(),
    queued: {
      message: "Campaign saved. On the Free plan it waits until your current campaign ends.",
      duration: 8000,
    },
    "not-showing": {
      message: "Campaign saved, but it won't show: the Free plan runs one campaign at a time and the current one has no end date, or your plan's product limit is used up.",
      isError: true,
      duration: 10000,
    },
    "sync-failed": {
      message: "Campaign saved, but your storefront couldn't be updated. Open Home to try again.",
      isError: true,
      duration: 10000,
    },
  };
}
