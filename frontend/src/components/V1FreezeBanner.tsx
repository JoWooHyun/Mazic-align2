import { Link } from 'react-router-dom';

/**
 * 구버전(v1) 화면 상단 고정 동결 배너.
 * v1은 ADR-2에 따라 동결 상태 — 신규 작업은 v2에서 진행한다.
 * v1 페이지 JSX 최상단에 삽입하여 실수로 v1에서 작업하는 것을 방지한다.
 */
const V1FreezeBanner: React.FC = () => {
  return (
    <div className="bg-yellow-400 text-yellow-900 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium shadow-sm">
      <span>⚠️ 구버전(v1) 화면입니다 — 신규 작업은 v2를 사용하세요.</span>
      <Link
        to="/v2/projects"
        className="px-3 py-1 bg-yellow-900 text-yellow-50 rounded hover:bg-yellow-800 transition-colors"
      >
        v2로 이동
      </Link>
    </div>
  );
};

export default V1FreezeBanner;
