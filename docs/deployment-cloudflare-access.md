# Deployment — Cloudflare Access + Tunnel (Raspberry Pi)

## Architecture

```
외부 브라우저
  → cairn.lee-blog.me (Cloudflare Access 인증)
  → cloudflared tunnel
  → http://localhost:18080  (Caddy: 정적 PWA + /api 프록시)
      /api/*   → http://127.0.0.1:3100  (Fastify)
      /health  → http://127.0.0.1:3100
      /*       → /var/www/cairn (published PWA, SPA try_files fallback)
```

Fastify는 loopback(`127.0.0.1`)에만 바인딩한다. 인터넷에 직접 노출되지 않는다.

---

## 사전 조건

- Raspberry Pi에 Node.js `>=22 <23` 및 `corepack` 설치
- `corepack pnpm install` 완료
- Caddy 설치 (`apt install caddy` 또는 공식 바이너리)
- `cloudflared` 설치 및 tunnel 생성 완료 (아래 Cloudflare 대시보드 섹션 참조)

---

## 1. Cloudflare 대시보드 (유저 소유 — 대시보드에서 수행)

> 이 섹션은 리포에서 관리하지 않는다. Cloudflare 웹 UI에서 수행한다.

1. **Tunnel 생성**: Zero Trust → Networks → Tunnels → Create tunnel.
2. **Ingress 규칙**: `cairn.lee-blog.me` → `http://localhost:18080`.
3. **Access 정책**: Zero Trust → Access → Applications → Add application.
   - Application type: Self-hosted
   - Application domain: `cairn.lee-blog.me`
   - Policy: Email 또는 One-time PIN으로 본인만 허용.
4. **DNS**: Cloudflare DNS에 `cairn.lee-blog.me` CNAME이 tunnel UUID로 자동 생성됨.

> **Access 정책이 활성화되기 전에 DNS/Tunnel을 열지 말 것.** mutation API는 Access 뒤에 있을 때만 안전하다.

---

## 2. 로컬 서버 설정 (리포 관리 예시 파일 사용)

### 2-1. 환경 파일 복사

```bash
mkdir -p /home/pi/cairn-data
cp deploy/env/cairn-server.env.example /home/pi/cairn-data/cairn-server.env
# 편집: DB_PATH와 CAIRN_DB_PATH (같은 경로), 필요시 LLM_PROXY_BASE_URL, TELEGRAM_BOT_TOKEN
```

### 2-2. systemd unit 설치

```bash
sudo cp deploy/systemd/cairn-server.service.example \
         /etc/systemd/system/cairn-server.service
# 경로나 유저가 다르면 unit 파일 수정
sudo systemctl daemon-reload
sudo systemctl enable cairn-server
```

### 2-3. Caddyfile 설정

```bash
cp deploy/caddy/Caddyfile.example /home/pi/cairn-data/Caddyfile
# 정적 파일 root는 기본 /var/www/cairn
```

Caddy를 systemd로 실행하거나 직접 지정:

```bash
caddy run --config /home/pi/cairn-data/Caddyfile
# 또는 systemd unit을 별도로 작성해 ExecStart에 위 명령 사용
```

---

## 3. 빌드 및 배포 절차

코드 변경 후 재배포 순서:

### 자동 재배포 스크립트

반복 배포는 아래 스크립트를 우선 사용한다.

```bash
deploy/scripts/redeploy-production.sh
```

스크립트가 하는 일:

1. `git pull --ff-only`
2. `corepack pnpm install --frozen-lockfile`
3. `corepack pnpm verify`
4. `corepack pnpm build`
5. `sudo rsync -a --delete /home/pi/cairn/web/dist/ /var/www/cairn/`
6. `CAIRN_DB_PATH=/home/pi/cairn-data/cairn.sqlite3 corepack pnpm db:migrate`
7. `sudo systemctl restart cairn-server`
8. `sudo systemctl reload caddy`
9. `/health` smoke check

빠른 재시작만 필요하면:

```bash
deploy/scripts/redeploy-production.sh --skip-pull --skip-install --skip-verify --skip-migrate
```

### 수동 절차

```bash
# 1. 최신 코드 가져오기
git pull

# 2. 의존성 동기화 (package.json 변경 시)
corepack pnpm install

# 3. 빌드 (shared → server → web 순서)
corepack pnpm build

# 4. 정적 PWA publish
sudo mkdir -p /var/www/cairn
sudo rsync -a --delete /home/pi/cairn/web/dist/ /var/www/cairn/
sudo chown -R caddy:caddy /var/www/cairn

# 5. DB 마이그레이션 (schema 변경 시)
# CAIRN_DB_PATH는 Drizzle 마이그레이션 도구가 읽는 변수 (DB_PATH와 별도).
# 두 변수가 같은 파일을 가리켜야 한다.
CAIRN_DB_PATH=/home/pi/cairn-data/cairn.sqlite3 corepack pnpm db:migrate

# 6. 서버 재시작
sudo systemctl restart cairn-server

# 7. 스모크 체크
systemctl status cairn-server
curl http://127.0.0.1:3100/health
curl http://localhost:18080/health
```

---

## 4. 스모크 체크 목록

배포 후 순서대로 확인:

- [ ] `systemctl status cairn-server` → `active (running)`
- [ ] `curl http://127.0.0.1:3100/health` → `{"ok":true,...}` 응답
- [ ] `curl http://localhost:18080/health` → Caddy 프록시 통과 응답
- [ ] Cloudflare Access 활성화 확인 후 `https://cairn.lee-blog.me/today` 접속
- [ ] `/threads`, `/threads/new`, `/threads/1` 하드 리프레시 → 404 없이 SPA 로드

---

## 5. 경계 정리

| 레이어 | 담당 | 위치 |
|--------|------|------|
| TLS 종료 | Cloudflare | 클라우드 |
| 인증 (Access) | Cloudflare Access | 클라우드 (대시보드) |
| 정적 파일 + SPA 라우팅 | Caddy | Pi 로컬 `:18080`, root `/var/www/cairn` |
| API 서버 | Fastify | Pi 로컬 `127.0.0.1:3100` |
| 데이터 | SQLite | `/home/pi/cairn-data/cairn.sqlite3` |

---

## 6. 보안 주의사항

- 로컬 mutation API(`POST /api/tasks`, `POST /api/threads` 등)는 앱 레벨 인증 없이 동작한다. Cloudflare Access가 반드시 앞에 있어야 한다.
- `cairn-server.env`에 토큰·비밀값을 넣고 리포에 커밋하지 말 것 (`.gitignore` 확인).
- DB 파일은 리포 외부(`/home/pi/cairn-data/`)에 둔다. `git clean`이나 리포 재설치로 날아가지 않도록.
- Caddy는 `caddy` 유저로 실행되므로 `/home/pi/cairn/web/dist`를 직접 serve하지 않는다. `/home/pi` 권한이 `700`이면 403이 난다. 정적 파일은 `/var/www/cairn`으로 publish한다.

---

## 7. DB 백업 (수동)

자동 백업은 이 사이클 범위 밖. 수동 백업:

```bash
cp /home/pi/cairn-data/cairn.sqlite3 \
   /home/pi/cairn-data/cairn.sqlite3.bak.$(date +%Y%m%d)
```
