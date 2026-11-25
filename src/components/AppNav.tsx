import { Home, ClipboardList, FileText, History } from "lucide-react";
import type { AppRoute } from "../utils/route";

export const NAV_ITEMS: ReadonlyArray<{ id: AppRoute; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "planner", label: "Planner", icon: ClipboardList },
  { id: "report", label: "Report", icon: FileText },
  { id: "records", label: "Records", icon: History },
];

interface AppNavProps {
  current: AppRoute;
  onNavigate: (route: AppRoute) => void;
  /** "top" sits in the header (tablet and desktop). "bottom" is the phone tab bar. */
  placement: "top" | "bottom";
}

/**
 * The four main screens. Every label is always visible: an icon alone hid the
 * Planner from new users on phones.
 */
export default function AppNav({ current, onNavigate, placement }: AppNavProps) {
  if (placement === "bottom") {
    return (
      <nav
        aria-label="Main"
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--surface-1)] border-t border-[var(--border-strong)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="grid grid-cols-4">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => onNavigate(id)}
                aria-current={current === id ? "page" : undefined}
                className={
                  "w-full min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-xs font-bold border-t-[3px] -mt-px " +
                  (current === id
                    ? "border-teal-600 text-teal-800 dark:border-teal-400 dark:text-teal-300"
                    : "border-transparent text-slate-600")
                }
              >
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="hidden sm:flex items-center h-full">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          aria-current={current === id ? "page" : undefined}
          className={
            "h-full flex items-center gap-1.5 px-3 text-sm font-bold border-b-[3px] -mb-px " +
            (current === id
              ? "border-teal-600 text-teal-800 dark:border-teal-400 dark:text-teal-300"
              : "border-transparent text-slate-600 hover:text-slate-900 dark:hover:text-white")
          }
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
