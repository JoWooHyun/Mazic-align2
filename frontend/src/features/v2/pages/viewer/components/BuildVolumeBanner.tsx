// 출력영역 초과 경고 배너 (C-2, `docs/판정_CHITUBOX분석_20260821.md`).
// (ViewerV2Page 에서 추출 — 10/15 코드 정리 R-4. 문구·갈래·버튼 조건 불변.)
//
// 자동 소멸 없음 — 모델을 영역 안으로 되돌리면 씬 훅이 빈 배열을 올려 저절로 사라진다(그때는 아무것도 그리지 않는다).
// 뷰포트에는 해당 모델을 감싸는 빨간 와이어박스가 함께 표시된다(useBuildVolumeCheck).
// 미리보기 모드에서는 페이지가 이 배너를 숨긴다 — 안전장치가 사라지는 것은 아니다: 내보내기 경로는 useSliceExport 의
// `confirmIfOutOfBounds`(P-1)·`alertIfOutOfTask0Area`(Z3-b) 가 여전히 막는다. "플레이트 위로 올리기" 는 모델을 움직이는
// **변환**이라 편집 잠금 중인 미리보기 모드에 있어서도 안 된다.

import type { BuildVolumeIssue } from "../../../components/BabylonScene";
import type { PrinterProfileV2 } from "../../../types/printer";
import { isTask0HardViolation } from "../../../utils/build-volume";
import { isTask0Profile } from "../../../utils/task0/task0-profile";

interface BuildVolumeBannerProps {
  volumeIssues: BuildVolumeIssue[];
  printerProfile: PrinterProfileV2;
  /** 플레이트 아래로 파고든 모델들을 한 번에 위로 올린다 (B-21 — 페이지 handleDropToPlate). */
  onDropToPlate: () => void;
}

export default function BuildVolumeBanner({
  volumeIssues,
  printerProfile,
  onDropToPlate,
}: BuildVolumeBannerProps) {
  // Task0 출력영역 배너의 갈래 (Z3-b) — 내보내기를 막는 하드 위반(가로·세로 영역 밖·높이 초과·서포트)이 하나라도
  //   있는가. 없으면 플레이트 아래로 파고든 것뿐이라 "잘린 채 출력" 안내만 한다(useSliceExport alertIfOutOfTask0Area 와
  //   같은 판정). 렌더당 항목 수십 개 이하라 평범한 계산으로 둔다.
  const task0HardIssue = volumeIssues.some((it) =>
    isTask0HardViolation(it.violation),
  );
  if (volumeIssues.length === 0) return null;
  return (
    <div className="absolute inset-x-0 top-4 flex justify-center px-4 pointer-events-none">
      <div className="bg-red-50/95 backdrop-blur border border-red-300 rounded-md shadow px-4 py-2 text-sm text-red-900 select-none max-w-xl pointer-events-auto">
        <div className="font-medium">
          {/* Task0 (Z3 → Z3-b): 항목에 서포트 묶음이 들어간다. 가로·세로 영역 밖·높이 초과가 하나라도 있으면
              내보내기 자체를 막는다(useSliceExport alertIfOutOfTask0Area·코어 1-b). 플레이트 아래로 파고든 것뿐이면
              잘린 채 출력되는 정상 사용(리드 2026-10-08)이라 안내만 — 내보낼 때 확인 후 허용. 기존 프로파일 문구는 그대로. */}
          {isTask0Profile(printerProfile) ? (
            task0HardIssue ? (
              <>
                ⚠ Task0 출력 가능 영역을 벗어난 항목(모델·서포트){" "}
                {volumeIssues.length}건 — 이대로는 내보낼 수 없습니다. 영역
                안으로 옮기세요.
              </>
            ) : (
              <>
                ⚠ 플레이트 아래로 파고든 모델 {volumeIssues.length}개 — 이대로
                내보내면 플레이트 아래 부분은 잘린 채 출력됩니다(일부러 자르는
                경우라면 그대로 진행).
              </>
            )
          ) : (
            <>
              ⚠ 출력영역을 벗어난 모델 {volumeIssues.length}개 — 이대로
              출력하면 잘려 나갑니다.
            </>
          )}
        </div>
        <ul className="mt-1 space-y-0.5">
          {volumeIssues.slice(0, 3).map((it) => (
            <li key={it.stlId} className="text-xs">
              · {it.fileName} — {it.message}
            </li>
          ))}
          {volumeIssues.length > 3 && (
            <li className="text-xs">
              · 외 {volumeIssues.length - 3}개
            </li>
          )}
        </ul>
        {/*
          플레이트 아래로 파고든 경우만 원클릭 해소 버튼을 띄운다 (B-21).
          회전하면 실제로 파고들기 때문에(자동 안착 없음 — B-12 A안)
          가장 흔한 경고이고, 손으로 ty 를 계산하지 않게 해 준다.
        */}
        {volumeIssues.some((it) => it.sinkDepthMm > 0) && (
          <button
            onClick={onDropToPlate}
            className="mt-2 px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            플레이트 위로 올리기 (Ctrl+Z 로 되돌리기 가능)
          </button>
        )}
      </div>
    </div>
  );
}
