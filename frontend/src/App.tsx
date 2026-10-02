import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import ProjectPage from '@pages/ProjectPage';
import ViewerPage from '@pages/ViewerPage';
import { ProjectsV2Page, ViewerV2Page } from './features/v2';
import ErrorBoundary, { DevCrashProbe } from './features/v2/components/ErrorBoundary';

/**
 * v2 뷰어 라우트 — 렌더 예외 경계로 감싼다 (데모 사고 방지 1차 C).
 *   key=projectId 라 다른 프로젝트로 이동하면 경계(오류 상태)가 초기화된다.
 *   DevCrashProbe 는 dev 전용 `?crash=1` 수동 확인 장치 — 프로덕션 빌드에서는
 *   `import.meta.env.DEV` 가 false 로 치환돼 렌더·번들 모두에서 빠진다.
 */
function ViewerV2Route() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ErrorBoundary key={projectId}>
      {import.meta.env.DEV && <DevCrashProbe />}
      <ViewerV2Page />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        {/* 루트 진입은 v2로 — v1은 동결(ADR-2). 기존 v1 경로는 직접 접근만 유지 */}
        <Route path="/" element={<Navigate to="/v2/projects" replace />} />
        <Route path="/projects" element={<ProjectPage />} />
        <Route path="/viewer/:projectId" element={<ViewerPage />} />

        {/* v2 routes — IndexedDB 기반 로컬 격리 작업 공간 (렌더 예외 경계로 감쌈) */}
        <Route path="/v2" element={<Navigate to="/v2/projects" replace />} />
        <Route
          path="/v2/projects"
          element={
            <ErrorBoundary>
              <ProjectsV2Page />
            </ErrorBoundary>
          }
        />
        <Route path="/v2/viewer/:projectId" element={<ViewerV2Route />} />
      </Routes>
    </Router>
  );
}

export default App;
