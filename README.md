# 우리 그룹 (Family Group App)

가족, 회사, 학급 등 그룹 단위로 할일과 일정을 공유하는 웹앱입니다. React + Vite 프런트엔드와 Netlify Functions +
Netlify DB(Postgres)로 된 백엔드로 구성되어 있고, 로그인 없이 그룹 링크(`/g/:id`)만으로 여러 사람이 같은 데이터를
보고 수정할 수 있습니다.

## 아키텍처

- `src/GroupApp.jsx` — UI. 그룹 데이터를 서버에서 fetch/저장하고, 로컬에는 "내가 만들었거나 열어본 그룹" 바로가기
  목록만 `localStorage`에 보관합니다(진짜 데이터는 항상 서버가 기준).
- `netlify/functions/groups.mjs` — Netlify Function. `@netlify/database`로 Postgres에 접속해 그룹 문서를
  생성/조회/저장합니다. 로그인이 없으므로 그룹 id 자체가 접근 권한입니다 — 링크를 아는 사람은 누구나 읽고 쓸 수 있어요.
- `groups` 테이블: 그룹당 한 행, `members` / `tasks` / `events`는 JSONB로 통째 저장합니다. 어떤 변경이든(할일
  추가, 완료 체크, 멤버 추가, 이름 변경 등) 클라이언트가 그룹 문서 전체를 다시 `PUT /api/groups/:id` 해서 저장합니다.

## 로컬 실행 (프런트엔드 + API 둘 다 필요)

로컬 Postgres(또는 Neon 등 접속 가능한 Postgres)가 하나 필요합니다.

```bash
npm install

# .env에 로컬 Postgres 접속 문자열을 넣어주세요 (.env.example 참고)
cp .env.example .env

# 터미널 1: API 서버 (netlify/functions/groups.mjs를 그대로 실행하는 로컬 shim)
npm run dev:api

# 터미널 2: 프런트엔드 (Vite가 /api/* 를 위 API 서버로 프록시합니다)
npm run dev
```

`http://localhost:5173` 에서 확인할 수 있습니다. `scripts/dev-functions-server.mjs`는 `netlify dev`가 필요로
하는 Edge Functions 다운로드 없이, 실제 함수 코드(`netlify/functions/groups.mjs`)를 그대로 로컬에서 돌리기 위한
얇은 shim입니다 — Netlify에 배포되면 이 shim 없이 Netlify가 직접 그 함수를 실행합니다.

## 빌드

```bash
npm run build
npm run preview
```

## 배포 (Netlify)

이 저장소는 비공개로 유지하면서 Netlify에 배포합니다. 빌드 설정은 `netlify.toml`에 정의되어 있습니다.

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

### Netlify 사이트 연결 + DB 프로비저닝 (최초 1회)

Netlify DB는 실제 Netlify 계정/사이트에 연결해야 만들어지기 때문에, 아래 과정은 Netlify 계정 권한이 있는 사람이
직접 실행해야 합니다.

1. https://app.netlify.com 에서 **Add new site → Import an existing project → Deploy with GitHub**
2. Netlify GitHub App 권한 화면에서 `anzm1233-code/family-group-app` 저장소를 (비공개 상태로) 선택해 접근 권한 부여
3. 브랜치로 `claude/react-webapp-setup-deploy-kzcw75` (또는 이후 병합할 `main`) 선택
4. Build command / Publish directory / Functions directory는 `netlify.toml`에서 자동으로 읽어옵니다
5. 로컬에서 CLI로 사이트를 연결하고 DB를 프로비저닝합니다:
   ```bash
   npx netlify-cli login
   npx netlify-cli link          # 방금 만든 사이트와 연결
   npx netlify-cli db init       # Netlify DB(Postgres) 생성, NETLIFY_DB_URL 환경변수 자동 연결
   ```
6. Deploy site — 이후로는 해당 브랜치에 push할 때마다 자동으로 재배포됩니다

### 로컬에서 수동 배포

```bash
npm run build
npx netlify-cli deploy --prod --dir=dist
```

(Netlify CLI 로그인이 필요합니다: `npx netlify-cli login`)
