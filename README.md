# 우리 그룹 (Family Group App)

가족, 회사, 학급 등 그룹 단위로 할일과 일정을 공유하는 웹앱 프로토타입입니다. React + Vite로 만들어졌습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 확인할 수 있습니다.

## 빌드

```bash
npm run build
npm run preview
```

## 배포 (Netlify)

이 저장소는 비공개로 유지하면서 Netlify에 배포합니다. 빌드 설정은 `netlify.toml`에 정의되어 있습니다.

- Build command: `npm run build`
- Publish directory: `dist`

### Netlify 사이트 연결 (최초 1회)

1. https://app.netlify.com 에서 **Add new site → Import an existing project → Deploy with GitHub**
2. Netlify GitHub App 권한 화면에서 `anzm1233-code/family-group-app` 저장소를 (비공개 상태로) 선택해 접근 권한 부여
3. 브랜치로 `claude/react-webapp-setup-deploy-kzcw75` (또는 이후 병합할 `main`) 선택
4. Build command / Publish directory는 `netlify.toml`에서 자동으로 읽어옵니다
5. Deploy site 클릭 — 이후로는 해당 브랜치에 push할 때마다 자동으로 재배포됩니다

### 로컬에서 수동 배포

```bash
npm run build
npx netlify-cli deploy --prod --dir=dist
```

(Netlify CLI 로그인이 필요합니다: `npx netlify-cli login`)
