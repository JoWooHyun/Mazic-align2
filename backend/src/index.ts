import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from '@config/database.js';
import { SERVER_CONFIG } from '@config/server.config.js';
import projectRoutes from '@routes/project.routes.js';
import stlRoutes from '@routes/stl.routes.js';
import fsRoutes from '@routes/fs.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SQLite DB 초기화
initDatabase();

const app = express();

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 로컬 STL 파일 정적 서빙 (/uploads/stl/{projectId}/{filename})
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// 헬스 체크 엔드포인트
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: SERVER_CONFIG.NODE_ENV,
  });
});

// API 라우트
app.use('/api/projects', projectRoutes);
app.use('/api/stl', stlRoutes);
app.use('/api/fs', fsRoutes);

// 프론트엔드 정적 파일 서빙 — 프로덕션에서만.
// 개발 모드에서는 Vite(:5173)가 SPA 라우팅을 담당하므로 백엔드는 /api·/uploads·/health 만 처리한다.
if (SERVER_CONFIG.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 에러 핸들링 미들웨어
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// 서버 시작
const PORT = SERVER_CONFIG.PORT;
app.listen(PORT, () => {
  console.log(`✅ MazicAlign 서버 시작: http://localhost:${PORT}`);
  console.log(`✅ 환경: ${SERVER_CONFIG.NODE_ENV}`);
  console.log(`✅ DB: ${path.join(process.cwd(), 'data/mazicalign.db')}`);
  console.log(`✅ 업로드 경로: ${path.join(process.cwd(), 'uploads')}`);
});

export default app;
