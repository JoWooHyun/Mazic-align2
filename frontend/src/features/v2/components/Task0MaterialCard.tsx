import { useEffect, useState } from "react";

import { TASK0_DEFAULT_MATERIAL_NAME } from "../utils/task0/task0-jobzip";
import {
  TASK0_DEFAULT_MATERIAL_NAMES,
  TASK0_MATERIAL_NAME_MAX_LENGTH,
  TASK0_SLOT_COLOR_HEX,
  normalizeTask0MaterialName,
  type Task0MaterialMode,
  type Task0MaterialNames,
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
  /** 재료 이름 (D2 — 정규화·기본값을 채운 값, task0-material resolveTask0MaterialNames). 2재료 job.zip manifest 에 쓰인다 */
  names: Task0MaterialNames;
  /** 재료 이름을 바꿀 때 — 입력을 마칠 때(blur·Enter)만 부른다(타이핑마다 저장하지 않는다) */
  onNameChange: (slot: Task0MaterialSlot, name: string) => void;
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

/**
 * 재료 이름 입력 (D2) — 타이핑은 이 칸 안 상태만 바꾸고, 입력을 마칠 때(blur · Enter)만 정규화(task0-material
 * normalizeTask0MaterialName — 저장·manifest 와 같은 함수)해 onCommit 한다. Esc 는 되돌림. 한글 조합 중 Enter 는 무시.
 * 비우면 기본 이름으로 돌아간다.
 */
function MaterialNameInput({
  slot,
  value,
  onCommit,
  disabled,
}: {
  slot: Task0MaterialSlot;
  value: string;
  onCommit: (name: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // 저장된 값이 바뀌면(저장 완료·다른 프로젝트) 칸도 맞춘다
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = normalizeTask0MaterialName(draft, TASK0_DEFAULT_MATERIAL_NAMES[slot]);
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      value={draft}
      maxLength={TASK0_MATERIAL_NAME_MAX_LENGTH}
      disabled={disabled}
      aria-label={`재료 ${slot} 이름`}
      title={`재료 ${slot} 이름 — job.zip 에 적혀 Task0 화면에 보입니다 (비우면 ${TASK0_DEFAULT_MATERIAL_NAMES[slot]})`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.currentTarget.blur(); // blur 가 commit
        } else if (e.key === "Escape") {
          setDraft(value);
        }
      }}
      className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-xs text-gray-700 disabled:opacity-40"
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
  names,
  onNameChange,
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
          <div className="flex flex-col gap-1 text-xs text-gray-600">
            <label className="flex items-center gap-1.5">
              <SlotSwatch slot="A" />
              <span className="flex-shrink-0">A · T0</span>
              <MaterialNameInput
                slot="A"
                value={names.A}
                onCommit={(n) => onNameChange("A", n)}
                disabled={disabled}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <SlotSwatch slot="B" />
              <span className="flex-shrink-0">B · T1</span>
              <MaterialNameInput
                slot="B"
                value={names.B}
                onCommit={(n) => onNameChange("B", n)}
                disabled={disabled}
              />
            </label>
            <span className="text-gray-500">서포트는 항상 A · 이름은 job.zip 에 적혀 Task0 화면에 보입니다</span>
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
            3D 화면·단면에서 A 는 주황, B 는 보라로 보입니다(새 파일의 기본은 B, 복제·붙여넣기는 원본 재료를 따릅니다).
          </p>
        </>
      )}
    </div>
  );
}
