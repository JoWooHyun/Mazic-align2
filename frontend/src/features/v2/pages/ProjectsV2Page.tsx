import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjectsV2 } from "../hooks/useProjectsV2";

/**
 * v2 프로젝트 목록 화면.
 *
 * 옛 ProjectPage 와 무관하게 다시 짠다. 로그인 / 권한 / 백엔드
 * 통신 없음. IndexedDB 단일 출처.
 */
const ProjectsV2Page: React.FC = () => {
  const navigate = useNavigate();
  const { projects, loading, error, create, remove } = useProjectsV2();
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    try {
      const project = await create({ name: newName.trim() });
      setShowDialog(false);
      setNewName("");
      navigate(`/v2/viewer/${project.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`프로젝트 "${name}" 을(를) 삭제할까요?`)) return;
    await remove(id);
  }

  // 목록 화면에는 뷰어가 없어 STL 을 드롭할 대상이 없다. 기본 동작을
  // 막지 않으면 브라우저가 파일을 그대로 열어버리므로 preventDefault 하고
  // 프로젝트를 먼저 열도록 안내한다.
  const handlePageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handlePageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      window.alert("프로젝트를 먼저 열고 뷰어에 드롭하세요");
    }
  };

  return (
    <div
      className="min-h-screen bg-gray-50"
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary-600">MazicAlign</h1>
          <span className="text-sm text-gray-500">Local</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">My Projects</h2>
          <button
            onClick={() => setShowDialog(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            + New Project
          </button>
        </div>

        {loading && <p className="text-gray-500">Loading…</p>}
        {error && (
          <p className="text-red-600">불러오기 실패: {error.message}</p>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="p-12 text-center text-gray-500 bg-white rounded-lg border border-dashed">
            아직 프로젝트가 없습니다. <br />
            <span className="text-sm">상단의 + New Project 로 시작하세요.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <article
              key={p.id}
              className="p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/v2/viewer/${p.id}`)}
            >
              <h3 className="text-lg font-bold text-gray-900">{p.name}</h3>
              <p className="text-sm text-gray-500 mt-2">
                Code: <span className="font-mono">{p.code}</span>
              </p>
              <p className="text-sm text-gray-500">
                Last modified: {formatDate(p.lastModifiedAt)}
              </p>
              {p.note && (
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                  {p.note}
                </p>
              )}
              <div className="mt-3 text-right">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(p.id, p.name);
                  }}
                  className="text-sm text-red-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </main>

      {showDialog && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
          onClick={() => !submitting && setShowDialog(false)}
        >
          <div
            className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-4">새 프로젝트</h3>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">이름</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="예: 환자 12345"
              />
            </label>

            <div className="mt-6 flex justify-end space-x-2">
              <button
                onClick={() => setShowDialog(false)}
                disabled={submitting}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={submitting || !newName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "만드는 중…" : "만들기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

export default ProjectsV2Page;
