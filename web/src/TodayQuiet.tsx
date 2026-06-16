export function TodayQuiet() {
  return (
    <main className="app-shell" aria-labelledby="today-title">
      <section className="quiet-card warm" data-testid="today-quiet">
        <span className="quiet-dot" aria-hidden="true" />
        <p className="eyebrow">Today</p>
        <h1 id="today-title">오늘은 조용해</h1>
        <p>새로 생기면 올려둘게. 닫고 네 일 해도 돼.</p>
      </section>
    </main>
  );
}
