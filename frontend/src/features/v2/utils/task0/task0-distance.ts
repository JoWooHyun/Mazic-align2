/**
 * 정확한 유클리드 거리 변환 (제곱, 픽셀 단위) — Task0 커버리지 검사기용 (Z1-b1)
 *
 * 알고리즘: Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions" (2012) 의
 *   1D 제곱 거리 변환(포물선 하한 포락선)을 열 방향 → 행 방향 두 번. 결과는 **정확한** 제곱 거리
 *   (근사 아님 — 표본점이 정수 격자라 값은 정수, Float64 로 정확히 표현된다).
 *
 * 입력 0/1 격자(행 우선, 길이 width·height) → 각 칸에서 가장 가까운 표적 칸(기본 값 1)까지 제곱거리.
 * 표적 칸이 하나도 없으면 전부 Infinity. 1D 단계에서 Infinity 칸은 포물선으로 넣지 않는다
 * (원 논문처럼 큰 유한값을 쓰면 Infinity − Infinity = NaN 이나 큰 값끼리의 반올림 문제가 생긴다).
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */

/**
 * 1D 제곱 거리 변환 — f[q] (Infinity = 표본 없음) → d[q] = min_p ((q − p)² + f[p]).
 * v·z 는 작업 버퍼(길이 ≥ n, ≥ n + 1). 표본이 하나도 없으면 d 전부 Infinity.
 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = -1;
  for (let q = 0; q < n; q++) {
    const fq = f[q];
    if (fq === Infinity) continue;
    let s = -Infinity;
    while (k >= 0) {
      const p = v[k];
      s = (fq + q * q - (f[p] + p * p)) / (2 * (q - p));
      if (s <= z[k]) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = k === 0 ? -Infinity : s;
    z[k + 1] = Infinity;
  }
  if (k < 0) {
    for (let q = 0; q < n; q++) d[q] = Infinity;
    return;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    const dq = q - p;
    d[q] = dq * dq + f[p];
  }
}

/**
 * 2D 제곱 유클리드 거리 변환 (픽셀² 단위).
 * @param cells 행 우선 격자 (길이 width·height)
 * @param target 표적 값 — cells[i] === target 인 칸까지의 거리 (기본 1). 0 을 주면 "0 인 칸까지" 거리
 * @returns 길이 width·height. 표적 칸 자신은 0, 표적이 없으면 Infinity
 */
export function squaredDistanceTransform(
  cells: ArrayLike<number>,
  width: number,
  height: number,
  target = 1,
): Float64Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`격자 크기는 0 이상의 정수여야 함 (받은 값: ${width}×${height})`);
  }
  if (cells.length < width * height) {
    throw new RangeError(`격자 길이 ${cells.length} < ${width}×${height}`);
  }
  const out = new Float64Array(width * height);
  if (width === 0 || height === 0) return out;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  // 1) 열 방향 — 각 열에서 같은 열 표적까지 세로 제곱거리
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = cells[y * width + x] === target ? 0 : Infinity;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y];
  }
  // 2) 행 방향 — 1) 결과를 표본값으로 가로 포락선
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = out[row + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) out[row + x] = d[x];
  }
  return out;
}
