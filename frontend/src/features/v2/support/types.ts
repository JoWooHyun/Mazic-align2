// v2 서포트 모듈 전용 타입.
// 옛 support.types.ts 와 무관.

/**
 * 서포트 파라미터.
 *
 * 자동 생성·시각화·수동 편집이 모두 이 값을 본다.
 */
export interface SupportParams {
  /** 오버행 판정 임계각 (deg). 면 법선이 -Y 와 이루는 각이 이 값
   *  이상이면 오버행으로 본다. 통상 35~55°. */
  overhangAngleDeg: number;

  /** 기둥(트렁크) 굵기. mm. */
  trunkDiameterMm: number;

  /** 모델 접점(팁) 지름. mm. 작을수록 표면 자국이 적지만 잘 떨어진다. */
  tipDiameterMm: number;

  /** 바닥(빌드플레이트) 접점 지름. mm. */
  baseDiameterMm: number;

  /** 팁 → 트렁크 굵기 전이 구간 길이. mm. */
  tipTransitionMm: number;

  /** 트렁크 → 바닥 굵기 전이 구간 길이. mm. */
  baseTransitionMm: number;

  /** 트렁크 굵기를 모델 크기에서 자동으로 결정할지 여부.
   *  true 일 때 trunkDiameterMm 는 무시된다. */
  autoSizeTrunk: boolean;

  /** 자동 생성 시 컨택트 포인트 간 최소 거리. mm.
   *  격자 샘플링의 격자 간격을 결정한다. 작을수록 서포트가 촘촘. */
  contactSpacingMm: number;

  /** 모델 base 를 빌드플레이트 위로 띄우는 높이. mm.
   *  서포트 기둥이 의미 있는 길이로 생기려면 필요. STL 로드 시
   *  적용되며 변경 후엔 다시 불러올 때부터 반영. */
  liftMm: number;

  /** Bridge 서포트(두 지점 잇는 cross-brace)의 본체 굵기. mm.
   *  원형 단면. 일반 서포트의 trunk 와 분리해 두꺼운 보강용으로
   *  쓰기 좋다. */
  bridgeDiameterMm: number;

  /**
   * 서포트 재설계(S-4b) 화살촉 접점 — 뒷구슬 지름. mm.
   *   설계 4-1: 앞구슬(팁)에서 뒷구슬로 굵어지며 기둥에 연결. 기본 1.0.
   *   재설계(island/slope) 경로만 사용. 기존 trunk/bridge/manual 경로 무관.
   */
  headBackDiameterMm: number;

  /**
   * 서포트 재설계(S-4b) 화살촉 길이 — 앞구슬 중심 → 뒷구슬 중심. mm.
   *   설계 4-1: 접점 길이(구슬 중심 간) 약 1.0mm. 기본 1.0.
   */
  headLengthMm: number;

  /**
   * 서포트 재설계(S-4b) 접점 침투 깊이. mm.
   *   설계 4-1: 앞구슬이 모델 표면을 이만큼 파고든다(안 미끄러지게). 기본 0.2.
   */
  contactPenetrationMm: number;
}

export type SupportParamKey = keyof SupportParams;

/**
 * 단일 서포트 점.
 *
 * contact: 모델 표면(오버행) 위에 닿는 끝점 (world 좌표).
 * base   : 빌드플레이트(Y=0) 위 또는 다른 모델 위 — 기둥의 다른 끝.
 */
export interface SupportPointV2 {
  id: string;
  projectId: string;
  /** contact 쪽이 닿아있는 STL. 자동/단점/브릿지 모두 필수. */
  stlId: string;
  /**
   * 브릿지의 경우 base 쪽이 닿아있는 STL (contact 와 다를 수 있음).
   * 자동/단점은 base 가 빌드플레이트라 undefined.
   * 둘 중 어느 STL 이 삭제돼도 cascade 로 같이 사라진다.
   */
  baseStlId?: string;
  contact: [number, number, number];
  base: [number, number, number];
  source: "auto" | "manual" | "bridge";
  addedAt: number;
  /**
   * Bridge 곡선용 변곡점 3 개 (옵셔널).
   *
   * base 와 contact 사이의 t = 0.25 / 0.50 / 0.75 위치에 자동
   * 배치된 뒤, 사용자가 드래그해 곡선 형태를 만든다. 정의되어 있지
   * 않거나 모두 lerp 위치에 있으면 결과는 직선과 동일.
   *
   * 렌더 시 [base, ...curveControlPoints, contact] 5 점을 통과하는
   * Catmull-Rom spline 의 Tube 가 만들어진다.
   *
   * source !== 'bridge' 인 점에서는 무시된다.
   */
  curveControlPoints?: [number, number, number][];
  /**
   * Contact 위치의 표면 normal (모델 외부 방향, 단위 벡터).
   * 옵셔널 — 옛 데이터는 undefined. 시각화 sphere 를 표면 밖으로
   * lift 하는 데 쓰임. 저장된 contact 좌표 자체는 표면 안쪽 push 된
   * 상태를 유지해서 서포트 메시 cap 이 void 없이 부착된다.
   */
  contactNormal?: [number, number, number];
  /** Base 위치 normal (Bridge 전용). undefined 면 (0, 1, 0). */
  baseNormal?: [number, number, number];
  /**
   * Contact 가 다른 Bridge 표면 위에 부착된 경우 그 부착 정보.
   *   · supportId : 부착된 부모 Bridge id
   *   · t         : 부모 Bridge path 위의 비율 (0 = base, 1 = contact)
   * 부모 Bridge 가 수정되면 이 t 위치를 다시 계산해서 contact 가
   * 부모를 따라 이동한다.
   */
  contactAttachedTo?: { supportId: string; t: number };
  /** Base 가 다른 Bridge 표면 위에 부착된 경우. */
  baseAttachedTo?: { supportId: string; t: number };
  /**
   * 좌표 공간.
   * 'world' (또는 undefined): contact / base / cps 가 world 좌표.
   *    STL transform 변경 시 transformPointBetween 으로 재계산 필요
   *    (race 발생 — supports mesh 가 STL 보다 늦게 따라감).
   * 'stl-local': 좌표가 stlId STL 의 local 좌표. mesh.parent =
   *    stlMesh 로 설정되어 STL transform 시 Babylon 이 자동 동기.
   *    race 없음.
   *
   * 새 supports 는 'stl-local' 로 생성. 옛 'world' 데이터는 load 시
   * 자동 마이그레이션.
   */
  coordSpace?: "world" | "stl-local";
  /**
   * 서포트 재설계(S-4) 점 생성이 요구하는 팁(접점) 반경. mm.
   *   설계 3-4 "서포트 점 목록" 계약의 "필요한 팁 반경" 항목. 작은 아일랜드는
   *   가는 팁, 넓은 곳은 굵은 팁을 요구하도록 점 단위로 실린다. 옵셔널 —
   *   기존 trunk/bridge/disc 서포트와 옛 데이터는 undefined (하위 호환).
   *   3단계(기둥 세우기)에서 접점 굵기 입력으로 소비될 예정 (이 PR 범위 밖).
   */
  tipRadius?: number;
  /**
   * 서포트 재설계(S-4) 점의 검출 출처.
   *   · 'island' : 아일랜드(공중에 뜬 조각) 검출에서 나온 점.
   *   · 'slope'  : 오버행(처지는 가장자리) 검출에서 나온 점.
   *   · 'manual' : 사용자가 손으로 찍은 점.
   * source('auto'|'manual'|'bridge')와 직교한다. 옵셔널 — 기존/옛 데이터는
   * undefined (하위 호환). 3단계에서 유형별 구조 규칙 분기에 쓰일 예정.
   */
  kind?: "island" | "slope" | "manual";
  /**
   * 서포트 재설계(S-4) 점의 **base 쪽이 무엇에 서 있는가** (B-18).
   *   · 'plate' : 빌드플레이트에 서 있다. 기둥 발의 **world Y 는 항상 0** 이어야
   *               하며, 모델이 위아래로 움직이면 **기둥 길이만 변한다**.
   *   · 'model' : 모델 표면·다른 기둥 등 모델에 딸린 곳에 앵커돼 있다. 이때는
   *               base 가 모델을 그대로 따라가야 하므로 플레이트 고정을 걸지
   *               않는다.
   * 옵셔널 — 기존/옛 데이터는 undefined 이며, 이 경우 `resolveRedesignBaseY`
   * 가 저장된 base 의 world Y 로 **플레이트 접지 의도를 추정**한다(하위 호환).
   *
   * ## 왜 필드로 두는가 (B-18 설계 근거)
   * 재설계 점은 stl-local 로 저장돼 모델을 그대로 따라간다. 그래서 모델이 한 번
   * 움직이고 나면 저장된 base 의 world Y 만 봐서는 "원래 플레이트에 서 있었는데
   * 모델을 따라 떠오른 것" 과 "원래부터 모델 위에 앵커된 것" 을 **구분할 수 없다**.
   * 접지 의도는 점을 만드는 시점에만 알 수 있으므로 그때 찍어 둔다.
   *
   * S-4b-2 의 3단 폴백(경사 다리·근처 기둥 합류·모델 표면 앵커)이 들어오면 그
   * 폴백들이 `'model'` 을 실어 보내면 되고, 플레이트 고정 로직은 손대지 않는다.
   */
  baseAnchor?: "plate" | "model";
  /**
   * 서포트 재설계(S-4b-2c) **라우팅 결과 종류** — 이 점이 3단 폴백 중 어느 경로로
   * 바닥(또는 모델)에 닿았는가.
   *   · 'vertical'   : 1단. 접점 아래가 청명 — 곧장 수직 하강.
   *   · 'bent'       : 2단. 구조각으로 옆으로 비껴 내려가 빈 자리에서 다시 수직.
   *   · 'anchor'     : 3단. 바닥에 못 닿아 아래 모델 표면에 뒤집힌 화살촉으로 얹음.
   *   · 'joinPillar' : 0단. 이웃 중심 기둥에 경사 다리로 합류(기둥 수 절감).
   * undefined = 기존 수직(하위 호환). **미지정 점은 S-4b-1 과 완전히 같은 경로로
   * 조립돼야 한다** — 조립·key 양쪽이 이 값을 안 보면 종전과 동일하게 동작한다.
   *
   * ## 왜 저장하는가
   * 라우팅은 **충돌 검사(모델 지오메트리 레이캐스트)** 의 결과다. 저장하지 않으면
   * 재조립할 때마다 다시 쏴야 하는데, 조립은 모델을 움직일 때마다 일어나므로
   * (useSupportMeshSync) 비용도 크고 결과가 흔들릴 수도 있다. 결정된 경로를
   * 좌표와 함께 박아 두면 재조립이 순수 기하 재생이 된다.
   */
  routeKind?: "vertical" | "bent" | "anchor" | "joinPillar";
  /**
   * contact → base 사이의 **중간 꺾임점** 목록 (양 끝 제외).
   *   좌표 공간은 이 점의 `coordSpace` 와 같다(신규 점은 stl-local).
   *   'bent' 에서 경사 구간이 끝나고 수직으로 바뀌는 전환점이 여기 들어간다.
   *   undefined/빈 배열 = 직선.
   *
   * ## 왜 저장하는가
   * 꺾임점은 "그 자리가 비어 있다" 는 충돌 검사 결과 그 자체라 좌표로 남겨야
   * 모델을 옮긴 뒤에도 같은 형상이 재조립된다. contact/base 와 **같은 공간**에
   * 두는 이유는 셋이 함께 STL 을 따라가야 형상이 유지되기 때문 — 하나만 world 면
   * 모델 회전 시 경로가 어긋난다.
   */
  routeWaypoints?: [number, number, number][];
  /**
   * 'joinPillar' 멤버가 합류한 **중심점(기둥 소유자)** 의 SupportPointV2 id.
   *   형상 조립에는 쓰지 않는다(합류점 좌표는 base 에 이미 있다). 기록용 —
   *   후속 편집에서 "이 기둥을 지우면 누가 딸려 무너지는가" 를 알아야 하고,
   *   진단 로그에서 합류 관계를 되짚을 수 있어야 한다.
   */
  joinPillarPointId?: string;
}

/**
 * 서포트 재설계(S-4b-2b) 점 전처리 결과 타입 재노출.
 *
 * 정의 본체는 `detect/preprocess-points.ts` 에 있다 — 전처리는 **생성 시점의
 * 인메모리 변환**이라 저장 스키마(위 `SupportPointV2`)를 건드리지 않으며, 그래서
 * 검출(detect) 모듈 쪽에 산다. 여기서는 서포트 모듈 소비자가 한 곳에서 타입을
 * 집어갈 수 있도록 이름만 다시 내보낸다(값 재수출 아님 — 타입 전용).
 *
 * ⚠️ `SharedPillarCluster` 는 **후보**다. 충돌 검사는 S-4b-2c 가 한다.
 */
export type {
  ClusterPillarsOptions,
  DedupedPoint,
  PreprocessPoint,
  SharedPillarCluster,
} from "./detect/preprocess-points";
