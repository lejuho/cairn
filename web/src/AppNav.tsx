import { useEffect, useState, type ReactNode } from "react";
import { AgentPanel } from "./AgentPanel.js";
import { QuickNoteSheet } from "./Notes.js";
import { ProviderStatusBadges } from "./ProviderStatusBadges.js";
import { applyTheme, nextTheme, readTheme, saveTheme, type ThemePreference } from "./theme.js";

type NavLink = { href: string; label: string; icon: ReactNode };

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="app-nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Primary links stay in the mobile tab bar; secondary ones sit behind "더보기"
// on mobile and are always listed in the desktop sidebar.
const PRIMARY_LINKS: NavLink[] = [
  { href: "/calendar", label: "달력", icon: <Icon><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon> },
  { href: "/notes", label: "메모", icon: <Icon><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h7M9 16h5" /></Icon> },
  { href: "/input", label: "입력", icon: <Icon><path d="M4 6h16M4 12h10M4 18h7" /><path d="M18 14v6M15 17h6" /></Icon> },
  { href: "/threads", label: "스레드", icon: <Icon><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M6 8.2v7.6M8 6.8l8 4M8 17.2l8-4" /></Icon> }
];

const SECONDARY_LINKS: NavLink[] = [
  { href: "/items", label: "항목", icon: <Icon><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></Icon> },
  { href: "/people", label: "사람", icon: <Icon><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" /></Icon> },
  { href: "/mirror", label: "거울", icon: <Icon><path d="M4 19V5M4 19h16" /><path d="M8 15l3.5-4 3 2.500L19 8" /></Icon> },
  { href: "/watch", label: "여백", icon: <Icon><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Icon> },
  { href: "/params", label: "파라미터", icon: <Icon><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon> }
];

const THEME_LABEL: Record<ThemePreference, string> = { system: "시스템", light: "라이트", dark: "다크" };

function isCurrent(path: string, href: string): boolean {
  if (path === href) return true;
  if (href === "/calendar") return path === "/" || path === "/today";
  return (href === "/people" || href === "/threads") && path.startsWith(`${href}/`);
}

function NavItem({ link, path }: { link: NavLink; path: string }) {
  return (
    <li>
      <a className="app-nav-link" href={link.href} aria-current={isCurrent(path, link.href) ? "page" : undefined}>
        {link.icon}
        <span className="app-nav-label">{link.label}</span>
      </a>
    </li>
  );
}

export function AppNav({ path }: { path: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const inSecondary = SECONDARY_LINKS.some((link) => isCurrent(path, link.href));

  return (
    <>
      <nav className="app-nav" aria-label="주요 메뉴" data-more={moreOpen ? "open" : "closed"}>
        <a className="app-nav-brand" href="/calendar" aria-label="Cairn 홈">
          <span className="app-nav-brand-mark" aria-hidden="true" />
          Cairn
        </a>
        <button type="button" className="quick-note-btn" onClick={() => setNoteOpen(true)} aria-label="빠른 기록 쓰기">
          <span className="quick-note-plus" aria-hidden="true">+</span>
          <span className="quick-note-label">빠른 기록</span>
        </button>
        <button type="button" className="agent-open-btn" onClick={() => setAgentOpen(true)} aria-label="에이전트 열기">
          <Icon><path d="M4 5h16v11H9l-5 4z" /><path d="M8.5 9.500h7M8.5 12.500h4" /></Icon>
          <span className="agent-open-label">에이전트</span>
        </button>
        <ul className="app-nav-list" role="list">
          {PRIMARY_LINKS.map((link) => <NavItem key={link.href} link={link} path={path} />)}
          <li className="app-nav-more-item">
            <button
              type="button"
              className="app-nav-link app-nav-more-btn"
              data-active={inSecondary ? "true" : undefined}
              aria-expanded={moreOpen}
              aria-controls="app-nav-more"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Icon><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></Icon>
              <span className="app-nav-label">더보기</span>
            </button>
          </li>
        </ul>
        <div className="app-nav-more" id="app-nav-more">
          <ul className="app-nav-list app-nav-list--secondary" role="list">
            {SECONDARY_LINKS.map((link) => <NavItem key={link.href} link={link} path={path} />)}
          </ul>
          <div className="app-nav-foot">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => {
                const next = nextTheme(theme);
                saveTheme(next);
                setTheme(next);
              }}
              aria-label={`테마 바꾸기 (지금: ${THEME_LABEL[theme]})`}
            >
              테마 · {THEME_LABEL[theme]}
            </button>
            <ProviderStatusBadges />
          </div>
        </div>
      </nav>
      {noteOpen && <QuickNoteSheet onClose={() => setNoteOpen(false)} />}
      {agentOpen && <AgentPanel onClose={() => setAgentOpen(false)} />}
    </>
  );
}
