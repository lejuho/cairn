import { ProviderStatusBadges } from "./ProviderStatusBadges.js";

const NAV_LINKS = [
  { href: "/today", label: "Today" },
  { href: "/input", label: "입력" },
  { href: "/threads", label: "스레드" },
  { href: "/people", label: "사람" },
  { href: "/mirror", label: "거울" },
  { href: "/watch", label: "여백" }
] as const;

export function AppNav({ path }: { path: string }) {
  return (
    <nav className="app-nav" aria-label="주요 메뉴">
      <ul className="app-nav-list" role="list">
        {NAV_LINKS.map(({ href, label }) => (
          <li key={href}>
            <a
              className="app-nav-link"
              href={href}
              aria-current={
                path === href ||
                (href === "/today" && path === "/") ||
                (href === "/people" && path.startsWith("/people/"))
                  ? "page"
                  : undefined
              }
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
      <ProviderStatusBadges />
    </nav>
  );
}
