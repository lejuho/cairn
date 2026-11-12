import { useEffect, useMemo } from "react";
import { AppNav } from "./AppNav.js";
import { CalendarPage } from "./Calendar.js";
import { InputHub } from "./InputHub.js";
import { ItemIndex } from "./ItemIndex.js";
import { MirrorLedger } from "./MirrorLedger.js";
import { NotesPage } from "./Notes.js";
import { ParameterSettings } from "./ParameterSettings.js";
import { PeopleDirectory } from "./PeopleDirectory.js";
import { PersonDetail } from "./PersonDetail.js";
import { Thread } from "./Thread.js";
import { ThreadIndex } from "./ThreadIndex.js";
import { ThreadNew } from "./ThreadNew.js";
import { Watchers } from "./Watchers.js";

export function App() {
  const path = useMemo(() => window.location.pathname, []);

  // The calendar replaced the Today page as the home screen. Old bookmarks and installed
  // apps still start at /today (or /), so both land on the calendar.
  const home = path === "/" || path === "/today";
  useEffect(() => {
    if (home) window.history.replaceState(null, "", "/calendar");
  }, [home]);

  const nav = <AppNav path={path} />;

  if (home || path === "/calendar") {
    return <div className="app-frame"><AppNav path="/calendar" /><div className="app-main"><CalendarPage /></div></div>;
  }

  if (path === "/notes") {
    return <div className="app-frame"><AppNav path="/notes" /><div className="app-main"><NotesPage /></div></div>;
  }

  if (path === "/input") {
    return <div className="app-frame"><AppNav path="/input" /><div className="app-main"><InputHub /></div></div>;
  }

  if (path === "/items") {
    return <div className="app-frame"><AppNav path="/items" /><div className="app-main"><ItemIndex /></div></div>;
  }

  if (path === "/params") {
    return <div className="app-frame"><AppNav path="/params" /><div className="app-main"><ParameterSettings /></div></div>;
  }

  if (path === "/threads") {
    return <div className="app-frame"><AppNav path="/threads" /><div className="app-main"><ThreadIndex /></div></div>;
  }

  if (path === "/threads/new") {
    return <div className="app-frame"><AppNav path="/threads" /><div className="app-main"><ThreadNew /></div></div>;
  }

  if (path.startsWith("/threads/")) {
    const id = parseInt(path.slice("/threads/".length), 10);
    if (Number.isFinite(id) && id > 0) {
      return <div className="app-frame"><AppNav path="/threads" /><div className="app-main"><Thread id={id} /></div></div>;
    }
  }

  if (path === "/people") {
    return <div className="app-frame"><AppNav path="/people" /><div className="app-main"><PeopleDirectory /></div></div>;
  }

  if (path === "/mirror") {
    return <div className="app-frame"><AppNav path="/mirror" /><div className="app-main"><MirrorLedger /></div></div>;
  }

  if (path === "/watch") {
    return <div className="app-frame"><AppNav path="/watch" /><div className="app-main"><Watchers /></div></div>;
  }

  if (path.startsWith("/people/")) {
    const id = parseInt(path.slice("/people/".length), 10);
    if (Number.isFinite(id) && id > 0) {
      return <div className="app-frame"><AppNav path="/people" /><div className="app-main"><PersonDetail id={id} /></div></div>;
    }
  }

  return (
    <div className="app-frame">
      {nav}
      <div className="app-main">
      <main className="app-shell" aria-labelledby="not-found-title">
        <section className="quiet-card">
          <span className="quiet-dot" aria-hidden="true" />
          <h1 id="not-found-title">아직 없는 길이야</h1>
          <p>달력으로 돌아가면 오늘 것부터 보여줄게.</p>
          <a className="action-btn" href="/calendar">달력으로</a>
        </section>
      </main>
      </div>
    </div>
  );
}
