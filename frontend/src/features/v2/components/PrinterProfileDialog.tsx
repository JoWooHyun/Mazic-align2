import { useEffect, useState } from "react";

import {
  BUILT_IN_PROFILES,
  isBuiltIn,
  useAllProfiles,
  usePrinterProfileStore,
} from "../hooks/usePrinterProfileStore";
import type { PrinterProfileV2 } from "../types/printer";

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
}

const EMPTY_DRAFT: Draft = {
  name: "내 프린터",
  lcdWidthPx: 4098,
  lcdHeightPx: 2560,
  pixelPitchUm: 35,
  bvX: 143.43,
  bvY: 89.6,
  bvZ: 175,
  exposureSec: 2.5,
  bottomExposureSec: 30,
  bottomLayerCount: 5,
  transitionLayerCount: 0,
};

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

  useEffect(() => {
    if (!open) return;
    // 다이얼로그 열릴 때마다 현재 선택된 프로파일 미리보기.
    if (!selectedId) setSelectedId(currentId);
  }, [open, currentId, selectedId]);

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
      exposureSec: p.exposureSec ?? 2.5,
      bottomExposureSec: p.bottomExposureSec ?? 30,
      bottomLayerCount: p.bottomLayerCount ?? 5,
      transitionLayerCount: p.transitionLayerCount ?? 0,
    });
  }, [selectedId, isNew, all]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const readOnly = !isNew && selectedId !== null && isBuiltIn(selectedId);

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
    };
  }

  function handleSave() {
    const payload = toProfile(draft);
    if (isNew) {
      const id = addProfile(payload);
      setCurrent(id);
      setSelectedId(id);
      setIsNew(false);
    } else if (selectedId) {
      updateProfile(selectedId, payload);
    }
  }

  function handleDelete() {
    if (!selectedId || isBuiltIn(selectedId)) return;
    if (!confirm("이 프로파일을 삭제할까요?")) return;
    removeProfile(selectedId);
    setSelectedId(BUILT_IN_PROFILES[0].id);
    setIsNew(false);
  }

  function handleAddNew() {
    setIsNew(true);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
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
            onClick={onClose}
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
                onClick={() => {
                  setSelectedId(p.id);
                  setIsNew(false);
                }}
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

          {/* 우측 form */}
          <section className="flex-1 flex flex-col gap-3">
            <FormRow label="이름">
              <input
                type="text"
                value={draft.name}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded disabled:bg-gray-50"
              />
            </FormRow>

            <FormRow label="LCD 해상도 (px)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.lcdWidthPx}
                  onChange={(v) => setDraft((d) => ({ ...d, lcdWidthPx: v }))}
                  disabled={readOnly}
                />
                <span>×</span>
                <NumberInput
                  value={draft.lcdHeightPx}
                  onChange={(v) => setDraft((d) => ({ ...d, lcdHeightPx: v }))}
                  disabled={readOnly}
                />
              </div>
            </FormRow>

            <FormRow label="픽셀 피치 (µm)">
              <NumberInput
                value={draft.pixelPitchUm}
                onChange={(v) => setDraft((d) => ({ ...d, pixelPitchUm: v }))}
                disabled={readOnly}
                step={0.1}
              />
            </FormRow>

            <FormRow label="빌드 볼륨 (mm)">
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.bvX}
                  onChange={(v) => setDraft((d) => ({ ...d, bvX: v }))}
                  disabled={readOnly}
                  step={0.01}
                />
                <span>×</span>
                <NumberInput
                  value={draft.bvY}
                  onChange={(v) => setDraft((d) => ({ ...d, bvY: v }))}
                  disabled={readOnly}
                  step={0.01}
                />
                <span>×</span>
                <NumberInput
                  value={draft.bvZ}
                  onChange={(v) => setDraft((d) => ({ ...d, bvZ: v }))}
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
                  onChange={(v) => setDraft((d) => ({ ...d, exposureSec: v }))}
                  disabled={readOnly}
                  step={0.1}
                />
                <span className="text-xs text-gray-500">일반</span>
                <NumberInput
                  value={draft.bottomExposureSec}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, bottomExposureSec: v }))
                  }
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
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, bottomLayerCount: v }))
                  }
                  disabled={readOnly}
                />
                <span className="text-xs text-gray-500">바닥</span>
                <NumberInput
                  value={draft.transitionLayerCount}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, transitionLayerCount: v }))
                  }
                  disabled={readOnly}
                />
                <span className="text-xs text-gray-500">전환</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                전환 레이어 구간에서 바닥→일반 노광이 선형으로 보간됩니다 (0 =
                전환 없음).
              </p>
            </FormRow>

            <div className="mt-auto flex items-center gap-2">
              {!readOnly && (
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
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
                onClick={onClose}
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

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
    <input
      type="number"
      value={value}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-28 px-2 py-1 text-sm border border-gray-300 rounded disabled:bg-gray-50"
    />
  );
}

export default PrinterProfileDialog;
