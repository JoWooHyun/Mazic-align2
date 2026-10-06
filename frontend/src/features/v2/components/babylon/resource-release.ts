// 씬 자원 해제 헬퍼 — 데모 사고 방지 2차 C3(manifold WASM)·C7(메시별 머티리얼).
//
//   C3: manifold-3d 의 Manifold 는 WASM 힙에 사는 C++ 객체라 JS GC 도 scene.dispose()
//     도 회수하지 않는다(embind — `.delete()` 를 불러야 해제). STL 마다 하나씩 만드는
//     캐시(ctx.stlManifoldMapRef)를 모델 삭제 때만 지우고 씬 정리 때는 지우지 않아,
//     뷰어를 들락날락할 때마다 모델 크기만큼 WASM 메모리가 쌓였다.
//   C7: Mesh.dispose() 는 기본값으로 머티리얼을 남긴다. STL 메시의 머티리얼은 STL
//     마다 하나씩 만든 **전용**(stl-loader `${name}-mat`)이라 메시와 함께 지운다.
//
//   ★ 공유 머티리얼 보호: `dispose(false, true)` 는 쓰지 않는다. 그 두 번째 인자는
//     **자식까지 재귀로** 머티리얼을 지운다(Babylon node.js dispose → 자손 dispose 에
//     같은 인자 전달). STL 메시의 자식에는 브릿지·stl-local 서포트(공유
//     supportMaterialRef)가 있어, 남은 서포트가 죽은 머티리얼을 잡게 된다.
//     서포트 메시는 전부 공유 머티리얼만 쓰므로 머티리얼을 해제하지 않는다
//     (useSupportMeshSync — 종전 그대로).
//
//   검증: scripts/verify-safety2.mjs (실제 manifold-3d + Babylon NullEngine).
import type { Mesh } from "@babylonjs/core";
import type { Manifold } from "manifold-3d";

/** STL 하나의 manifold 캐시를 해제한다 (없으면 아무 일 없음). */
export function releaseStlManifold(
  map: Map<string, Manifold>,
  stlId: string,
): void {
  const m = map.get(stlId);
  if (!m) return;
  map.delete(stlId);
  m.delete();
}

/**
 * 씬 정리용 — STL manifold 캐시 전부를 해제하고 비운다.
 *   하나가 던져도 나머지 해제와 뒤따르는 씬·엔진 dispose 가 이어지게 개별로 잡는다.
 */
export function releaseAllStlManifolds(map: Map<string, Manifold>): void {
  for (const m of map.values()) {
    try {
      m.delete();
    } catch (e) {
      console.warn("[v2] manifold 해제 실패 (씬 정리는 계속)", e);
    }
  }
  map.clear();
}

/**
 * STL 메시와 그 **전용** 머티리얼을 함께 해제한다 (C7).
 *   자식 메시(브릿지·stl-local 서포트·색칠 데칼 등)는 종전처럼 재귀로 dispose 하되
 *   그들의 머티리얼은 건드리지 않는다(위 공유 머티리얼 보호). 자식의 전용 머티리얼
 *   (마진·아일랜드 오버레이, 색칠 데칼)은 각자의 정리 경로가 `dispose(false, true)` 로
 *   먼저 지운다.
 *   방어: 해제 뒤에도 씬의 다른 메시가 이 머티리얼을 쓰고 있으면 공유로 보고 남긴다.
 */
export function disposeStlMesh(mesh: Mesh): void {
  const scene = mesh.getScene();
  const mat = mesh.material;
  mesh.dispose();
  if (!mat) return;
  if (scene.meshes.some((m) => m.material === mat)) return;
  mat.dispose(false, true);
}
