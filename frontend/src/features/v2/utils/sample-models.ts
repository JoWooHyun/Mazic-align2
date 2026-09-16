// 예제 모델 — 치수 확인·시험 출력용 기본 도형(정육면체 / 구)을 바이너리 STL 로 생성한다.
//
// 왜 파일이 아니라 코드 생성인가:
//   · 저작권/출처 무관 — 남의 STL 을 저장소에 들이지 않으므로 라이선스 확인이 필요 없다.
//   · git 에 바이너리 불요 — 수 KB~수십 KB 라도 diff 가 안 되는 파일은 이력만 무겁게 한다.
//   · 치수 정확성 보장 — "20mm 정육면체" 가 정말 20.000mm 인지 코드로 단언할 수 있고,
//     verify-sample-models.mjs 가 AABB 를 직접 재서 회귀를 막는다.
//
// 좌표계: 이 파일이 만드는 것은 **STL 파일 자체**다. STL 관례대로 Z-up 이 아니라,
//   불러오자마자 플레이트에 앉도록 "바닥이 y=0, XZ 중심이 원점"(y ∈ [0, size],
//   x·z ∈ [-size/2, size/2]) 으로 생성한다. 실제 화면 배치는 stl-loader 의
//   alignMeshToPlate 가 어차피 다시 맞추지만, 파일 단독으로 열어도 말이 되는 형태로 둔다.
//
//   ⚠️ 이 Y-up 생성은 **등방 도형(20×20×20)이라 안전한 것**이다. stl-loader 는 STL 을
//   Z-up 으로 가정해 X −90° 를 베이크한 뒤 `autoOrientUpright` 를 돌리는데, 그 함수는
//   축 비율이 1.5배를 넘을 때만 세운다(stl-loader.ts RATIO). 큐브·구는 세 축이 같아
//   임계에 안 걸려 no-op 이므로 결과가 의도대로 나온다.
//   **비등방 예제(원기둥·육각기둥 등)를 추가한다면 의도치 않게 회전되므로,
//   그때는 Z-up 생성으로 전환할지 먼저 검토할 것.**
//
// 법선: 실제 외향 법선을 계산해 기입한다(0 으로 두지 않는다 — 오버행 검출이 법선을 쓴다).
//   삼각형 winding 은 반시계(CCW, 오른손 법칙)로 바깥을 향한다. 앞뒤가 뒤집히면
//   오버행 하이라이트·서포트 검출이 반대로 동작한다.

/** 예제 모델 한 종의 정의. */
export interface SampleModelDef {
  id: "cube20" | "sphere20";
  /** 메뉴에 표시할 한국어 이름. */
  label: string;
  /** 저장될 파일명 (STL 목록에 이 이름으로 뜬다). */
  fileName: string;
  /** 호출 시점에 바이너리 STL 을 생성 — 앱 시작 비용 0. */
  build: () => Blob;
}

/** 삼각형 하나 = 정점 3개. 각 정점은 [x, y, z] mm. */
type Tri = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** 바이너리 STL 한 삼각형의 바이트 수 (법선 3 + 정점 9 = float32 12개 + uint16 속성). */
const TRI_BYTES = 50;
/** 바이너리 STL 헤더 바이트 수 (ASCII 설명문, 나머지는 0). */
const HEADER_BYTES = 80;

/**
 * 삼각형 (a, b, c) 의 외향 단위 법선 = normalize((b−a) × (c−a)).
 * winding 이 CCW 이므로 오른손 법칙 결과가 곧 바깥 방향이다.
 * 면적 0 삼각형은 애초에 만들지 않으므로(극점 축약 참고) 길이가 0 이 되는 경우는 없다.
 */
function triangleNormal(tri: Tri): [number, number, number] {
  const [a, b, c] = tri;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  // 방어적 폴백 — 여기 걸리면 도형 생성 쪽에 degenerate 삼각형이 있다는 뜻.
  if (len === 0) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * 삼각형 목록 → 바이너리 STL Blob.
 *   헤더 80바이트(ASCII description, 나머지 0) + uint32 삼각형 개수
 *   + 삼각형마다 50바이트(법선 float32×3, 정점 float32×9, 속성 uint16=0).
 * 모든 수치는 **리틀엔디언**.
 */
function buildBinaryStl(description: string, tris: readonly Tri[]): Blob {
  const buffer = new ArrayBuffer(HEADER_BYTES + 4 + tris.length * TRI_BYTES);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 헤더 — ASCII 설명문을 앞에서부터 채우고 나머지는 0 그대로 둔다.
  //   ("solid" 로 시작하면 ASCII STL 로 오인될 수 있으므로 그런 접두사는 쓰지 않는다.)
  for (let i = 0; i < description.length && i < HEADER_BYTES; i++) {
    bytes[i] = description.charCodeAt(i) & 0x7f;
  }

  view.setUint32(HEADER_BYTES, tris.length, true);

  let offset = HEADER_BYTES + 4;
  for (const tri of tris) {
    const n = triangleNormal(tri);
    view.setFloat32(offset, n[0], true);
    view.setFloat32(offset + 4, n[1], true);
    view.setFloat32(offset + 8, n[2], true);
    offset += 12;
    for (const v of tri) {
      view.setFloat32(offset, v[0], true);
      view.setFloat32(offset + 4, v[1], true);
      view.setFloat32(offset + 8, v[2], true);
      offset += 12;
    }
    // 속성 바이트 수 — 색상 확장을 쓰지 않으므로 0.
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "model/stl" });
}

/** 정육면체 한 변 (mm). */
const CUBE_SIZE = 20;
/** 구 반지름 (mm) — 지름 20mm. */
const SPHERE_RADIUS = 10;
/** 구 위도 분할 수 (극 → 극). */
const SPHERE_LAT = 32;
/** 구 경도 분할 수 (한 바퀴). */
const SPHERE_LON = 32;

/**
 * 20×20×20mm 정육면체 — 삼각형 12개 (면당 2개).
 * 바닥이 y=0, XZ 중심이 원점 → x·z ∈ [−10, 10], y ∈ [0, 20].
 */
function buildCube(): Blob {
  const h = CUBE_SIZE / 2;
  const top = CUBE_SIZE;
  // 바닥 4점 (y=0) / 윗면 4점 (y=20). 위에서 볼 때 반시계 순서.
  const b0: readonly [number, number, number] = [-h, 0, -h];
  const b1: readonly [number, number, number] = [h, 0, -h];
  const b2: readonly [number, number, number] = [h, 0, h];
  const b3: readonly [number, number, number] = [-h, 0, h];
  const t0: readonly [number, number, number] = [-h, top, -h];
  const t1: readonly [number, number, number] = [h, top, -h];
  const t2: readonly [number, number, number] = [h, top, h];
  const t3: readonly [number, number, number] = [-h, top, h];

  // 각 면을 바깥에서 봤을 때 CCW 가 되도록 감는다(= 오른손 법칙 법선이 바깥).
  const tris: Tri[] = [
    // 아랫면 (법선 −Y)
    [b0, b1, b2],
    [b0, b2, b3],
    // 윗면 (법선 +Y)
    [t0, t3, t2],
    [t0, t2, t1],
    // 앞면 z=+h (법선 +Z)
    [b3, t2, t3],
    [b3, b2, t2],
    // 뒷면 z=−h (법선 −Z)
    [b1, t0, t1],
    [b1, b0, t0],
    // 오른면 x=+h (법선 +X)
    [b2, t1, t2],
    [b2, b1, t1],
    // 왼면 x=−h (법선 −X)
    [b0, t3, t0],
    [b0, b3, t3],
  ];

  return buildBinaryStl("MazicAlign sample: cube 20mm", tris);
}

/**
 * 지름 20mm 구 — UV(위도-경도) 분할, 위도 32 × 경도 32.
 * 중심을 y=10 에 두어 바닥이 y=0 에 닿는다.
 *
 * 극점 근처 링은 삼각형 하나로 축약한다 — 극에 모이는 정점을 쿼드로 감으면
 * 면적 0 삼각형(degenerate)이 생기고, 검출 코드가 NaN 법선을 보게 된다.
 * 삼각형 수 = 경도 × (위도−1) × 2 − 경도 × 2 = 32 × 62 = 1,984개.
 */
function buildSphere(): Blob {
  const r = SPHERE_RADIUS;
  const cy = SPHERE_RADIUS; // 중심 y — 바닥이 y=0.

  /** 위도 인덱스 i(0=남극, SPHERE_LAT=북극), 경도 인덱스 j → 구면 위 한 점. */
  const point = (i: number, j: number): readonly [number, number, number] => {
    // phi: 0(남극) → π(북극). theta: 0 → 2π.
    const phi = (Math.PI * i) / SPHERE_LAT;
    const theta = (2 * Math.PI * (j % SPHERE_LON)) / SPHERE_LON;
    const sinPhi = Math.sin(phi);
    return [
      r * sinPhi * Math.cos(theta),
      cy - r * Math.cos(phi),
      r * sinPhi * Math.sin(theta),
    ];
  };

  const tris: Tri[] = [];
  for (let i = 0; i < SPHERE_LAT; i++) {
    for (let j = 0; j < SPHERE_LON; j++) {
      const a = point(i, j); // 아래 링, 현재 경도
      const b = point(i, j + 1); // 아래 링, 다음 경도
      const c = point(i + 1, j + 1); // 위 링, 다음 경도
      const d = point(i + 1, j); // 위 링, 현재 경도
      // 바깥에서 볼 때 CCW 가 되도록 (a, d, c, b) 순으로 감는다.
      if (i === 0) {
        // 남극 팬 — a 와 b 가 같은 점(남극)이므로 삼각형 하나만.
        tris.push([a, d, c]);
      } else if (i === SPHERE_LAT - 1) {
        // 북극 팬 — c 와 d 가 같은 점(북극)이므로 삼각형 하나만.
        tris.push([a, c, b]);
      } else {
        // 중간 쿼드 → 삼각형 2개.
        tris.push([a, c, b]);
        tris.push([a, d, c]);
      }
    }
  }

  return buildBinaryStl("MazicAlign sample: sphere d20mm", tris);
}

/** 메뉴에 노출되는 예제 모델 목록 (치투박스 기본 예제와 같은 구성). */
export const SAMPLE_MODELS: readonly SampleModelDef[] = [
  {
    id: "cube20",
    label: "정육면체 20×20×20 mm",
    fileName: "sample_cube_20mm.stl",
    build: buildCube,
  },
  {
    id: "sphere20",
    label: "구 지름 20 mm",
    fileName: "sample_sphere_d20mm.stl",
    build: buildSphere,
  },
];
