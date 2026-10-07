import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PrinterProfileV2 } from "../types/printer";
import {
  TASK0_BUILT_IN_PROFILE,
  TASK0_PROFILE_ID,
} from "../utils/task0/task0-profile";

/**
 * 빌트인 프로파일.
 *   ⚠️ 0번(Mars 3 Pro)은 "현재 프로파일을 못 찾을 때"·"사용자 프로파일 삭제 후"의 폴백이다
 *   (useCurrentProfile·removeProfile·PrinterProfileDialog handleDelete). 그래서 Task0(Z2)는 **맨 뒤**에
 *   붙였다 — 앞에 넣으면 기존 사용자의 폴백 동작이 바뀐다. 새 설치의 기본 선택만 DEFAULT_PROFILE_ID 로 Task0.
 */
export const BUILT_IN_PROFILES: PrinterProfileV2[] = [
  {
    id: "elegoo-mars-3-pro",
    name: "ELEGOO Mars 3 Pro",
    lcdWidthPx: 4098,
    lcdHeightPx: 2560,
    pixelPitchUm: 35.0,
    buildVolumeMm: [143.43, 89.6, 175.0],
  },
  {
    id: "elegoo-saturn-2",
    name: "ELEGOO Saturn 2",
    lcdWidthPx: 7680,
    lcdHeightPx: 4320,
    pixelPitchUm: 28.5,
    buildVolumeMm: [218.88, 123.12, 250.0],
  },
  {
    id: "phrozen-sonic-mighty-8k",
    name: "Phrozen Sonic Mighty 8K",
    lcdWidthPx: 7680,
    lcdHeightPx: 4320,
    pixelPitchUm: 28.0,
    buildVolumeMm: [218.88, 123.0, 235.0],
  },
  // Task0 하이브리드 (Z2) — 값은 utils/task0/task0-frame.ts TASK0_DEFAULTS 참조(규칙 6), outputKind 'task0'.
  TASK0_BUILT_IN_PROFILE,
];

/**
 * 새 설치(localStorage 에 저장값 없음)의 기본 선택 = Task0 (11월 데모 — 종합 D4 AI 제안).
 * 기존 사용자는 persist 가 저장된 currentId 로 덮으므로 선택이 그대로 유지된다
 * (zustand persist 는 저장값이 있으면 초기 상태를 그 값으로 병합한다).
 */
export const DEFAULT_PROFILE_ID = TASK0_PROFILE_ID;

const BUILT_IN_IDS = new Set(BUILT_IN_PROFILES.map((p) => p.id));

export function isBuiltIn(id: string): boolean {
  return BUILT_IN_IDS.has(id);
}

interface PrinterProfileState {
  /** 사용자 정의 프로파일 (localStorage 영속). */
  userProfiles: PrinterProfileV2[];
  currentId: string;
  setCurrent: (id: string) => void;
  addProfile: (p: Omit<PrinterProfileV2, "id">) => string;
  updateProfile: (id: string, patch: Partial<PrinterProfileV2>) => void;
  removeProfile: (id: string) => void;
}

export const usePrinterProfileStore = create<PrinterProfileState>()(
  persist(
    (set) => ({
      userProfiles: [],
      currentId: DEFAULT_PROFILE_ID,

      setCurrent: (id) => set({ currentId: id }),

      addProfile: (p) => {
        const id = `user-${crypto.randomUUID()}`;
        const newP: PrinterProfileV2 = { id, ...p };
        set((s) => ({ userProfiles: [...s.userProfiles, newP] }));
        return id;
      },

      updateProfile: (id, patch) =>
        set((s) => ({
          userProfiles: s.userProfiles.map((p) =>
            p.id === id ? { ...p, ...patch, id: p.id } : p,
          ),
        })),

      removeProfile: (id) =>
        set((s) => {
          const nextUser = s.userProfiles.filter((p) => p.id !== id);
          const stillExists =
            BUILT_IN_IDS.has(s.currentId) ||
            nextUser.some((p) => p.id === s.currentId);
          return {
            userProfiles: nextUser,
            currentId: stillExists ? s.currentId : BUILT_IN_PROFILES[0].id,
          };
        }),
    }),
    {
      name: "v2_printer_profile",
      partialize: (s) => ({
        userProfiles: s.userProfiles,
        currentId: s.currentId,
      }),
    },
  ),
);

/**
 * 빌트인 + 사용자 프로파일 합산.
 *
 * useMemo 필수 — 예전처럼 매 렌더 새 배열을 만들면, 이 배열을 useEffect dep 으로
 * 쓰는 쪽(PrinterProfileDialog 의 draft 복원 effect)이 스토어와 무관한 부모
 * 리렌더마다 재실행돼 편집 중이던 입력이 저장된 값으로 되돌아간다
 * (검수_20260915 V-2/V-3 — "매 렌더 새 배열 → effect dep 폭주" B-계열 반복 사고).
 * userProfiles 가 그대로면 반환 배열의 참조도 그대로여야 한다.
 */
export function useAllProfiles(): PrinterProfileV2[] {
  const userProfiles = usePrinterProfileStore((s) => s.userProfiles);
  return useMemo(() => [...BUILT_IN_PROFILES, ...userProfiles], [userProfiles]);
}

export function useCurrentProfile(): PrinterProfileV2 {
  const all = useAllProfiles();
  const currentId = usePrinterProfileStore((s) => s.currentId);
  return all.find((p) => p.id === currentId) ?? BUILT_IN_PROFILES[0];
}
