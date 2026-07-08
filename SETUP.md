# MazicAlign 설정 가이드 (v2)

v2는 **프론트엔드만으로 완결**됩니다. 별도 백엔드 서버가 필요 없고, 데이터는 브라우저의 IndexedDB에 저장됩니다.

## 사전 요구사항

- Node.js 18 이상 — https://nodejs.org/ (LTS 버전 권장)
- npm (Node.js 설치 시 자동 포함)
- Windows 10 / 11

npm install 시 1회 인터넷 연결이 필요합니다. 이후에는 오프라인으로 동작합니다.

---

## 실행 방법 (더블클릭)

| 상황 | 실행할 파일 |
|------|------------|
| **처음 실행** | `install.bat` 또는 `start-dev.bat` 더블클릭 |
| **이후 실행** | `start-dev.bat` 더블클릭 |
| **서버 종료** | `start-dev.bat` 창을 닫거나 `stop-dev.bat` 더블클릭 |

- `install.bat` — 의존성만 설치하고 끝냅니다.
- `start-dev.bat` — 의존성이 없으면 **자동으로 먼저 설치한 뒤** 개발 서버를 실행합니다.
  따라서 처음이라도 `start-dev.bat` 하나만 더블클릭하면 됩니다. (설치 순서를 신경 쓸 필요 없음)
- 서버가 뜨면 몇 초 뒤 브라우저가 자동으로 `http://localhost:5173/v2` 를 엽니다.

### 접속 주소

- 이 PC: `http://localhost:5173/v2`
- 같은 네트워크의 다른 기기: `http://<이 PC의 IP>:5173/v2`
  (start-dev.bat 실행 시 콘솔에 LAN 주소가 표시됩니다.)

---

## 수동 실행 (명령 프롬프트)

```cmd
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/v2` 접속.

---

## 빌드 (배포용 정적 파일)

```cmd
build.bat
```

또는 수동:

```cmd
cd frontend
npm run build
```

- 산출물 위치: `frontend\dist\`
- `build.bat` 도 의존성이 없으면 자동으로 먼저 설치합니다.

---

## 문제 해결

### 포트 5173 이미 사용 중

다른 서버가 5173 포트를 쓰고 있으면 `start-dev.bat` 실행 시
`Port 5173 is already in use` 오류가 표시되고 서버가 시작되지 않습니다.

```cmd
stop-dev.bat
```

→ 실행 후 다시 `start-dev.bat`. (stop-dev.bat 은 5173 포트를 쓰는 서버만 종료하므로
다른 node 프로세스에는 영향을 주지 않습니다.)

### Node.js is not installed 오류

https://nodejs.org/ 에서 LTS 버전을 설치한 뒤 다시 실행하세요.

### 3D 모델이 표시되지 않음

- STL 파일 형식 확인 (바이너리/ASCII STL 모두 지원)
- 브라우저 콘솔(F12) 에러 메시지 확인

---

## 데이터 위치

v2 데이터(프로젝트, STL 조정 내역 등)는 브라우저의 **IndexedDB** 에 저장됩니다.
같은 브라우저로 다시 접속하면 데이터가 유지됩니다. (별도 DB 파일/서버 없음)

---

## 개발 구조

- **Frontend** — React 18 + TypeScript + Babylon.js + Tailwind + Vite
- **저장소** — 브라우저 IndexedDB (백엔드 불요)
- **슬라이서** — Web Worker (FDM/DLP)

### Path Alias

```typescript
import STLViewer from '@components/STLViewer';
```
