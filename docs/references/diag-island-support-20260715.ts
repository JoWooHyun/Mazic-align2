/**
 * 진단 스크립트 — 아일랜드 검출 → 자동 서포트 파이프라인을 실제 코드로 headless 실행.
 * (코드 수정 없음 — v2 소스의 실제 함수를 그대로 import)
 */
import {
  NullEngine,
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  Ray,
} from "@babylonjs/core";
import { autoGenerateSupportPoints } from "./src/features/v2/support/utils/auto-generate";
import { DEFAULT_SUPPORT_PARAMS } from "./src/features/v2/support/utils/defaults";
import { readWorldTriangles } from "./src/features/v2/utils/dental/dental-support";
import { detectSliceIslands } from "./src/features/v2/utils/dental/island-detection";

const engine = new NullEngine();
const scene = new Scene(engine);

function buildModel(liftY: number, islandR: number): Mesh {
  // 본체: 12x8x12 박스 (치아 본체 규모), 바닥이 y=liftY
  const body = MeshBuilder.CreateBox("body", { width: 12, height: 8, depth: 12 }, scene);
  body.position = new Vector3(0, liftY + 4, 0);
  // 아일랜드: 본체 옆에 떠 있는 작은 구 (미지지 조각 — 슬라이스상 진짜 island)
  const isl = MeshBuilder.CreateSphere("isl", { diameter: islandR * 2, segments: 12 }, scene);
  // 그리드 정중앙에 오도록 배치: AABB minX=-6 → 그리드 x = -4,0,4,8 → (8, *, 8) 이 정확히 샘플됨
  isl.position = new Vector3(8, liftY + 3, 8);
  const merged = Mesh.MergeMeshes([body, isl], true, true, undefined, false, false)!;
  merged.name = "model";
  merged.isPickable = true;
  merged.computeWorldMatrix(true);
  merged.refreshBoundingInfo();
  return merged;
}

function runCase(label: string, liftY: number, islandR: number, spacing: number) {
  const mesh = buildModel(liftY, islandR);
  const tris = readWorldTriangles(mesh);

  // BabylonScene.runDetectDentalIslands 와 동일 파라미터 (lh=0.05, 45°, downFacingOnly, minIslandCells 1, plateGap 0)
  const lh = 0.05;
  const result = detectSliceIslands({
    tris,
    cellSize: lh,
    layerHeight: lh,
    supportAngle: 45,
    downFacingOnly: true,
    minIslandCells: 1,
    plateGap: 0,
  });

  const params = { ...DEFAULT_SUPPORT_PARAMS, contactSpacingMm: spacing };

  // 실제 파이프라인 호출 (faceFilter = 검출 결과)
  const ptsFiltered = autoGenerateSupportPoints(scene, mesh, [], params, "p", "s", {
    faceFilter: result.islandFaces,
  });
  // 비교: 필터 없는 기존 전체 자동 생성
  const ptsAll = autoGenerateSupportPoints(scene, mesh, [], params, "p", "s");

  // 부가 진단: 그리드 레이 중 island face 를 first-hit 한 수 / 필터 단계별 손실
  const bb = mesh.getBoundingInfo().boundingBox;
  const step = params.contactSpacingMm;
  let rays = 0, hits = 0, hitIsland = 0, passNormal = 0, passY = 0;
  const overhangCos = Math.cos((params.overhangAngleDeg * Math.PI) / 180);
  const yBelow = bb.minimumWorld.y - 1;
  const rayLen = bb.maximumWorld.y + 1 - yBelow;
  for (let x = bb.minimumWorld.x + step / 2; x < bb.maximumWorld.x; x += step) {
    for (let z = bb.minimumWorld.z + step / 2; z < bb.maximumWorld.z; z += step) {
      rays++;
      const info = scene.pickWithRay(
        new Ray(new Vector3(x, yBelow, z), new Vector3(0, 1, 0), rayLen),
        (m: Mesh) => m === mesh,
      );
      if (!info?.hit || !info.pickedPoint) continue;
      hits++;
      if (info.faceId < 0 || !result.islandFaces.has(info.faceId)) continue;
      hitIsland++;
      const n = info.getNormal(true, true);
      if (!n || n.y > -overhangCos) continue;
      passNormal++;
      if (info.pickedPoint.y <= 0.5) continue;
      passY++;
    }
  }

  // island face 가 본체 바닥에도 붙는지 (lift 로 인한 전체 바닥 island 여부)
  let islandOnBody = 0, islandOnSphere = 0;
  for (const f of result.islandFaces) {
    const t = tris.find((tt) => tt.faceIndex === f);
    if (!t) continue;
    // 구는 XZ (9,9) 주변 반경 islandR*1.5 이내
    const dx = t.centroid.x - 8, dz = t.centroid.z - 8;
    if (Math.sqrt(dx * dx + dz * dz) < islandR * 2) islandOnSphere++;
    else islandOnBody++;
  }

  // 생성점 위치 분류 — 구(진짜 island) 위인지 본체 바닥인지
  const onSphere = ptsFiltered.filter((p) => {
    const dx = p.contact[0] - 8, dz = p.contact[2] - 8;
    return Math.sqrt(dx * dx + dz * dz) < islandR * 2;
  }).length;
  console.log(
    `[${label}] lift=${liftY} islandR=${islandR} spacing=${spacing}mm\n` +
      `  검출: islandFaces=${result.islandFaces.size} (구 부분=${islandOnSphere}, 본체 부분=${islandOnBody}) nSlices=${result.nSlices}\n` +
      `  그리드: rays=${rays} 메쉬hit=${hits} → island face first-hit=${hitIsland} → 45°통과=${passNormal} → y>0.5통과=${passY}\n` +
      `  >>> 실제 생성 (faceFilter): ${ptsFiltered.length}개 (그중 진짜 island 구 위: ${onSphere}개)  /  필터 없음(기존 전체): ${ptsAll.length}개`,
  );
  mesh.dispose();
}

// 시나리오 1: v2 기본 (lift 5mm) + 소형 island(r=1mm), 기본 간격 4mm
runCase("S1 기본", 5, 1.0, 4.0);
// 시나리오 2: lift 5mm + 아주 작은 island(r=0.5mm, 치과 커스프 규모)
runCase("S2 미세", 5, 0.5, 4.0);
// 시나리오 3: lift 0 (플레이트 직치) + island r=1mm
runCase("S3 무리프트", 0, 1.0, 4.0);
// 시나리오 4: 간격 최소값 1.5mm 로 좁혀도 되는지
runCase("S4 촘촘", 5, 0.5, 1.5);
// 시나리오 5: 큰 island (r=3mm) — PR 검수가 통과했을 법한 케이스
runCase("S5 대형", 5, 3.0, 4.0);

engine.dispose();
