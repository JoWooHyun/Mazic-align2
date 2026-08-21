// 서포트 통계 — 순수 모듈 (Babylon·React 무의존).
//
//   근거: `docs/판정_CHITUBOX분석_20260821.md` C-4.
//     분석 문서 `docs/supp94_v2.md` 46장 — CHITUBOX EXE 에 다음 통계 문자열이
//     **확정**으로 존재한다:
//       total Support Num: / Up Touch Support Num: / Main Support Num:
//     (getTotalSupportNum / getTotalUpTouchSupportNum / getTotalMainSupportNum)
//     문서 평가: "CHITUBOX 결과와 비교하는 역검증에도 매우 유용하다".
//
//   ## 왜 필요한가 (우리 사정)
//   `RouteReport` 10개 카운터를 이미 계산하지만 **console.log 로 흘려버린다**.
//   리드는 실물 테스트마다 "점 몇 개 / 기둥 몇 개 / 실패 몇 개"를 확인하는데
//   (로드맵의 "상용은 20개 미만인데 우리는 1,000+" 대조가 그것이다) 그때마다
//   개발자도구를 열어야 했다. 게다가 생성 직후 상태 문자열은 다른 조작을 하면
//   사라져서, **지금 씬에 서 있는 서포트가 몇 개인지** 알 방법이 없었다.
//
//   그래서 두 가지를 분리해 제공한다:
//     · `summarizeSupports`  — 지금 저장돼 있는 점 목록에서 **항상** 계산 가능.
//     · `RouteReport`        — 생성 순간에만 나오는 라우팅 진단(기존 그대로).

import type { SupportPointV2 } from "./types";

/**
 * 현재 서포트 구성 요약. CHITUBOX 3 카운터에 우리 구조를 대응시킨 것.
 *
 * | CHITUBOX            | 우리                                    |
 * |---------------------|-----------------------------------------|
 * | total Support Num   | `total`                                 |
 * | Up Touch Support Num| `contact` (모델에 닿는 접점 = 점 1개당 1)|
 * | Main Support Num    | `mainPillar` (바닥까지 내려가는 기둥)    |
 *
 * `mainPillar` 정의: **플레이트에 발을 딛는 기둥**의 수다. 합류(joinPillar)한
 * 멤버는 자기 기둥이 없으므로 세지 않는다 — 이것이 "Contact ≠ Trunk 1:1"
 * (supp94 0.1-D)을 수치로 드러내는 지점이고, 기둥 공유가 실제로 몇 개를
 * 줄였는지 사용자가 바로 볼 수 있다.
 */
export interface SupportSummary {
  /** 전체 서포트 점 수. */
  total: number;
  /** 모델에 닿는 접점 수 (= total, 점 하나가 접점 하나). */
  contact: number;
  /** 플레이트까지 내려가는 독립 기둥 수 (합류 멤버 제외). */
  mainPillar: number;
  /** 이웃 기둥에 합류한 점 수 (기둥을 새로 세우지 않은 점). */
  joined: number;
  /** 모델 표면에 얹힌 점 수 (3단 폴백 anchor). */
  anchored: number;
  /** 경사 우회로 내려간 점 수 (2단 폴백 bent). */
  bent: number;
  /** 검출 출처별 — 아일랜드에서 온 점. */
  island: number;
  /** 검출 출처별 — 오버행(경사면)에서 온 점. */
  slope: number;
  /** 재설계 경로가 아닌 레거시 점(수동·브릿지·구 자동). */
  legacy: number;
}

/** 빈 요약 (점이 없을 때). */
export const EMPTY_SUPPORT_SUMMARY: SupportSummary = {
  total: 0,
  contact: 0,
  mainPillar: 0,
  joined: 0,
  anchored: 0,
  bent: 0,
  island: 0,
  slope: 0,
  legacy: 0,
};

/** 재설계(S-4b) 경로 점인지 — `useSupportMeshSync.isRedesignPoint` 와 같은 기준. */
function isRedesignPoint(p: SupportPointV2): boolean {
  return p.kind === "island" || p.kind === "slope";
}

/**
 * 저장된 서포트 점 목록에서 구성 요약을 만든다.
 *
 * 순수 함수 — 같은 입력이면 항상 같은 출력. 점 수에 선형이라 렌더마다 불러도
 * 무해하다(1,000점 기준 단순 순회 1회).
 *
 * `routeKind` 가 undefined 인 재설계 점은 **수직 기둥**으로 센다 — 저장 스키마의
 * 하위 호환 규약(`types.ts` routeKind 주석: "undefined = 기존 수직")과 같은 해석이다.
 */
export function summarizeSupports(
  points: readonly SupportPointV2[],
): SupportSummary {
  const s: SupportSummary = { ...EMPTY_SUPPORT_SUMMARY };
  s.total = points.length;

  for (const p of points) {
    if (!isRedesignPoint(p)) {
      s.legacy++;
      continue;
    }

    s.contact++;
    if (p.kind === "island") s.island++;
    else s.slope++;

    switch (p.routeKind) {
      case "joinPillar":
        s.joined++;
        break;
      case "anchor":
        s.anchored++;
        break;
      case "bent":
        s.bent++;
        s.mainPillar++; // 경사로 내려가도 결국 플레이트에 발을 딛는다.
        break;
      case "vertical":
      case undefined:
      default:
        s.mainPillar++;
        break;
    }
  }

  // 레거시 점도 각자 바닥까지 내려가는 기둥이라 접점·기둥 수에 포함해야
  //   "화면에 보이는 것"과 숫자가 맞는다. 다만 구조 분류(합류/앵커 등)는
  //   레거시 경로에 개념이 없으므로 세부 항목엔 넣지 않는다.
  s.contact += s.legacy;
  s.mainPillar += s.legacy;

  return s;
}

/** 요약을 한 줄 한국어로. 패널·상태표시줄 공용. */
export function formatSupportSummary(s: SupportSummary): string {
  if (s.total === 0) return "서포트 없음";
  const parts = [`전체 ${s.total}`, `접점 ${s.contact}`, `기둥 ${s.mainPillar}`];
  if (s.joined > 0) parts.push(`합류 ${s.joined}`);
  if (s.anchored > 0) parts.push(`모델앵커 ${s.anchored}`);
  return parts.join(" · ");
}

/**
 * 기둥 공유로 몇 %를 절감했는지. 합류가 없으면 0.
 *   `joined / (mainPillar + joined)` = "기둥을 세울 뻔했는데 안 세운 비율".
 *   S-4b-2b 실측(121점 → 28기둥, 76.9% 절감)과 같은 정의다.
 */
export function pillarSavingRatio(s: SupportSummary): number {
  const wouldBe = s.mainPillar + s.joined;
  if (wouldBe <= 0) return 0;
  return s.joined / wouldBe;
}
