"use client";

import { useEffect } from "react";

/**
 * Re-fetch page data the moment the tab/window regains focus, so a screen
 * left open in the background is never stale when the user comes back.
 */
export function useFocusRefresh(refresh: () => void): void {
  useEffect(() => {
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
}
