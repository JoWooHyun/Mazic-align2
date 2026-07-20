// 마진 안쪽 face floodfill 액션 — ctx 기반. 원본 fillFromFace 순수 이동.
//   dental-actions.ts 에서 분리(파일 500줄 상한 준수). 로직·수치·문자열 무변경.
import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";
import type { SceneCtx } from "./scene-refs";

/**
 * 마진 안쪽 face floodfill — startFace 를 시작으로 마진 엣지(edgeKeys)를 차단
 * 벽 삼아 BFS 로 내부 face 를 모으고 주황 오버레이로 채운다.
 *   원본 fillFromFace 이식. 결과는 autoFillFacesRef (painted 계약과 별도 집합)
 *   에 저장하고 오버레이 mesh 는 mesh.parent 로 부착해 회전을 추종한다.
 */
export function fillMarginFromFace(
  ctx: SceneCtx,
  stlId: string,
  startFace: number,
): void {
  const scene = ctx.sceneRef.current;
  if (!scene) return;
  const mesh = ctx.meshMapRef.current.get(stlId);
  if (!mesh) return;
  const margin = ctx.marginRef.current;
  if (!margin || margin.stlId !== stlId || !margin.canon) {
    // 원본 console.warn('마진 색칠: 먼저 "마진 찾기" 를 실행하세요.') 대응.
    console.warn('마진 색칠: 먼저 "마진 찾기" 를 실행하세요.');
    return;
  }
  const meshIndices = mesh.getIndices();
  if (!meshIndices) return;
  const canon = margin.canon;

  // 마진 엣지(canonical "a,b") 를 차단 벽으로 BFS. (원본 fillFromFace verbatim —
  //   3D 근접 차단(bridge wall)은 원본에서 이미 비활성이라 옮기지 않음.)
  const ek = (a: number, b: number): string =>
    a < b ? `${a},${b}` : `${b},${a}`;
  const edgeToFaces = new Map<string, number[]>();
  const triCount = meshIndices.length / 3;
  for (let f = 0; f < triCount; f++) {
    const ia = canon[meshIndices[f * 3]];
    const ib = canon[meshIndices[f * 3 + 1]];
    const ic = canon[meshIndices[f * 3 + 2]];
    for (const [a, b] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      const k = ek(a, b);
      let arr = edgeToFaces.get(k);
      if (!arr) {
        arr = [];
        edgeToFaces.set(k, arr);
      }
      arr.push(f);
    }
  }
  // BFS face → face, 마진 엣지 차단.
  const filled = new Set<number>([startFace]);
  const queue: number[] = [startFace];
  let head = 0;
  while (head < queue.length) {
    const f = queue[head++];
    const ia = canon[meshIndices[f * 3]];
    const ib = canon[meshIndices[f * 3 + 1]];
    const ic = canon[meshIndices[f * 3 + 2]];
    const ef: [number, number][] = [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ];
    for (const [a, b] of ef) {
      const k = ek(a, b);
      if (margin.edgeKeys.has(k)) continue; // 명시적 마진 엣지 = 차단 벽.
      const adj = edgeToFaces.get(k);
      if (!adj) continue;
      for (const nb of adj) {
        if (nb === f) continue;
        if (filled.has(nb)) continue;
        filled.add(nb);
        queue.push(nb);
      }
    }
  }
  ctx.autoFillFacesRef.current = filled;

  // 시각화 — 이전 floodfill 오버레이를 전부 제거 후 새로 생성 (원본 fillFromFace
  //   verbatim). autoFillFacesRef 는 단일 전역 Set 이라 floodfill 은 한 번에 한
  //   영역만 존재 → 위에서 filled 로 덮어쓴 순간 다른 STL 의 이전 fill 은 추적에서
  //   벗어난다. 오버레이도 stlId 불문 전부 지워야 다른 STL 의 orphan 잔존(2-3b
  //   잔여 ②)을 막는다.
  for (const m of ctx.autoFillOverlayRef.current) m.dispose(false, true);
  ctx.autoFillOverlayRef.current = [];
  const meshPositions = mesh.getVerticesData("position");
  if (!meshPositions) return;
  const positions: number[] = [];
  const indices: number[] = [];
  let vIdx = 0;
  for (const f of filled) {
    for (let kk = 0; kk < 3; kk++) {
      const vi = meshIndices[f * 3 + kk];
      positions.push(
        meshPositions[vi * 3],
        meshPositions[vi * 3 + 1],
        meshPositions[vi * 3 + 2],
      );
    }
    indices.push(vIdx, vIdx + 1, vIdx + 2);
    vIdx += 3;
  }
  if (indices.length === 0) return;
  const overlay = new Mesh("v2_maskAutoFill", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const norms: number[] = [];
  VertexData.ComputeNormals(positions, indices, norms);
  vd.normals = norms;
  vd.applyToMesh(overlay);
  const mat = new StandardMaterial("v2_maskAutoFillMat", scene);
  mat.emissiveColor = new Color3(0.96, 0.52, 0.13); // 주황 (painted 와 동일 톤).
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.zOffset = -1;
  overlay.material = mat;
  overlay.isPickable = false;
  overlay.metadata = { stlId };
  // 직접 parent 할당 — overlay vertex 가 LOCAL mesh 좌표라서 setParent 대신
  //   parent= 로 attach 해야 worldMatrix = mesh.worldMatrix 로 올바르게 얹힌다.
  overlay.parent = mesh;
  ctx.autoFillOverlayRef.current.push(overlay);
  console.log(
    `[마진 색칠] 시작 face ${startFace} → 자동 색칠 ${filled.size}/${triCount}`,
  );
}
