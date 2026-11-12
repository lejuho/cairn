# Cloudflare Access 세션 만료 뒤 로그인 창이 뜨지 않음

## 증상과 영향

- Access 세션이 만료된 뒤 설치된 PWA(또는 한 번 열어 본 브라우저)에서 "로그인 세션이 필요해"만 보이고,
  "Access 로그인 다시 열기"를 눌러도 Cloudflare 로그인 화면이 나오지 않았다. 앱을 쓸 수 없었다.
- 2026-11-12 테마·메모 배포 직후에 보고됐다. 배포가 원인은 아니고 같은 날 세션 만료가 겹쳤다(가설).

## 증거

- 엣지는 정상: `curl https://cairn.lee-blog.me/today` → `302 https://onionking.cloudflareaccess.com/cdn-cgi/access/login/…`
  (`/api/today`, `/sw.js` 도 같은 302).
- 빌드된 `web/dist/sw.js`: `registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")))` — denylist 없음.
- 복구 버튼 코드: `window.location.assign(window.location.href)` (Today·입력·사람·여백), `window.location.reload()` (스레드·거울).

## 원인 (확인)

서비스워커가 같은 출처의 **모든 페이지 이동**을 캐시된 `index.html` 로 답했다. 그래서

1. 복구 버튼의 새로고침은 네트워크에 닿지 않아 Access 302 를 받을 일이 없었고,
2. 로그인 후 돌아오는 `/cdn-cgi/access/authorized?…` 콜백도 같은 이유로 가로채질 수 있었다.

`fetch("/api/…")` 는 Access 로 리다이렉트돼 실패하므로 앱은 "세션 필요" 화면에 머문다.
cycle 1 의 PWA 설정부터 있던 결함이며, 세션이 살아 있는 동안에는 드러나지 않는다.

## 해결

- `web/vite.config.ts`: `workbox.navigateFallbackDenylist = [/^\/cdn-cgi\//, /^\/api\//, /^\/health$/]`.
- `server/src/app.ts`: `GET /api/session/return?to=<같은 사이트 경로>` → 302 로 되돌려 보냄
  (`//`, `/\`, 절대 URL 은 `/today` 로 대체 — open redirect 방지).
- `web/src/api.ts`: `accessLoginUrl()` / `openAccessLogin()`. 세션 복구 버튼 8곳(Today·입력·사람 목록·사람 상세·여백·스레드 목록·스레드·거울)과
  메모 화면이 이 경로로 이동한다. 요청이 네트워크로 나가 Access 로그인 → 콜백 → 원래 화면 순으로 돌아온다.

## 검증

- 단위: `server/src/app.test.ts` (되돌림·오프사이트 거부), `web/src/api.test.ts` (`accessLoginUrl`), 각 화면의 복구 버튼 테스트.
- 배포 후: `curl -I http://127.0.0.1:18080/api/session/return?to=%2Fnotes` → 302 `/notes`,
  배포된 `sw.js` 에 denylist 포함 확인.
- 실기기에서 만료 → 버튼 → 로그인 → 복귀까지는 자동화하지 못했다(Access 로그인이 필요). 수동 확인 대상.

## 이미 설치된 기기의 일회성 복구

옛 서비스워커가 남아 있는 기기는 새 `sw.js` 를 받을 수 없다(업데이트 요청이 Access 302 로 실패).
그 기기에서 한 번만 사이트 데이터를 지우거나(Chrome: 사이트 설정 → cairn.lee-blog.me → 데이터 삭제) PWA 를 지웠다 다시 설치한다.
그 뒤 접속하면 로그인 창이 뜨고 새 서비스워커가 깔린다.

## 재발 방지

- 서비스워커의 navigation fallback 을 바꿀 때는 `/cdn-cgi/`·`/api/` 가 denylist 에 남아 있는지 `web/dist/sw.js` 로 확인한다.
- 세션 복구는 항상 `openAccessLogin()` 을 쓴다. 현재 URL 을 다시 여는 방식(`location.reload`, `assign(href)`)은 캐시된 셸만 다시 띄운다.
