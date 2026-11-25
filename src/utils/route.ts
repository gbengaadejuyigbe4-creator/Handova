/**
 * route.ts — hash routes for Handova.
 *
 * #/home  #/planner  #/report  #/records are the app screens.
 * Anything else (no hash, #how-it-works, #top) means the landing page.
 * #clinician-demo is handled separately in main.tsx and is not a route here.
 *
 * Only a plain "#/name" is used: no query strings and no values in the hash.
 */

export type AppRoute = "home" | "planner" | "report" | "records";

export const APP_ROUTES: readonly AppRoute[] = ["home", "planner", "report", "records"];

/** Returns the app route for a hash, or null when the hash is not an app route (landing page). */
export function parseRoute(hash: string): AppRoute | null {
  const match = /^#\/([a-z]+)\/?$/.exec(hash || "");
  if (!match) return null;
  return (APP_ROUTES as readonly string[]).includes(match[1]) ? (match[1] as AppRoute) : null;
}

export function routeToHash(route: AppRoute): string {
  return `#/${route}`;
}
