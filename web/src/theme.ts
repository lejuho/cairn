// Theme preference: "system" follows the OS, "light"/"dark" pin it via data-theme
// on <html>. index.html applies the stored value before first paint.

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "cairn.theme";
const THEME_COLOR = { light: "#f5f6f8", dark: "#0d1016" } as const;

export function readTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  const resolved = pref === "system" ? (prefersDark() ? "dark" : "light") : pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
}

export function saveTheme(pref: ThemePreference): void {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage unavailable (private mode): the choice still applies for this page.
  }
  applyTheme(pref);
}

export function nextTheme(pref: ThemePreference): ThemePreference {
  return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}
