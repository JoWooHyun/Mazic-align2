import { useEffect, useRef, useState } from "react";
import { Quaternion, Vector3 } from "@babylonjs/core";

import NumberInput from "./common/NumberInput";
import {
  DISPLAY_AXIS_LABELS,
  fromDisplayAxes,
  fromDisplayEulerDeg,
  swapScaleAxes,
  toDisplayAxes,
  toDisplayEulerDeg,
} from "../types/axis-display";
import {
  IDENTITY_TRANSFORM,
  transformsEqual,
  type TransformV2,
} from "../types/transform";
import {
  degToRad,
  displayAnchorOffset,
  fromDisplayPosition,
  rotateTransformAroundWorldPivot,
  scaleTransformAroundWorldPivot,
  toDisplayPosition,
  transformPointBetween,
} from "../utils/transform";

/**
 * 선택 모델의 현재 world 바운딩박스 중심 = 회전·스케일 피벗 (B-9).
 * `null` 이면 피벗을 못 구한 것 → 기존(원점 기준) 동작으로 폴백.
 */
type PivotGetter = () => [number, number, number] | null;

interface TransformPanelProps {
  /** 단일 선택된 STL. 없으면 안내문만 표시. */
  selected: {
    id: string;
    fileName: string;
    transform: TransformV2;
  } | null;

  /**
   * 즉시 (드래그 중) 호출. DB 저장은 안 하고 메쉬만 갱신.
   */
  onPreview: (id: string, t: TransformV2) => void;

  /**
   * 드래그가 끝났을 때 한 번 호출. (start, end) 가 다르면 DB 저장 +
   * undo 스택에 push.
   */
  onCommit: (id: string, start: TransformV2, end: TransformV2) => void;

  /**
   * 선택 모델의 현재 world 바운딩박스 중심 = 회전·스케일 피벗 (B-9).
   * 회전/스케일 값을 바꿀 때 이 점을 고정해 제자리 회전을 만든다.
   * 미제공이거나 null 을 반환하면 **기존 무보정 동작으로 폴백**한다.
   *
   * POSITION 표시(B-12)도 이 값을 그대로 쓴다 — 호출 시점의 메쉬를 읽는
   * **라이브** 게터라야 한다(`getModelWorldPivot` 은 computeWorldMatrix(true)
   * 후 bbox 를 다시 읽는다). 캐시된 값을 넘기면 드래그 중 표시가 어긋난다.
   */
  getPivot?: PivotGetter;

  className?: string;
}

/**
 * 단일 선택 STL 의 Position / Rotation / Scale 슬라이더 + 숫자 입력.
 *
 * 내부 좌표계는 Babylon (Y 가 "위") 이지만 **표시는 프린터 관례대로 Z-up**
 * 으로 환산한다 (B-13). 즉 패널의 Z 가 높이다. 매핑·근거는
 * `types/axis-display.ts` 참고. 내부 저장값(TransformV2)의 의미는 그대로다.
 *
 * ⚠️ 두 환산이 **겹쳐 있다**. 순서를 지켜야 한다:
 *   표시 = 내부값 → (B-12) bbox 중심 기준 환산 → (B-13) 축 변환
 *   입력 = 표시값 → (B-13 역) 축 변환 → (B-12 역) bbox 역환산 → 내부값
 * B-12 는 **내부 축 공간**에서 정의된 오프셋 연산이라 반드시 축 변환 **안쪽**
 * 에서 이뤄져야 한다. 순서를 바꾸면 오프셋이 엉뚱한 축에 더해진다.
 *
 * POSITION 은 **모델 bbox 중심 기준으로 환산해 표시**한다 (B-12). 내부
 * TransformV2.tx/ty/tz 는 mesh 원점(정점에 베이크된 바닥 중심) 기준 그대로
 * 저장하고, 이 패널에서만 오프셋을 더해 보이고 입력 시 빼서 되돌린다.
 *
 * ⚠️ 오프셋은 **렌더할 때마다 그 시점의 라이브 피벗**으로 다시 구한다
 * (`d = pivot − t` → `표시 = t + d = pivot`). 즉 표시값은 정의상 "지금 이
 * 순간의 bbox 중심" 이고, 회전 불변·이동 1:1·스케일 불변이 전부 여기서
 * 자동으로 따라온다 — CHITUBOX 동작.
 * 선택 시점 오프셋을 캐시해 쓰면 `표시 = pivot + (Rd−I)(t₀−pivot) ≠ pivot`
 * 이 되어 슬라이더를 **끄는 동안** 표시값이 크게 드리프트하고 손을 떼는
 * 순간 되돌아온다(검수 결함 1). 그래서 캐시하지 않는다.
 *
 * undo 단위 = 한 번의 포인터 드래그 (mousedown → mouseup).
 * 그 사이 onChange 는 메쉬만 미리보기로 갱신하고 commit 은
 * pointerup 에서 한 번만 일어난다.
 */
const TransformPanel: React.FC<TransformPanelProps> = ({
  selected,
  onPreview,
  onCommit,
  getPivot,
  className = "",
}) => {
  // 패널 내부 표시값. selected 가 바뀌면 그 값으로 동기화.
  const [local, setLocal] = useState<TransformV2>(IDENTITY_TRANSFORM);
  const startRef = useRef<TransformV2 | null>(null);
  // 드래그 시작 시점의 피벗 스냅샷 (B-9). 드래그 중에는 모델이 움직이므로
  //   매번 다시 물으면 피벗이 따라 흘러 회전축이 미끄러진다. 시작 시점 값을
  //   드래그 내내 고정해 쓴다.
  const pivotRef = useRef<[number, number, number] | null>(null);
  // 이번 편집에서 마지막으로 계산된 transform (B-14). setLocal 은 비동기라
  //   같은 이벤트 안에서 커밋까지 끝내는 숫자칸 경로에서는 `local` 이 아직
  //   옛 값이다. endDrag 가 읽을 최신값을 여기 담아 둔다. 상세는 endDrag 주석.
  const latestRef = useRef<TransformV2 | null>(null);
  // Scale uniform 토글: ON 시 sx/sy/sz 가 한 값으로 동기 변경.
  const [uniformScale, setUniformScale] = useState(true);

  useEffect(() => {
    setLocal(selected ? selected.transform : IDENTITY_TRANSFORM);
    startRef.current = null;
    pivotRef.current = null;
    latestRef.current = null;
  }, [selected]);

  /**
   * POSITION 표시 오프셋 `d = pivot − t` 를 **지금 메쉬에서** 구한다 (B-12).
   *
   * 캐시하지 않는 이유는 상단 주석 참고 — `표시 = t + d` 가 pivot 과 같아지려면
   * d 가 t 와 **같은 시점**의 값이어야 한다.
   *
   * getPivot 은 라이브 게터라 `live`(지금 메쉬에 적용된 transform) 시점의 bbox
   * 중심을 준다. 표시/역환산 기준이 그와 다른 transform(`t`)이면, bbox 중심이
   * 모델에 부착된 점이라는 성질을 이용해 live→t 로 옮겨 온다
   * (`transformPointBetween`). t === live 인 렌더 경로에서는 항등이다.
   *
   * 피벗을 못 구하면 null → 기존(원점 기준) 표시로 폴백.
   */
  function anchorOffsetFor(
    t: TransformV2,
    live: TransformV2,
  ): [number, number, number] | null {
    const p = getPivot ? getPivot() : null;
    if (!p) return null;
    const pivotAtT = transformsEqual(t, live)
      ? p
      : transformPointBetween(p, live, t);
    return displayAnchorOffset(t, pivotAtT);
  }

  if (!selected) {
    return (
      <div
        className={`p-4 bg-white rounded-lg shadow text-sm text-gray-500 ${className}`}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Transform</h3>
        <p>
          모델을 하나만 선택하면 위치 / 회전 / 스케일을 조정할 수 있습니다.
        </p>
      </div>
    );
  }

  function beginDrag() {
    startRef.current = { ...local };
    // 아직 아무것도 안 바꿨으니 끝값은 시작값과 같다 (B-14).
    latestRef.current = { ...local };
    // 드래그 시작 시점의 피벗을 스냅샷 (B-9).
    pivotRef.current = getPivot ? getPivot() : null;
  }

  /**
   * 피벗 고정 보정 (B-9). 회전(rx/ry/rz)·스케일(sx/sy/sz) 필드는 baseT 대비
   * 델타를 구해 피벗을 축으로 적용한 transform 을 만든다. 이동(tx/ty/tz)은
   * 보정 대상이 아니므로 raw 를 그대로 쓴다. 피벗이 없으면 기존 무보정 동작.
   *
   * baseT = 드래그 시작 transform. 슬라이더를 끌면 매 변화가 시작값 기준으로
   * 다시 계산되므로 오차가 누적되지 않는다.
   */
  function withPivot(baseT: TransformV2, raw: TransformV2): TransformV2 {
    const p = pivotRef.current;
    if (!p) return raw;
    const pivot = new Vector3(p[0], p[1], p[2]);

    const rotChanged =
      raw.rx !== baseT.rx || raw.ry !== baseT.ry || raw.rz !== baseT.rz;
    const scaleChanged =
      raw.sx !== baseT.sx || raw.sy !== baseT.sy || raw.sz !== baseT.sz;

    let out = baseT;
    if (rotChanged) {
      // deltaQ = R_raw · inv(R_base) — 시작 자세에서 목표 자세로 가는 회전.
      const qBase = Quaternion.FromEulerAngles(
        degToRad(baseT.rx), degToRad(baseT.ry), degToRad(baseT.rz),
      );
      const qRaw = Quaternion.FromEulerAngles(
        degToRad(raw.rx), degToRad(raw.ry), degToRad(raw.rz),
      );
      const deltaQ = qRaw.multiply(Quaternion.Inverse(qBase));
      out = rotateTransformAroundWorldPivot(out, deltaQ, pivot);
    }
    if (scaleChanged) {
      // 0 나눗셈 방지 — 스케일 0 은 UI 범위(0.1~5)에서 나오지 않지만 방어.
      const ratio = (a: number, b: number) => (Math.abs(b) < 1e-9 ? 1 : a / b);
      out = scaleTransformAroundWorldPivot(
        out,
        [
          ratio(raw.sx, baseT.sx),
          ratio(raw.sy, baseT.sy),
          ratio(raw.sz, baseT.sz),
        ],
        pivot,
      );
    }
    // 이동은 보정 없이 raw 값 그대로 반영(사용자가 직접 지정한 위치).
    if (raw.tx !== baseT.tx || raw.ty !== baseT.ty || raw.tz !== baseT.tz) {
      out = { ...out, tx: raw.tx, ty: raw.ty, tz: raw.tz };
    }
    return out;
  }

  /**
   * POSITION 한 축의 **표시값** 입력을 내부 tx/ty/tz 로 되돌려 적용한다
   * (B-12 기준점 + B-13 축 변환).
   *
   * 표시 3축 중 바뀐 축만 새 값으로 갈아끼우고 나머지는 현재 표시값을 그대로 둔
   * 뒤 통째로 역환산한다 — 축별로 오프셋을 따로 빼면 오프셋이 회전돼 있을 때
   * 축이 섞여 어긋난다. 축 변환이 축을 재배열하므로 이 "통째로" 가 더 중요해졌다.
   *
   * 역환산 오프셋은 **역환산 기준 transform(src) 시점의 값**을 쓴다. 화면에
   * 보이던 값과 같은 기준이라야 사용자가 친 숫자가 그대로 들어간다.
   *
   * `axis` 는 **표시 축 인덱스**다. 표시 X/Y/Z 슬라이더가 각각 0/1/2 를 준다.
   */
  function applyPositionField(axis: 0 | 1 | 2, value: number) {
    if (Number.isNaN(value)) return;
    setLocal((prev) => {
      const base = startRef.current;
      const src = base ?? prev;
      // src 는 드래그 시작 transform 이라, 메쉬가 이미 미리보기로 움직인
      //   드래그 중에도 "그 시점 피벗 − src" 를 다시 만들어야 한다. 라이브
      //   피벗은 현재 메쉬(=prev 반영)의 중심이므로 src 로 되돌려 계산한다.
      const offset = anchorOffsetFor(src, prev);
      // 내부값 → (B-12) bbox 기준 → (B-13) 축 변환 순으로 현재 표시값을 만든다.
      const disp = toDisplayAxes(toDisplayPosition(src, offset));
      disp[axis] = value;
      // 입력은 정확히 역순 — 축 변환을 먼저 되돌린 뒤 bbox 오프셋을 뺀다.
      const [tx, ty, tz] = fromDisplayPosition(fromDisplayAxes(disp), offset);
      const raw = { ...src, tx, ty, tz };
      // 이동은 피벗 보정 대상이 아니지만, 같은 드래그에서 회전/스케일이 함께
      //   들어올 수 있으므로 기존 경로(withPivot)를 그대로 태운다.
      const next = base ? withPivot(base, raw) : raw;
      latestRef.current = next;
      onPreview(selected!.id, next);
      return next;
    });
  }

  /**
   * ROTATION 한 축의 **표시값** 입력 (B-13). `axis` 는 표시 축 인덱스.
   *
   * 현재 내부 회전을 표시 Euler 로 옮겨 해당 성분만 갈아끼운 뒤 내부로 되돌린다.
   * 성분 교환이 아니라 quaternion 켤레를 경유한다 — `types/axis-display.ts` 참고.
   */
  function applyRotationField(axis: 0 | 1 | 2, value: number) {
    if (Number.isNaN(value)) return;
    setLocal((prev) => {
      const base = startRef.current;
      const src = base ?? prev;
      const disp = toDisplayEulerDeg([src.rx, src.ry, src.rz]);
      disp[axis] = value;
      const [rx, ry, rz] = fromDisplayEulerDeg(disp);
      const raw = { ...src, rx, ry, rz };
      const next = base ? withPivot(base, raw) : raw;
      latestRef.current = next;
      onPreview(selected!.id, next);
      return next;
    });
  }

  /**
   * SCALE 한 축의 **표시값** 입력 (B-13). `axis` 는 표시 축 인덱스.
   *
   * 스케일은 부호가 없어 축 교환만 하면 된다(`swapScaleAxes` 는 자기 역함수).
   * uniform ON 이면 축과 무관하게 세 축을 같은 값으로 맞춘다.
   */
  function applyScaleField(axis: 0 | 1 | 2, value: number) {
    if (Number.isNaN(value)) return;
    setLocal((prev) => {
      const base = startRef.current;
      const src = base ?? prev;
      let raw: TransformV2;
      if (uniformScale) {
        // 세 축 동일 값이면 축 교환이 항등이라 환산이 필요 없다.
        raw = { ...src, sx: value, sy: value, sz: value };
      } else {
        const disp = swapScaleAxes([src.sx, src.sy, src.sz]);
        disp[axis] = value;
        const [sx, sy, sz] = swapScaleAxes(disp);
        raw = { ...src, sx, sy, sz };
      }
      const next = base ? withPivot(base, raw) : raw;
      latestRef.current = next;
      onPreview(selected!.id, next);
      return next;
    });
  }

  /**
   * 편집 한 묶음의 끝. 슬라이더는 pointerup, 숫자칸은 커밋(Enter/blur) 직후.
   *
   * ⚠️ 끝값을 `local`(렌더 클로저) 이 아니라 `latestRef` 에서 읽는다 (B-14).
   * 슬라이더는 onBegin/onChange/onEnd 가 **서로 다른 이벤트**라 onEnd 시점엔
   * 이미 리렌더가 끝나 `local` 이 최신이었다. 그런데 숫자칸 커밋은
   * onBegin → onChange → onEnd 를 **한 이벤트 핸들러 안에서 동기로** 부르므로,
   * setLocal 이 아직 반영되지 않아 `local` 은 편집 **이전** 값이다.
   * 그대로 두면 `transformsEqual(start, local)` 이 참이 되어 커밋이 통째로
   * 사라지거나(DB 미저장·undo 누락) 옛 값이 저장된다.
   * `apply*Field` 가 계산 즉시 채워 넣는 `latestRef` 를 쓰면 양쪽 경로가 다 맞다.
   */
  function endDrag() {
    const start = startRef.current;
    const end = latestRef.current ?? local;
    startRef.current = null;
    pivotRef.current = null;
    latestRef.current = null;
    if (!start) return;
    if (transformsEqual(start, end)) return;
    onCommit(selected!.id, start, end);
  }

  function resetAll() {
    if (transformsEqual(local, IDENTITY_TRANSFORM)) return;
    const start = { ...local };
    setLocal(IDENTITY_TRANSFORM);
    // 진행 중이던 편집 흔적을 지운다 — 남아 있으면 다음 endDrag 가 옛 값을
    //   끝값으로 커밋할 수 있다 (B-14).
    latestRef.current = null;
    onPreview(selected!.id, IDENTITY_TRANSFORM);
    onCommit(selected!.id, start, IDENTITY_TRANSFORM);
  }

  // 슬라이더/숫자 입력에 실제로 보이는 값 (B-12 기준점 + B-13 축 변환).
  //   POSITION 은 렌더 시점의 라이브 피벗으로 매번 환산한다 → 표시 = 지금 bbox
  //   중심. local 은 방금 onPreview 로 메쉬에 반영한 값이라 live === local 이다.
  //   그 위에 축 변환을 얹어 Z-up 으로 보여준다.
  const displayPosition = toDisplayAxes(
    toDisplayPosition(local, anchorOffsetFor(local, local)),
  );
  const displayRotation = toDisplayEulerDeg([local.rx, local.ry, local.rz]);
  const displayScale = swapScaleAxes([local.sx, local.sy, local.sz]);

  return (
    <div className={`p-4 bg-white rounded-lg shadow ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">Transform</h3>
        <button
          onClick={resetAll}
          disabled={transformsEqual(local, IDENTITY_TRANSFORM)}
          className="px-3 py-1 text-sm text-primary-600 hover:bg-primary-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>
      <p className="text-xs text-gray-500 truncate mb-3" title={selected.fileName}>
        {selected.fileName}
      </p>

      <Section title="Position (mm)">
        {DISPLAY_AXIS_LABELS.map((label, i) => (
          <Row
            key={label}
            axis={label}
            // 표시는 bbox 중심 기준 (B-12) + Z-up 축 변환 (B-13).
            //   회전해도 값이 변하지 않고, Z 가 높이다.
            value={displayPosition[i]}
            min={-200}
            max={200}
            step={0.1}
            // 위치는 µm 단위까지 보이게 소수 3자리 (B-14).
            decimals={3}
            onBegin={beginDrag}
            onChange={(v) => applyPositionField(i as 0 | 1 | 2, v)}
            onEnd={endDrag}
          />
        ))}
      </Section>

      <Section title="Rotation (deg)">
        {DISPLAY_AXIS_LABELS.map((label, i) => (
          <Row
            key={label}
            axis={label}
            // 표시 Euler (B-13). Z 가 수직축 회전이다.
            value={displayRotation[i]}
            min={-180}
            max={180}
            step={1}
            // 각도는 소수 2자리. Euler↔quaternion 왕복 찌꺼기(89.9999999)를
            //   여기서 흡수해 "90" 으로 보이게 한다 — 리드 보고 케이스 (B-14).
            decimals={2}
            onBegin={beginDrag}
            onChange={(v) => applyRotationField(i as 0 | 1 | 2, v)}
            onEnd={endDrag}
          />
        ))}
        <div className="flex flex-wrap gap-1 mt-1">
          {(
            [
              { axis: 0, delta: 90, label: "X +90°" },
              { axis: 0, delta: -90, label: "X −90°" },
              { axis: 1, delta: 90, label: "Y +90°" },
              { axis: 1, delta: -90, label: "Y −90°" },
              { axis: 2, delta: 90, label: "Z +90°" },
              { axis: 2, delta: -90, label: "Z −90°" },
            ] as const
          ).map(({ axis, delta, label }) => (
            <button
              key={label}
              onClick={() => {
                const start = { ...local };
                // 버튼도 **표시 축** 기준이다 (B-13). 표시 Euler 로 옮겨 해당
                //   성분에 델타를 더한 뒤 내부로 되돌린다. 라벨의 Z 가 실제로
                //   수직축 회전이 되도록 하는 것이 이 변환의 목적.
                const disp = toDisplayEulerDeg([start.rx, start.ry, start.rz]);
                let next = disp[axis] + delta;
                // ±180 안으로 정규화.
                while (next > 180) next -= 360;
                while (next <= -180) next += 360;
                disp[axis] = next;
                const [rx, ry, rz] = fromDisplayEulerDeg(disp);
                const raw = { ...start, rx, ry, rz };
                // 버튼은 beginDrag 를 거치지 않으므로 여기서 피벗을 직접 물어
                //   보정한다 (B-9). 없으면 기존 무보정 동작.
                pivotRef.current = getPivot ? getPivot() : null;
                const end = withPivot(start, raw);
                pivotRef.current = null;
                setLocal(end);
                onPreview(selected!.id, end);
                onCommit(selected!.id, start, end);
              }}
              className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-100"
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Scale (×)"
        right={
          <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={uniformScale}
              onChange={(e) => setUniformScale(e.target.checked)}
              className="accent-primary-600"
            />
            비율 유지
          </label>
        }
      >
        {/*
          ★ 스케일은 **숫자 입력만** 둔다 (슬라이더 없음).
            리드 지시: "xyz 뭉쳐서 하나의 슬라이더로 조절하게 하는건 안좋다.
            수치로만 입력하게 하고 슬라이더 빼."
            이유: 배율은 0.01 단위의 정밀한 값을 넣는 일이 대부분인데 슬라이더는
            그 정밀도를 못 준다. 또 "통합 조정" 이 켜져 있어도 축이 3개로 보여야
            지금 어떤 값인지 읽을 수 있다(하나로 합치면 축별 값이 안 보인다).
            → 항상 X/Y/Z 세 칸을 보여주고, "비율 유지" 가 켜져 있으면 한 칸을
              고쳤을 때 나머지가 **같은 값으로 따라간다**.
        */}
        <div className="space-y-1.5">
          {DISPLAY_AXIS_LABELS.map((label, i) => (
            <div key={label} className="flex items-center space-x-2">
              <span className="w-4 text-xs font-bold text-gray-600">
                {label}
              </span>
              <NumberInput
                // 표시 축 배율 (B-13) — 부호 없이 축만 교환한 값.
                value={displayScale[i]}
                min={0.01}
                max={100}
                step={0.01}
                decimals={3}
                onBegin={beginDrag}
                onChange={(v) => applyScaleField(i as 0 | 1 | 2, v)}
                onEnd={endDrag}
                ariaLabel={`${label} 배율`}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
              />
              <span className="w-4 text-xs text-gray-400">×</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          1 = 원본 크기 · 0.5 = 절반 · 2 = 두 배
        </p>
      </Section>
    </div>
  );
};

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {title}
        </h4>
        {right}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

interface RowProps {
  axis: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 숫자칸 표시 반올림 자릿수 (B-14). 내부 값은 반올림하지 않는다. */
  decimals: number;
  onBegin: () => void;
  onChange: (v: number) => void;
  onEnd: () => void;
}

/**
 * 슬라이더 + 숫자칸 한 줄.
 *
 * 두 입력의 커밋 규약이 **다르다** (B-14):
 *   · 슬라이더 — 드래그는 연속 조작이라 실시간 프리뷰가 맞다. 종전대로
 *     pointerdown=onBegin / onChange 즉시 반영 / pointerup=onEnd.
 *     undo 단위 = 한 번의 드래그.
 *   · 숫자칸 — 타자 도중의 반쪽 숫자가 즉시 적용되던 것이 리드가 보고한 증상의
 *     원인이었다. `NumberInput` 이 Enter/blur 에서만 커밋하고, 값이 실제로
 *     바뀔 때만 onBegin→onChange→onEnd 를 한 묶음으로 낸다.
 *     undo 단위 = 한 번의 편집.
 */
function Row({
  axis,
  value,
  min,
  max,
  step,
  decimals,
  onBegin,
  onChange,
  onEnd,
}: RowProps) {
  return (
    <div className="flex items-center space-x-2">
      <span className="w-4 text-xs font-bold text-gray-600">{axis}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onBegin}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        aria-label={`${axis} 슬라이더`}
      />
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        decimals={decimals}
        onBegin={onBegin}
        onChange={onChange}
        onEnd={onEnd}
        ariaLabel={axis}
        className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded"
      />
    </div>
  );
}

export default TransformPanel;
