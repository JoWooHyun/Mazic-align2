# MazicAlign

**로컬 PC 전용 3D STL 뷰어 · 슬라이서 플랫폼**

인터넷 연결 없이 로컬 PC에서 완전히 동작하는 치과/교정용 3D STL 관리 시스템입니다.
ZIP 압축 해제 → `start-dev.bat` 더블클릭 한 번으로 바로 사용 가능합니다.
(v2는 프론트엔드만으로 완결 — 백엔드 서버 불요, 데이터는 브라우저 IndexedDB에 저장.)

---

## v1 / v2 공존 상태 (중요)

현재 저장소에는 구버전(v1)과 신버전(v2) 화면이 함께 들어 있습니다.

- **v2 (`frontend/src/features/v2`) — 현재 메인라인.** 모든 신규 작업은 v2에서 진행합니다.
  IndexedDB 기반 로컬 격리 작업 공간, undo, 프린터 프로파일, ctb 지원.
  루트(`/`) 접속 시 자동으로 `/v2/projects` 로 이동합니다.
- **v1 (`frontend/src/pages`, `frontend/src/components`) — 동결(freeze).**
  ADR-2 결정에 따라 v1은 유지보수만 하고 신규 기능을 추가하지 않습니다.
  기존 v1 경로(`/projects`, `/viewer/:id` 등)는 주소 직접 입력으로만 접근 가능하며,
  각 v1 화면 상단에는 동결 안내 배너가 표시됩니다.
- Express/SQLite 백엔드는 동결 상태입니다(삭제 금지, 신규 의존 금지).

> 신규 화면·기능은 반드시 v2에서 작업하세요. v1 파일은 배너/버그픽스 외 수정 금지.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **3D STL 뷰어** | BabylonJS 기반 WebGL 실시간 3D 렌더링 |
| **로컬 파일 탐색기** | 브라우저 파일 선택 없이 PC 폴더를 직접 탐색하여 STL 열기 |
| **Transform 조정** | 이동 / 회전 / 스케일 수치 입력 및 Gizmo 드래그 |
| **다중 파일 관리** | 파일별 가시성 토글, 투명도 조절, 삭제 |
| **변경 이력** | STL 조정 내역 자동 기록 및 조회 |
| **FDM 슬라이서** | 레이어 단면 추출 + G-code 생성 (Web Worker) |
| **DLP 슬라이서** | 레이어별 마스크 이미지 생성 (OffscreenCanvas) |
| **프로젝트 관리** | 프로젝트 생성 / 수정 / 삭제 |

---

## 기술 스택

### Frontend
- **React 18** + TypeScript
- **Vite 5** (빌드)
- **BabylonJS 6** (3D WebGL 렌더링)
- **Tailwind CSS 3** (스타일링)
- **Zustand** (상태 관리)
- Web Worker (FDM/DLP 슬라이서 — 메인 스레드 블로킹 방지)

### Backend
- **Node.js 22 LTS** + Express 4
- **TypeScript** (tsc + tsc-alias 빌드)
- **SQLite** (better-sqlite3 v11) — 단일 파일 DB
- **Multer** — 로컬 파일 저장

### 데이터 저장
- DB: `backend/data/mazicalign.db` (자동 생성)
- STL: `backend/uploads/stl/{projectId}/` (자동 생성)

---

## 프로젝트 구조

```
MazicAlign/
├── frontend/
│   └── src/
│       ├── components/         # UI 컴포넌트 (STLViewer, LocalFileBrowser, Slicer 등)
│       ├── pages/              # 페이지 (ProjectList, Viewer)
│       ├── hooks/              # 커스텀 훅
│       ├── services/           # API 호출 + 슬라이서 엔진
│       ├── types/              # TypeScript 타입 정의
│       └── utils/              # 유틸리티 함수
│
├── backend/
│   ├── src/
│   │   ├── controllers/        # 라우트 핸들러
│   │   ├── services/           # 비즈니스 로직 (SQLite CRUD)
│   │   ├── routes/             # 라우트 (projects, stl, fs)
│   │   └── config/             # DB 초기화 (database.ts)
│   ├── data/                   # SQLite DB (자동 생성)
│   └── uploads/                # STL 파일 저장 (자동 생성)
│
├── install.bat                  # 최초 1회: frontend npm install
├── start-dev.bat                # 실행 (없으면 자동 설치 후 dev 서버 기동)
├── stop-dev.bat                 # 서버 종료 (포트 5173)
├── build.bat                    # 빌드 (frontend/dist 생성)
└── DESIGN.md                    # v2 재설계 기획 문서
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 |
| GET | `/api/fs?path=` | 로컬 PC 폴더 탐색 |
| CRUD | `/api/projects` | 프로젝트 관리 |
| GET | `/api/stl?projectId=` | STL 파일 목록 |
| POST | `/api/stl/import-path` | 로컬 경로에서 STL 가져오기 |
| PUT | `/api/stl/:id/transform` | Transform 저장 |
| GET/POST/DELETE | `/api/stl/:id/logs` | 조정 이력 |

---

## 빠른 시작

### 더블클릭 (권장)

```
처음:  start-dev.bat   ← 의존성 자동 설치 후 dev 서버 기동 → 브라우저 자동 오픈
이후:  start-dev.bat   ← 바로 dev 서버 기동
종료:  창을 닫거나 stop-dev.bat
```

`install.bat` 로 의존성만 먼저 설치해 둘 수도 있지만, `start-dev.bat` 이
없으면 자동으로 설치하므로 처음이라도 `start-dev.bat` 하나면 충분합니다.
(설치 순서를 신경 쓸 필요 없음)

### 수동 실행 (명령 프롬프트)

```cmd
cd frontend
npm install
npm run dev
```

### 접속 주소

- **이 PC**: http://localhost:5173/v2
- **같은 네트워크의 다른 기기**: http://<이 PC IP>:5173/v2 (실행 시 콘솔에 표시)

---

## 사전 요구사항

| 항목 | 버전 |
|------|------|
| **Node.js** | 22 LTS 이상 |
| **OS** | Windows 10 / 11 |
| 인터넷 | 설치 시 1회만 필요 (npm install) |

Node.js 설치: https://nodejs.org/ (LTS 버전)

---

## 문제 해결

**서버가 시작되지 않음**
```
Node.js LTS 설치 여부 확인 (https://nodejs.org/)
frontend/node_modules 가 없으면 start-dev.bat 이 자동 설치함
```

**포트 5173 충돌** (`Port 5173 is already in use`)
```cmd
stop-dev.bat
start-dev.bat
```

**STL 파일이 뷰어에 표시되지 않음**
- `+ STL 파일 열기` 버튼 → 로컬 PC 탐색기 → STL 파일 선택
- 파일 경로에 한글/특수문자가 포함된 경우 영문 경로로 이동 후 시도

---

## v2 재설계 계획

> Three.js + react-three/fiber 기반으로 전면 재설계 예정.
> 자세한 내용은 [`DESIGN.md`](./DESIGN.md) 참조.

| 항목 | v1 (현재) | v2 (예정) |
|------|-----------|-----------|
| 3D 엔진 | BabylonJS | Three.js + @react-three/fiber |
| Gizmo | 커스텀 구현 | @react-three/drei TransformControls |
| 슬라이서 | Web Worker | Web Worker (동일, 성능 개선) |
| UI | 현재 | 전면 재디자인 |
