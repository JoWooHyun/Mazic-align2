// 서포트 부품 STL 로드·캐시 (S-4b-1, B안). 브라우저(Vite) 전용.
//   parts/ 의 바이너리 STL 3종을 Vite `?url` 로 번들 → fetch → ArrayBuffer →
//   자체 바이너리 STL 파서로 { positions, indices } 파싱해 1회 캐시한다.
//
//   Babylon SceneLoader 를 쓰지 않는 이유: 조립 코어(assemble-core.ts)를 순수
//   함수로 유지해 헤드리스 검증이 가능하게 하기 위함. 여기서도 Babylon 을
//   import 하지 않는다.

import type { SupportPartsGeometry, SupportPartsSet } from "./assemble-core";

// Vite: STL 을 URL 에셋으로 번들. (기본적으로 알 수 없는 확장자는 asset 처리됨.)
import sphereUrl from "./parts/sphere.stl?url";
import coneUrl from "./parts/cone.stl?url";
import cylinderUrl from "./parts/cylinder.stl?url";

/**
 * 바이너리 STL → { positions, indices }.
 *   포맷: 80바이트 헤더 skip → uint32 삼각형 수 → 삼각형당 50바이트
 *   (법선 12 + 정점3×12 + attr 2). 정점 중복은 그대로 둔다(indices 는 0,1,2,…
 *   순번). 법선은 버린다(래퍼가 재계산).
 */
function parseBinaryStl(buf: ArrayBuffer): SupportPartsGeometry {
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let off = 84;
  let pi = 0;
  for (let t = 0; t < count; t++) {
    off += 12; // 법선 skip.
    for (let v = 0; v < 3; v++) {
      positions[pi++] = dv.getFloat32(off, true);
      positions[pi++] = dv.getFloat32(off + 4, true);
      positions[pi++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // attr byte count skip.
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

let cache: SupportPartsSet | null = null;
let loading: Promise<void> | null = null;

async function fetchPart(url: string): Promise<SupportPartsGeometry> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return parseBinaryStl(buf);
}

/**
 * 부품 STL 3종을 1회 로드해 캐시한다. 중복 호출은 무해(같은 Promise 재사용).
 */
export async function initSupportParts(): Promise<void> {
  if (cache) return;
  if (loading) return loading;
  loading = (async () => {
    const [sphere, cone, cylinder] = await Promise.all([
      fetchPart(sphereUrl),
      fetchPart(coneUrl),
      fetchPart(cylinderUrl),
    ]);
    cache = { sphere, cone, cylinder };
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

/** 로드된 부품 세트. 미로드 시 null (호출 측이 initSupportParts 후 재시도). */
export function getSupportParts(): SupportPartsSet | null {
  return cache;
}
