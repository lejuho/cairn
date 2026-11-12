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
import { Today } from "./Today.js";
import { Watchers } from "./Watchers.js";

export function App() {
  const path = useMemo(() => window.location.pathname, []);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/today");
    }
  }, []);

  const nav = <AppNav path={path} />;

  if (path === "/" || path === "/today") {
    return <div className="app-frame"><AppNav path="/today" /><div className="app-main"><Today /></div></div>;
  }

  if (path === "/calendar") {
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
          <p>오늘 화면으로 돌아오면 지금 필요한 것만 올려둘게.</p>
        </section>
      </main>
      </div>
    </div>
  );
}
