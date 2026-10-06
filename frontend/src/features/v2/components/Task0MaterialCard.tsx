import {
  TASK0_DEFAULT_MATERIAL_NAME,
  TASK0_DEFAULT_MATERIAL_NAME_B,
} from "../utils/task0/task0-jobzip";
import {
  TASK0_SLOT_COLOR_HEX,
  type Task0MaterialMode,
} from "../utils/task0/task0-material";
import type { Task0MaterialSlot } from "../utils/task0/task0-slice";

/** 재료 카드 입력 (D1b) — pages/viewer/hooks/useTask0Material 이 만든다 */
export interface Task0MaterialCardProps {
  /** 프로젝트 재료 모드 (없으면 단일 — task0-material resolveTask0MaterialMode) */
  mode: Task0MaterialMode;
  onModeChange: (mode: Task0MaterialMode) => void;
  /** STL 목록 순서 그대로 — slot 은 기본값을 채운 값(없으면 B) */
  files: { id: string; fileName: string; slot: Task0MaterialSlot }[];
  onSlotChange: (id: string, slot: Task0MaterialSlot) => void;
  /** 내보내기 중에는 바꾸지 못하게 */
  disabled?: boolean;
}

/** 재료 색 견본 — 3D 씬 색(handle setMaterialSlotColors)과 같은 값 */
function SlotSwatch({ slot }: { slot: Task0MaterialSlot }) {
  return (
    <span
      className="w-3 h-3 rounded-sm flex-shrink-0"
      style={{ backgroundColor: TASK0_SLOT_COLOR_HEX[slot] }}
    />
  );
}

/** A / B 고르기 (STL 한 줄) — 슬라이스 패널 재료 카드와 왼쪽 모델 목록이 같이 쓴다 */
export function Task0SlotToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: Task0MaterialSlot;
  onChange: (slot: Task0MaterialSlot) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex flex-shrink-0 rounded border border-gray-300 overflow-hidden text-xs"
      role="group"
      aria-label="재료 슬롯"
    >
      {(["A", "B"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // 목록 줄 선택(onPick)으로 번지지 않게
            if (s !== value) onChange(s);
          }}
          disabled={disabled}
          aria-pressed={s === value}
          title={s === "A" ? "재료 A (T0)" : "재료 B (T1)"}
          className={`px-2 py-0.5 font-medium disabled:opacity-40 ${
            s === value ? "text-white" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
          style={s === value ? { backgroundColor: TASK0_SLOT_COLOR_HEX[s] } : undefined}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

/**
 * Task0 재료 모드 + 파일별 재료 (2재료 D1b) — 슬라이스 패널(Task0 프로파일)의 재료 카드 본문.
 * 단일 재료 = 모든 모델·서포트를 T0 하나로(지금까지의 출력 그대로). 2재료 = 서포트는 항상 A(T0), STL 은 파일마다 A/B(기본 B) —
 * `docs/계획_하이브리드슬라이서설정_20260928.md` §5-1·§5-2, 규격서 v0.3.4 §6.
 */
export default function Task0MaterialCard({
  mode,
  onModeChange,
  files,
  onSlotChange,
  disabled = false,
}: Task0MaterialCardProps) {
  const modeButton = (m: Task0MaterialMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (m !== mode) onModeChange(m);
      }}
      disabled={disabled}
      aria-pressed={m === mode}
      className={`flex-1 px-3 py-1.5 transition-colors disabled:opacity-40 ${
        m === mode
          ? "bg-primary-600 text-white"
          : "bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex rounded border border-gray-300 overflow-hidden text-sm"
        role="group"
        aria-label="재료 모드"
      >
        {modeButton("single", "단일 재료")}
        {modeButton("dual", "2재료 (T0 / T1)")}
      </div>
      {mode === "single" ? (
        <p className="text-xs text-gray-500">
          모든 모델·서포트를 재료 A(T0 · {TASK0_DEFAULT_MATERIAL_NAME}) 하나로 칠합니다.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <SlotSwatch slot="A" /> A · T0 · {TASK0_DEFAULT_MATERIAL_NAME} — 서포트는 항상 A
            </span>
            <span className="flex items-center gap-1.5">
              <SlotSwatch slot="B" /> B · T1 · {TASK0_DEFAULT_MATERIAL_NAME_B}
            </span>
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-gray-400">모델이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <SlotSwatch slot={f.slot} />
                  <span className="flex-1 min-w-0 truncate text-gray-700" title={f.fileName}>
                    {f.fileName}
                  </span>
                  <Task0SlotToggle
                    value={f.slot}
                    onChange={(s) => onSlotChange(f.id, s)}
                    disabled={disabled}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400">
            층마다 A(T0) → B(T1) 순서로 칠하고, 겹친 곳은 B 만 칠합니다. 노광은 층당 한 번(두 재료 합집합).
            3D 화면에서 A 는 주황, B 는 보라로 보입니다(새 파일의 기본은 B).
          </p>
        </>
      )}
    </div>
  );
}
