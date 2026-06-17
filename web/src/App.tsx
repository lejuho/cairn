import { useEffect, useMemo } from "react";
import { Thread } from "./Thread.js";
import { Today } from "./Today.js";

export function App() {
  const path = useMemo(() => window.location.pathname, []);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/today");
    }
  }, []);

  if (path === "/" || path === "/today") {
    return <Today />;
  }

  if (path.startsWith("/threads/")) {
    const id = parseInt(path.slice("/threads/".length), 10);
    if (Number.isFinite(id) && id > 0) {
      return <Thread id={id} />;
    }
  }

  return (
    <main className="app-shell" aria-labelledby="not-found-title">
      <section className="quiet-card warm">
        <span className="quiet-dot" aria-hidden="true" />
        <h1 id="not-found-title">아직 없는 길이야</h1>
        <p>오늘 화면으로 돌아오면 지금 필요한 것만 올려둘게.</p>
      </section>
    </main>
  );
}
