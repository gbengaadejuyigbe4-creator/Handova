import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeToHash, type AppRoute } from "../utils/route";

/**
 * Keeps the current app route in sync with location.hash.
 * Setting the hash adds a history entry, so the back button, refresh and
 * bookmarks all work. route === null means the landing page.
 */
export function useRoute() {
  const [route, setRoute] = useState<AppRoute | null>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: AppRoute) => {
    window.location.hash = routeToHash(next);
  }, []);

  /** Back to the landing page: clear the hash without leaving a bare "#" behind. */
  const goLanding = useCallback(() => {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    setRoute(null);
  }, []);

  return { route, navigate, goLanding };
}
