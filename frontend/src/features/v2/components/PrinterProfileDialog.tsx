import { useEffect, useRef, useState } from "react";

import {
  BUILT_IN_PROFILES,
  isBuiltIn,
  useAllProfiles,
  usePrinterProfileStore,
} from "../hooks/usePrinterProfileStore";
import {
  DEFAULT_EXPOSURE_SEC,
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
  DEFAULT_TRANSITION_LAYER_COUNT,
  DEFAULT_LIFT_DISTANCE_MM,
  DEFAULT_LIFT_SPEED_MM_S,
  DEFAULT_RETRACT_SPEED_MM_S,
  DEFAULT_LIGHT_OFF_DELAY_SEC,
  PROFILE_FIELD_LIMITS,
  type PrinterProfileV2,
} from "../types/printer";
// 로컬 NumberInput 래퍼와 이름이 겹치지 않게 별칭으로 받는다 (B-14).
import CommitNumberInput from "./common/NumberInput";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Draft {
  name: string;
  lcdWidthPx: number;
  lcdHeightPx: number;
  pixelPitchUm: number;
  bvX: number;
  bvY: number;
  bvZ: number;
  exposureSec: number;
  bottomExposureSec: number;
  bottomLayerCount: number;
  transitionLayerCount: number;
  liftDistanceMm: number;
  liftSpeedMmS: number;
  retractSpeedMmS: number;
  lightOffDelaySec: number;
}

const EMPTY_DRAFT: Draft = {
  name: "내 프린터",
  lcdWidthPx: 4098,
  lcdHeightPx: 2560,
  pixelPitchUm: 35,
  bvX: 143.43,
  bvY: 89.6,
  bvZ: 175,
  exposureSec: DEFAULT_EXPOSURE_SEC,
  bottomExposureSec: DEFAULT_BOTTOM_EXPOSURE_SEC,
  bottomLayerCount: DEFAULT_BOTTOM_LAYER_COUNT,
  transitionLayerCount: DEFAULT_TRANSITION_LAYER_COUNT,
  liftDistanceMm: DEFAULT_LIFT_DISTANCE_MM,
  liftSpeedMmS: DEFAULT_LIFT_SPEED_MM_S,
  retractSpeedMmS: DEFAULT_RETRACT_SPEED_MM_S,
  lightOffDelaySec: DEFAULT_LIGHT_OFF_DELAY_SEC,
};

const L = PROFILE_FIELD_LIMITS;

/** 한계 위반이면 한국어 사유 한 줄, 아니면 null. */
function checkRange(
  value: number,
  limit: { min: number; max: number },
  message: string,
): string | null {
  if (!Number.isFinite(value) || value < limit.min || value > limit.max) {
    return message;
  }
  return null;
}

/**
 * draft 검증 (P0-3, 검수_20260915 V-8/V-9).
 *
 * errors 는 저장을 막는다 — 워커 OOM(초대형 해상도)이나 실기에서 못 쓰는
 * 파일(리프트 속도 0)을 만들기 전에 차단하는 것이 목적이다.
 * warnings 는 저장은 허용하되 리드가 값을 다시 볼 수 있게 노란색으로 알린다.
 * 문구는 비개발자가 그대로 읽는 안내이므로 한국어 + 단위를 반드시 적는다.
 *
 * NumberInput 은 Enter/blur 커밋이라 draft 는 자주 바뀌지 않는다 —
 * 매 렌더 계산으로 충분하고 debounce 는 두지 않는다.
 */
function validateDraft(d: Draft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const push = (m: string | null) => {
    if (m) errors.push(m);
  };

  if (!d.name.trim()) {
    errors.push("프로파일 이름을 입력하세요.");
  }

  push(
    checkRange(
      d.lcdWidthPx,
      L.lcdPx,
      `LCD 가로 해상도는 ${L.lcdPx.min}~${L.lcdPx.max} px 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.lcdHeightPx,
      L.lcdPx,
      `LCD 세로 해상도는 ${L.lcdPx.min}~${L.lcdPx.max} px 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.pixelPitchUm,
      L.pixelPitchUm,
      `픽셀 피치는 ${L.pixelPitchUm.min}~${L.pixelPitchUm.max} µm 사이여야 합니다.`,
    ),
  );

  const bv = L.buildVolumeMm;
  push(
    checkRange(
      d.bvX,
      bv,
      `빌드 볼륨 X(가로)는 ${bv.min}~${bv.max} mm 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.bvY,
      bv,
      `빌드 볼륨 Y(세로)는 ${bv.min}~${bv.max} mm 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.bvZ,
      bv,
      `빌드 볼륨 Z(높이)는 ${bv.min}~${bv.max} mm 사이여야 합니다.`,
    ),
  );

  push(
    checkRange(
      d.exposureSec,
      L.exposureSec,
      `일반 노광 시간은 ${L.exposureSec.min}~${L.exposureSec.max} 초 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.bottomExposureSec,
      L.bottomExposureSec,
      `바닥 노광 시간은 ${L.bottomExposureSec.min}~${L.bottomExposureSec.max} 초 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.bottomLayerCount,
      L.layerCount,
      `바닥 레이어 수는 ${L.layerCount.min}~${L.layerCount.max} 장 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.transitionLayerCount,
      L.layerCount,
      `전환 레이어 수는 ${L.layerCount.min}~${L.layerCount.max} 장 사이여야 합니다.`,
    ),
  );

  push(
    checkRange(
      d.liftDistanceMm,
      L.liftDistanceMm,
      `리프트 거리는 ${L.liftDistanceMm.min}~${L.liftDistanceMm.max} mm 사이여야 합니다.`,
    ),
  );
  push(
    checkRange(
      d.liftSpeedMmS,
      L.speedMmS,
      `리프트 속도는 ${L.speedMmS.min}~${L.speedMmS.max} mm/s 사이여야 합니다 (0이면 실제 프린터에서 플레이트가 올라가지 않습니다).`,
    ),
  );
  push(
    checkRange(
      d.retractSpeedMmS,
      L.speedMmS,
      `하강 속도는 ${L.speedMmS.min}~${L.speedMmS.max} mm/s 사이여야 합니다 (0이면 실제 프린터에서 플레이트가 내려오지 않습니다).`,
    ),
  );
  push(
    checkRange(
      d.lightOffDelaySec,
      L.lightOffDelaySec,
      `노광 후 대기 시간은 ${L.lightOffDelaySec.min}~${L.lightOffDelaySec.max} 초 사이여야 합니다.`,
    ),
  );

  if (d.bottomExposureSec < d.exposureSec) {
    warnings.push(
      "바닥 노광이 일반 노광보다 짧습니다 — 전환 레이어 보간이 역방향이 됩니다. 의도한 값인지 확인하세요.",
    );
  }

  return { errors, warnings };
}

const PrinterProfileDialog: React.FC<Props> = ({ open, onClose }) => {
  const all = useAllProfiles();
  const addProfile = usePrinterProfileStore((s) => s.addProfile);
  const updateProfile = usePrinterProfileStore((s) => s.updateProfile);
  const removeProfile = usePrinterProfileStore((s) => s.removeProfile);
  const setCurrent = usePrinterProfileStore((s) => s.setCurrent);
  const currentId = usePrinterProfileStore((s) => s.currentId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isNew, setIsNew] = useState(false);
  /** 저장하지 않은 변경 여부 (P0-2, 검수_20260915 V-4). */
  const [dirty, setDirty] = useState(false);

  /**
   * draft 를 바꾸는 유일한 통로. setDraft 를 직접 부르면 dirty 표시가 빠지므로
   * (입력칸이 15곳이라 한 군데만 놓쳐도 경고가 안 뜬다) 이름 input 을 포함한
   * 모든 onChange 는 반드시 이 헬퍼를 경유한다.
   */
  function updateDraft(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }

  useEffect(() => {
    if (!open) return;
    // 다이얼로그 열릴 때마다 현재 선택된 프로파일 미리보기.
    // isNew(새 프로파일 작성) 중에는 selectedId=null 을 의도적으로 유지하므로
    // 여기서 currentId 로 복원하면 EMPTY_DRAFT 가 빌트인 값으로 덮여 리셋이
    // 풀린다(감사 #7). isNew 일 때는 복원하지 않는다.
    if (!selectedId && !isNew) setSelectedId(currentId);
  }, [open, currentId, selectedId, isNew]);

  useEffect(() => {
    if (!selectedId || isNew) return;
    const p = all.find((x) => x.id === selectedId);
    if (!p) return;
    setDraft({
      name: p.name,
      lcdWidthPx: p.lcdWidthPx,
      lcdHeightPx: p.lcdHeightPx,
      pixelPitchUm: p.pixelPitchUm,
      bvX: p.buildVolumeMm[0],
      bvY: p.buildVolumeMm[1],
      bvZ: p.buildVolumeMm[2],
      exposureSec: p.exposureSec ?? DEFAULT_EXPOSURE_SEC,
      bottomExposureSec: p.bottomExposureSec ?? DEFAULT_BOTTOM_EXPOSURE_SEC,
      bottomLayerCount: p.bottomLayerCount ?? DEFAULT_BOTTOM_LAYER_COUNT,
      transitionLayerCount:
        p.transitionLayerCount ?? DEFAULT_TRANSITION_LAYER_COUNT,
      liftDistanceMm: p.liftDistanceMm ?? DEFAULT_LIFT_DISTANCE_MM,
      liftSpeedMmS: p.liftSpeedMmS ?? DEFAULT_LIFT_SPEED_MM_S,
      retractSpeedMmS: p.retractSpeedMmS ?? DEFAULT_RETRACT_SPEED_MM_S,
      lightOffDelaySec: p.lightOffDelaySec ?? DEFAULT_LIGHT_OFF_DELAY_SEC,
    });
    // 저장된 값으로 다시 채웠으므로 미저장 변경 없음.
    // (all 은 이제 참조가 안정적이라 이 effect 는 실제 스토어·선택 변경 때만
    //  돈다 — P0-1. 저장 직후 한 번 도는 것은 방금 저장한 값으로의 복원이라 무해.)
    setDirty(false);
  }, [selectedId, isNew, all]);

  // 닫힐 때 편집 상태를 버린다 — 재열림 시 "버린 편집값·dirty 잔존" 방지 (검수 FAIL-1).
  // confirm 에서 "취소"를 누른 경우는 open 이 유지되므로 이 effect 가 돌지 않아
  // 편집 내용이 그대로 보존된다.
  useEffect(() => {
    if (open) return;
    setIsNew(false);
    setDirty(false);
    // selectedId 를 비우면 재열림 때 open 효과가 currentId 로 재선택하고,
    // 복원 effect 가 스토어 값으로 draft 를 다시 채우면서 dirty 도 풀린다.
    setSelectedId(null);
  }, [open]);

  const readOnly = !isNew && selectedId !== null && isBuiltIn(selectedId);

  const { errors, warnings } = validateDraft(draft);
  const canSave = !readOnly && errors.length === 0;

  /**
   * 편집 중이면 확인을 받는다. 계속 진행해도 되면 true.
   * readOnly 는 입력이 전부 disabled 라 dirty 가 생길 수 없지만 방어용으로 둔다.
   */
  function confirmDiscard(): boolean {
    if (!dirty || readOnly) return true;
    return window.confirm(
      "저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?",
    );
  }

  /** 닫기 5경로(배경·Esc·헤더 ×·하단 닫기)가 공유하는 종료 지점. */
  function requestClose() {
    if (!confirmDiscard()) return;
    onClose();
  }

  /**
   * Esc 핸들러가 보는 최신 닫기 로직. onKey 는 effect 생성 시점의 클로저를
   * 붙잡으므로 dirty 를 직접 읽으면 스테일 값이 된다(규칙 7). ref 로 최신
   * 함수를 갈아끼워 리스너 재등록 없이 항상 현재 dirty 를 보게 한다.
   */
  const requestCloseRef = useRef<() => void>(() => onClose());

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }); // deps 없음 — 매 커밋 갱신 (렌더 중 ref 쓰기는 React 규칙 위반, 검수 FAIL-2)

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function toProfile(d: Draft): Omit<PrinterProfileV2, "id"> {
    return {
      name: d.name.trim() || "Untitled",
      lcdWidthPx: Math.max(1, Math.round(d.lcdWidthPx)),
      lcdHeightPx: Math.max(1, Math.round(d.lcdHeightPx)),
      pixelPitchUm: Math.max(0.1, d.pixelPitchUm),
      buildVolumeMm: [
        Math.max(1, d.bvX),
        Math.max(1, d.bvY),
        Math.max(1, d.bvZ),
      ],
      exposureSec: Math.max(0, d.exposureSec),
      bottomExposureSec: Math.max(0, d.bottomExposureSec),
      bottomLayerCount: Math.max(0, Math.round(d.bottomLayerCount)),
      transitionLayerCount: Math.max(0, Math.round(d.transitionLayerCount)),
      liftDistanceMm: Math.max(0, d.liftDistanceMm),
      liftSpeedMmS: Math.max(0, d.liftSpeedMmS),
      retractSpeedMmS: Math.max(0, d.retractSpeedMmS),
      lightOffDelaySec: Math.max(0, d.lightOffDelaySec),
    };
  }

  function handleSave() {
    // 버튼이 disabled 라 여기까지 오지 않지만, 검증 실패 값이 저장되는 일이
    // 없도록 한 번 더 막는다.
    if (!canSave) return;
    const payload = toProfile(draft);
    if (isNew) {
      const id = addProfile(payload);
      setCurrent(id);
      setSelectedId(id);
      setIsNew(false);
    } else if (selectedId) {
      updateProfile(selectedId, payload);
    }
    setDirty(false);
  }

  function handleDelete() {
    if (!selectedId || isBuiltIn(selectedId)) return;
    if (!confirm("이 프로파일을 삭제할까요?")) return;
    removeProfile(selectedId);
    setSelectedId(BUILT_IN_PROFILES[0].id);
    setIsNew(false);
  }

  function handleAddNew() {
    // 편집 중이던 내용이 조용히 사라지는 경로이므로 닫기와 동일하게 확인받는다.
    if (!confirmDiscard()) return;
    setIsNew(true);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setDirty(false);
  }

  /** 리스트에서 다른 프로파일 선택 — 이것도 편집 내용이 날아가는 경로. */
  function handleSelect(id: string) {
    if (id === selectedId && !isNew) return;
    if (!confirmDiscard()) return; // 취소 시 현재 선택 유지
    setSelectedId(id);
    setIsNew(false);
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={requestClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-[920px] max-w-full max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              프린터 프로파일
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              빌트인은 읽기 전용 · 사용자 프로파일은 편집·삭제 가능
            </p>
          </div>
          <button
            onClick={requestClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 flex gap-5 p-5 min-h-0">
          {/* 좌측 리스트 */}
          <aside className="w-64 flex flex-col gap-2 border border-gray-200 rounded p-2 overflow-y-auto">
            {all.map((p) => (
              <div
                key={p.id}
                onClick={() => handleSelect(p.id)}
                className={`px-3 py-2 rounded cursor-pointer ${
                  selectedId === p.id && !isNew
                    ? "bg-primary-50 border border-primary-300"
                    : "border border-transparent hover:bg-gray-50"
                }`}
              >
                <div className="text-sm font-medium text-gray-800">
                  {p.name}
                </div>
                <div className="text-xs text-gray-500">
                  {p.lcdWidthPx}×{p.lcdHeightPx} · {p.pixelPitchUm} µm
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {isBuiltIn(p.id) ? "[빌트인]" : "[사용자]"}
                </div>
              </div>
            ))}
            <button
              onClick={handleAddNew}
              className="mt-1 px-3 py-2 text-sm border border-dashed border-gray-300 rounded text-gray-600 hover:bg-gray-50"
            >
              + 새 프로파일
            </button>
          </aside>

          {/* 우측 form — 720p 등 저해상도에서 폼이 컨테이너(max-h-[88vh])를 넘겨
              저장/삭제 버튼이 잘리던 문제(감사 #9). 스크롤을 form 에 붙여 버튼까지
              항상 접근 가능하게 한다. */}
          <section className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
            <FormRow label="이름">
              <input
                type="text"
                value={draft.name}
                disabled={readOnly}
                onChange={(e) => updateDraft({ name: e.target.value })}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded disabled:bg-gray-50"
              />
            </FormRow>

            <FormRow label="LCD 해상도 (px)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.lcdWidthPx}
                  onChange={(v) => updateDraft({ lcdWidthPx: v })}
                  disabled={readOnly}
                />
                <span>×</span>
                <NumberInput
                  value={draft.lcdHeightPx}
                  onChange={(v) => updateDraft({ lcdHeightPx: v })}
                  disabled={readOnly}
                />
              </div>
            </FormRow>

            <FormRow label="픽셀 피치" unit="µm">
              <NumberInput
                value={draft.pixelPitchUm}
                onChange={(v) => updateDraft({ pixelPitchUm: v })}
                disabled={readOnly}
                step={0.1}
              />
            </FormRow>

            <FormRow label="빌드 볼륨 (mm)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.bvX}
                  onChange={(v) => updateDraft({ bvX: v })}
                  disabled={readOnly}
                  step={0.01}
                />
                <span>×</span>
                <NumberInput
                  value={draft.bvY}
                  onChange={(v) => updateDraft({ bvY: v })}
                  disabled={readOnly}
                  step={0.01}
                />
                <span>×</span>
                <NumberInput
                  value={draft.bvZ}
                  onChange={(v) => updateDraft({ bvZ: v })}
                  disabled={readOnly}
                  step={0.01}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                X = 가로 · Y = 세로 · Z = 출력 가능 높이
              </p>
            </FormRow>

            <FormRow label="노광 시간 (초)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.exposureSec}
                  onChange={(v) => updateDraft({ exposureSec: v })}
                  disabled={readOnly}
                  step={0.1}
                />
                <span className="text-xs text-gray-500">일반</span>
                <NumberInput
                  value={draft.bottomExposureSec}
                  onChange={(v) => updateDraft({ bottomExposureSec: v })}
                  disabled={readOnly}
                  step={0.1}
                />
                <span className="text-xs text-gray-500">바닥</span>
              </div>
            </FormRow>

            <FormRow label="바닥/전환 레이어 수">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.bottomLayerCount}
                  onChange={(v) => updateDraft({ bottomLayerCount: v })}
                  disabled={readOnly}
                />
                <span className="text-xs text-gray-500">바닥</span>
                <NumberInput
                  value={draft.transitionLayerCount}
                  onChange={(v) => updateDraft({ transitionLayerCount: v })}
                  disabled={readOnly}
                />
                <span className="text-xs text-gray-500">전환</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                전환 레이어 구간에서 바닥→일반 노광이 선형으로 보간됩니다 (0 =
                전환 없음).
              </p>
            </FormRow>

            <FormRow label="리프트 거리 (mm)">
              <NumberInput
                value={draft.liftDistanceMm}
                onChange={(v) => updateDraft({ liftDistanceMm: v })}
                disabled={readOnly}
                step={0.1}
              />
            </FormRow>

            <FormRow label="리프트/하강 속도 (mm/s)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.liftSpeedMmS}
                  onChange={(v) => updateDraft({ liftSpeedMmS: v })}
                  disabled={readOnly}
                  step={0.1}
                />
                <span className="text-xs text-gray-500">리프트</span>
                <NumberInput
                  value={draft.retractSpeedMmS}
                  onChange={(v) => updateDraft({ retractSpeedMmS: v })}
                  disabled={readOnly}
                  step={0.1}
                />
                <span className="text-xs text-gray-500">하강</span>
              </div>
            </FormRow>

            <FormRow label="노광 후 대기 (초)">
              <NumberInput
                value={draft.lightOffDelaySec}
                onChange={(v) => updateDraft({ lightOffDelaySec: v })}
                disabled={readOnly}
                step={0.1}
              />
              <p className="text-xs text-gray-400 mt-1">
                리프트·딜레이는 예상 출력 시간 추정에 사용됩니다.
              </p>
            </FormRow>

            {/* 검증 결과 — 빨강(errors)은 저장 차단, 노랑(warnings)은 확인용 (P0-3). */}
            {!readOnly && errors.length > 0 && (
              <ul className="mt-auto list-disc pl-5 space-y-0.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {errors.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}
            {!readOnly && warnings.length > 0 && (
              <ul
                className={`list-disc pl-5 space-y-0.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 ${
                  errors.length === 0 ? "mt-auto" : ""
                }`}
              >
                {warnings.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}

            {/* 목록이 하나도 안 뜨는 경우(readOnly 포함)에만 버튼 행이 하단에 붙는다. */}
            <div
              className={`flex items-center gap-2 ${
                !readOnly && (errors.length > 0 || warnings.length > 0)
                  ? ""
                  : "mt-auto"
              }`}
            >
              {!readOnly && (
                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`px-3 py-1.5 text-sm rounded ${
                    canSave
                      ? "bg-primary-600 text-white hover:bg-primary-700"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                  title={
                    canSave
                      ? undefined
                      : "입력값 오류를 먼저 수정해야 저장할 수 있습니다."
                  }
                >
                  {isNew ? "추가" : "저장"}
                </button>
              )}
              {!readOnly && !isNew && selectedId && (
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                >
                  삭제
                </button>
              )}
              {readOnly && (
                <span className="text-xs text-gray-500">
                  빌트인 프로파일은 편집할 수 없습니다. 새 프로파일을 추가하세요.
                </span>
              )}
              <button
                onClick={requestClose}
                className="ml-auto px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

function FormRow({
  label,
  unit,
  children,
}: {
  label: string;
  /**
   * 단위 표기. label 의 uppercase CSS 가 µ(U+00B5)를 그리스 대문자 Μ 로
   * 변환해 "µm" 이 "MM" 으로 오독되던 문제(감사 #6)를 막기 위해, 단위는
   * uppercase 를 적용하지 않는 별도 span 으로 분리해 원문 그대로 렌더한다.
   */
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 tracking-wide">
        <span className="uppercase">{label}</span>
        {unit && <span className="normal-case"> ({unit})</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * 프로파일 필드용 숫자칸. 공통 `NumberInput` 에 이 다이얼로그의 폭·스타일만
 * 입힌 얇은 래퍼다 (B-14).
 *
 * 기존 구현은 타자 한 글자마다 draft 에 반영해, "300" 을 치려고 "3" 을 누른
 * 순간 해상도가 3px 로 바뀌는 식이었다. 이제 Enter/blur 에서만 커밋한다.
 *
 * min/max 는 **일부러 걸지 않는다**. 이 다이얼로그는 저장 시점에
 * `sanitizeDraft`(Math.max/round)로 한 번에 정리하는 방식이고, 편집 중에 범위를
 * 걸면 종전에 없던 제약이 생긴다. 표시 반올림 자릿수만 step 에 맞춰 정한다.
 * 범위 검증은 `validateDraft` 가 담당한다 (P0-3).
 */
function NumberInput({
  value,
  onChange,
  disabled,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  step?: number;
}) {
  return (
    <CommitNumberInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      step={step}
      // step 1(픽셀·레이어 수)은 정수, step 0.1/0.01(µm·mm·초)은 소수 3자리까지.
      decimals={step >= 1 ? 0 : 3}
      className="w-28 px-2 py-1 text-sm border border-gray-300 rounded disabled:bg-gray-50"
    />
  );
}

export default PrinterProfileDialog;
