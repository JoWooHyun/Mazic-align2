import { Mesh, Vector3, VertexBuffer } from "@babylonjs/core";

/**
 * 여러 Babylon Mesh 를 합쳐 binary STL Blob 으로 만든다.
 *
 * 좌표계 변환: Babylon (Y-up, left-handed) → STL (Z-up).
 *   Babylon (x, y, z) → STL (x, z, y)   ← stl-loader(Babylon STL 로더)의 Y/Z 교환을 그대로 되돌림
 *
 * 데모 수정 1차 ①-b(STL 축 Z-up, 리드 10/13): stl-loader 가 로더의 (x, z, y) 교환만 쓰므로(추가 회전
 * 없음) export 도 같은 교환이면 로드 → export 가 원본 정점·감김 그대로 돌아온다(verify-demo-fix1 (e)).
 * 종전은 로더 교환을 빼먹은 채 X +90° 로 되돌려(x, −z, y) 원본의 Y/Z 가 바뀐 **거울상**이 나갔다.
 *
 * 감김: 교환은 반사(행렬식 −1)라 그것만으로 감김이 뒤집힌다 — Babylon(left-handed, CW=front)의
 * 삼각형이 STL(right-handed)에서 CCW=외향이 되므로 정점 순서는 인덱스 그대로 쓴다(종전의 순수 회전
 * + 정점 1·2 교환과 감김 결과가 같다 — 서포트 등 STL 이 아닌 메시도 종전과 같은 감김으로 나간다).
 *
 * 각 face 의 normal 은 vertex 위치로부터 직접 재계산 (winding
 * 기반 outward). STL 파일에 저장된 normal 은 일반적으로 face normal.
 */
export function meshesToStlBlob(meshes: Mesh[]): Blob {
  const triangles: {
    n: [number, number, number];
    v0: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
  }[] = [];

  for (const mesh of meshes) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();
    if (!positions || !indices) continue;

    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();

    for (let i = 0; i < indices.length; i += 3) {
      // Babylon (left-handed, CW=front) → STL (right-handed, CCW=front)
      // → 아래 (x, z, y) 교환(반사)이 winding 을 뒤집으므로 정점 순서는 인덱스 그대로.
      //   그래야 외부 슬라이서가 face normal 을 올바른 외부 방향으로 인식.
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;

      const local0 = new Vector3(positions[i0], positions[i0 + 1], positions[i0 + 2]);
      const local1 = new Vector3(positions[i1], positions[i1 + 1], positions[i1 + 2]);
      const local2 = new Vector3(positions[i2], positions[i2 + 1], positions[i2 + 2]);

      // local → world (Babylon Y-up)
      const w0 = Vector3.TransformCoordinates(local0, world);
      const w1 = Vector3.TransformCoordinates(local1, world);
      const w2 = Vector3.TransformCoordinates(local2, world);

      // Babylon → STL: (x, y, z) → (x, z, y) — 로드 교환의 역(자기 자신)
      const s0: [number, number, number] = [w0.x, w0.z, w0.y];
      const s1: [number, number, number] = [w1.x, w1.z, w1.y];
      const s2: [number, number, number] = [w2.x, w2.z, w2.y];

      // face normal (STL 좌표에서 직접 계산)
      const e1x = s1[0] - s0[0];
      const e1y = s1[1] - s0[1];
      const e1z = s1[2] - s0[2];
      const e2x = s2[0] - s0[0];
      const e2y = s2[1] - s0[1];
      const e2z = s2[2] - s0[2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      const n: [number, number, number] = [nx / len, ny / len, nz / len];

      triangles.push({ n, v0: s0, v1: s1, v2: s2 });
    }
  }

  // Binary STL: 80 header + 4 count + 50 per triangle.
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);

  let off = 84;
  const writeVec = (v: [number, number, number]) => {
    view.setFloat32(off, v[0], true);
    view.setFloat32(off + 4, v[1], true);
    view.setFloat32(off + 8, v[2], true);
    off += 12;
  };

  for (const t of triangles) {
    writeVec(t.n);
    writeVec(t.v0);
    writeVec(t.v1);
    writeVec(t.v2);
    view.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }

  return new Blob([buf], { type: "model/stl" });
}

/** 브라우저에서 Blob 을 파일로 저장. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 다음 tick 에 revoke — Safari 호환.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
