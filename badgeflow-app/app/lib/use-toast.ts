import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useToast } from "../components/toast";

// Shows a bottom-center toast whenever a route action returns a fresh
// { ok, message } result — e.g. after a delete, save, or status change on
// the same page.
export function useActionToast(data: { ok?: boolean; message?: string; isError?: boolean } | undefined | null) {
  const { show } = useToast();
  useEffect(() => {
    if (data?.ok && data.message) {
      show(data.message, { isError: data.isError ?? false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}

// Shows a toast based on a one-shot `?toast=<key>` query param — for actions
// that redirect to a different page (e.g. save draft, then land on the list).
// Clears the param afterward so refreshing or navigating back doesn't replay it.
export function useQueryToast(messages: Record<string, string>) {
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const key = searchParams.get("toast");

  useEffect(() => {
    if (!key || !messages[key]) return;
    show(messages[key]);
    const next = new URLSearchParams(searchParams);
    next.delete("toast");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
