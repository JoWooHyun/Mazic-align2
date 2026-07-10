import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ProjectPage from '@pages/ProjectPage';
import ViewerPage from '@pages/ViewerPage';
import { ProjectsV2Page, ViewerV2Page } from './features/v2';

function App() {
  return (
    <Router>
      <Routes>
        {/* 루트 진입은 v2로 — v1은 동결(ADR-2). 기존 v1 경로는 직접 접근만 유지 */}
        <Route path="/" element={<Navigate to="/v2/projects" replace />} />
        <Route path="/projects" element={<ProjectPage />} />
        <Route path="/viewer/:projectId" element={<ViewerPage />} />

        {/* v2 routes — IndexedDB 기반 로컬 격리 작업 공간 */}
        <Route path="/v2" element={<Navigate to="/v2/projects" replace />} />
        <Route path="/v2/projects" element={<ProjectsV2Page />} />
        <Route path="/v2/viewer/:projectId" element={<ViewerV2Page />} />
      </Routes>
    </Router>
  );
}

export default App;
