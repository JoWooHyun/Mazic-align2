import { useEffect, useState } from "react";

/**
 * v2 전용 로컬 파일 브라우저.
 *
 * 옛 LocalFileBrowser 와 무관하게 다시 짠다. 브라우저의 표준 파일
 * picker 가 회사 보안프로그램에 차단되는 환경 대응으로, 백엔드
 * /api/fs (listing) 와 /api/fs/read (raw bytes) 를 거쳐 STL 을
 * 가져온다.
 *
 * 데이터 저장은 여전히 IndexedDB. 백엔드는 단순 read-only.
 */

interface FsItem {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  size: number | null;
}

interface FsResponse {
  success: boolean;
  currentPath: string;
  parentPath: string | null;
  items: FsItem[];
}

interface Props {
  onSelect: (file: { name: string; blob: Blob }) => void;
  onClose: () => void;
}

// 백엔드 서버가 꺼져 있을 때 사용자에게 대체 경로를 안내하는 메시지.
const BACKEND_OFF_MESSAGE =
  "백엔드 서버가 꺼져 있습니다. '내 PC에서 열기'를 사용하세요.";

const LocalFileBrowser: React.FC<Props> = ({ onSelect, onClose }) => {
  const [currentPath, setCurrentPath] = useState("/");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [items, setItems] = useState<FsItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("/");
  const [opening, setOpening] = useState(false);

  async function browse(p: string) {
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    const url =
      p === "/" ? "/api/fs" : `/api/fs?path=${encodeURIComponent(p)}`;
    let data: FsResponse;
    try {
      const res = await fetch(url);
      data = (await res.json()) as FsResponse;
    } catch {
      // fetch 실패 / JSON 파싱 실패 = 백엔드 미기동. raw 에러 대신
      // 대체 경로("내 PC에서 열기") 안내. (백엔드가 살아있을 때의
      // 400 / success:false 는 아래 정상 처리로 넘어간다.)
      setError(BACKEND_OFF_MESSAGE);
      setLoading(false);
      return;
    }
    try {
      if (!data.success) {
        throw new Error("디렉토리를 읽을 수 없습니다.");
      }
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setPathInput(data.currentPath);
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void browse("/");
  }, []);

  function handleItemClick(item: FsItem) {
    if (item.isDirectory) {
      void browse(item.fullPath);
    } else {
      // STL 파일 단일 선택 토글
      setSelectedPath((prev) =>
        prev === item.fullPath ? null : item.fullPath,
      );
    }
  }

  async function handleOpen() {
    if (!selectedPath || opening) return;
    setOpening(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(
        `/api/fs/read?path=${encodeURIComponent(selectedPath)}`,
      );
    } catch {
      // fetch 자체 실패 = 백엔드 미기동.
      setError(BACKEND_OFF_MESSAGE);
      setOpening(false);
      return;
    }
    try {
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "파일을 읽을 수 없습니다." }));
        throw new Error(
          (body as { error?: string }).error ?? "파일을 읽을 수 없습니다.",
        );
      }
      const blob = await res.blob();
      const name =
        selectedPath.split(/[\\/]/).pop() ?? "model.stl";
      onSelect({ name, blob });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  function handlePathSubmit(e: React.FormEvent) {
    e.preventDefault();
    void browse(pathInput);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">
            로컬 STL 파일 열기
          </h2>
          <button
            onClick={onClose}
            disabled={opening}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={handlePathSubmit}
          className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50"
        >
          <button
            type="button"
            onClick={() => parentPath && browse(parentPath)}
            disabled={!parentPath}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
            title="상위 폴더"
          >
            <svg
              className="w-5 h-5 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="flex-1 text-sm border border-gray-300 rounded px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary-400"
            placeholder="경로 입력 후 Enter"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            이동
          </button>
        </form>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && (
            <div className="text-center py-8 text-gray-400 text-sm">
              불러오는 중…
            </div>
          )}
          {error && (
            <div className="text-center py-8 text-red-500 text-sm">{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              STL 파일이 없습니다.
            </div>
          )}
          {!loading &&
            !error &&
            items.map((item) => (
              <div
                key={item.fullPath}
                onClick={() => handleItemClick(item)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selectedPath === item.fullPath
                    ? "bg-primary-100 border border-primary-400"
                    : "hover:bg-gray-50"
                }`}
              >
                {item.isDirectory ? (
                  <svg
                    className="w-5 h-5 text-yellow-400 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-blue-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                )}
                <span className="flex-1 text-sm text-gray-800 truncate">
                  {item.name}
                </span>
                {!item.isDirectory && (
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatSize(item.size)}
                  </span>
                )}
                {item.isDirectory && (
                  <svg
                    className="w-4 h-4 text-gray-300 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                )}
              </div>
            ))}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <span className="text-sm text-gray-500">
            {selectedPath ? selectedPath : "STL 파일을 클릭하여 선택"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={opening}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-30"
            >
              취소
            </button>
            <button
              onClick={() => void handleOpen()}
              disabled={!selectedPath || opening}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
            >
              {opening ? "여는 중…" : "열기"}
            </button>
          </div>
        </div>
      </div>
      <CurrentPathTag path={currentPath} />
    </div>
  );
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 디버그 식별용. 표시는 안 함. */
function CurrentPathTag({ path }: { path: string }) {
  return <span data-current-path={path} style={{ display: "none" }} />;
}

export default LocalFileBrowser;
