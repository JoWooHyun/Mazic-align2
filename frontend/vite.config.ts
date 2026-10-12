import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@apptypes': path.resolve(__dirname, './src/types'),
      '@config': path.resolve(__dirname, './src/config'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // 데모 수정 1차 ④ — 내보내기 중 개발 서버가 페이지를 통째로 새로고침하던 문제(리드 10/12 터미널:
  //   "optimized dependencies changed. reloading"). 워커(`?worker` import)는 시작 시 의존성 스캔에 안 잡혀,
  //   내보내기에서 워커가 처음 뜰 때 그 그래프의 외부 패키지(js-clipper — utils/gcode/polygon-clipper)를
  //   Vite 가 실행 중에 발견 → 재최적화 → 전체 새로고침 → 진행 중 내보내기가 날아갔다.
  //   → 워커 파일을 스캔 entry 에 넣고, 워커 그래프의 외부 패키지를 미리 묶는다.
  //   include 는 실측(워커 2종의 import 그래프를 따라간 외부 패키지): js-clipper, @babylonjs/core(slice-section).
  //   manifold-3d 는 워커 그래프에 없다(메인 스레드 전용). 개발 서버 전용 설정 — build 산출물과 무관.
  optimizeDeps: {
    entries: ['index.html', 'src/features/v2/workers/*.ts'],
    include: ['js-clipper', '@babylonjs/core'],
  },
});
