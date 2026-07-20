// dental-brush 색칠 훅 — 원본 effect #6.5 순수 이동.
//   브러쉬 페인팅/지우기/링/SHIFT+휠 두께조정/더블탭 floodfill + 스트로크 단위 flush.
//   ★ 이벤트 짝 유지: canvas 'wheel' 리스너는 {capture:true} 로 등록·해제 둘 다,
//   pointer 옵저버는 명시 remove(obs). pendingInvalidationsRef 는 ctx(컴포넌트 레벨)
//   공유 — 검출 함수가 pending 을 취소할 수 있어야 B3 레이스를 막는다. 로직 무변경.
import { useEffect } from "react";
import {
  Color3,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Quaternion,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import {
  computePaintedFaceIds,
  makePaintPoint,
} from "../../../utils/dental/paint-mask";
import type { EditMode } from "../../EditModeControls";
import type { SceneCtx } from "../scene-refs";
import {
  cancelPendingInvalidation,
  invalidateDentalResults,
  scheduleInvalidation,
} from "../dental-actions";
import { fillMarginFromFace } from "../dental-floodfill";

export function useDentalBrush(ctx: SceneCtx, editMode: EditMode): void {
  // 6.5) dental-brush 모드 — 브러쉬로 STL 표면 영역 색칠 (마스크).
  //   원본: frontend/src/components/STLViewer.tsx (지현규) supportTool==='mask'
  //   경로의 useEffect (약 718~1271줄) 이식. addMaskPoint / eraseMaskAt /
  //   포인터 옵저버 / 브러쉬 링 / SHIFT+휠 두께 조정 을 verbatim 에 가깝게 옮기고,
  //   painted 상태는 paintPointsRef 에 저장 후 onPaintedFacesChange 로 통지한다.
  //   (원본 maskRef → paintPointsRef, maskMarkersRef → paintOverlaysRef.)
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const camera = ctx.cameraRef.current;
    const engine = ctx.engineRef.current;
    const canvas = ctx.canvasRef.current;
    if (!scene || !camera || !engine || !canvas) return;
    if (editMode !== "dental-brush") return;

    canvas.style.cursor = "none";

    // 메쉬의 로컬 +Y 축을 dir 방향으로 정렬 (원본 orientYTo verbatim).
    const orientYTo = (m: Mesh, dir: Vector3): void => {
      const d = dir.normalizeToNew();
      const up = new Vector3(0, 1, 0);
      const dt = Math.max(-1, Math.min(1, Vector3.Dot(up, d)));
      if (dt > 0.999999) {
        m.rotationQuaternion = Quaternion.Identity();
      } else if (dt < -0.999999) {
        m.rotationQuaternion = Quaternion.RotationAxis(
          new Vector3(1, 0, 0),
          Math.PI,
        );
      } else {
        m.rotationQuaternion = Quaternion.RotationAxis(
          Vector3.Cross(up, d).normalize(),
          Math.acos(dt),
        );
      }
    };

    // 한 스트로크 동안 색칠/지우기로 영향 받은 mesh 를 모아둔다.
    //   computePaintedFaceIds 는 O(전체 tri × painted 점) 전수 스캔이라
    //   매 브러쉬 스텝(POINTERMOVE 당 최대 80 회)마다 돌리면 대형 스캔에서
    //   프리즈. 따라서 스텝마다는 mesh 만 기록하고, 실제 재계산·통지는
    //   스트로크 종료(POINTERUP / 단발 클릭)에서 mesh 당 1 회만 flush 한다.
    //   판정 로직 자체는 무변경 — 호출 시점만 스트로크 단위로 이동.
    const touchedMeshes = new Set<Mesh>();
    const markTouched = (mesh: Mesh): void => {
      touchedMeshes.add(mesh);
    };

    // 지연 무효화(감사 B3)의 상태·헬퍼는 컴포넌트 레벨로 승격됐다:
    //   pendingInvalidationsRef / scheduleInvalidation / cancelPendingInvalidation.
    //   (검출 함수가 pending 을 취소할 수 있어야 신선 결과 파괴 레이스를 막을 수
    //   있기 때문 — 지역 클로저에 가두면 불가.) 여기서는 그대로 호출만 한다.
    //   cleanup 에서 순회할 Map 을 effect 본문에서 미리 캡처한다 (react-hooks/
    //   exhaustive-deps 권고 — ref 가 보유한 Map 은 컴포넌트 생애 내내 동일
    //   객체라, 이후 스케줄러가 이 Map 을 mutate 해도 같은 참조로 반영된다).
    const pendingInvalidations = ctx.pendingInvalidationsRef.current;

    // 모아둔 touched mesh 마다 painted face 를 재계산해 통지 후 비운다.
    const flushPaintedNotifications = (): void => {
      if (touchedMeshes.size === 0) return;
      for (const mesh of touchedMeshes) {
        let stlId: string | undefined;
        for (const [id, m] of ctx.meshMapRef.current) {
          if (m === mesh) {
            stlId = id;
            break;
          }
        }
        if (!stlId) continue;
        const faces = computePaintedFaceIds(mesh, ctx.paintPointsRef.current);
        // 통지는 즉시 (painted 상태 동기 유지).
        ctx.onPaintedFacesChangeRef.current?.(stlId, Array.from(faces));
        // 무효화는 더블클릭 윈도우만큼 지연 예약 (위 주석 참고).
        //   ⚠️ flush 는 사용자 브러쉬 스트로크(POINTERUP/단발 클릭)에서만 호출된다.
        //   "마진 찾기"(runFindDentalMargin)는 painted 를 읽기만 하고 touchedMeshes
        //   를 건드리지 않으므로 검출 직후 무효화 예약이 생기지 않는다.
        scheduleInvalidation(ctx, stlId);
      }
      touchedMeshes.clear();
    };

    // mask 도구: 표면 법선에 맞춰 기울어지는 3D 브러쉬 링 (호버 시 표시).
    const brushRing = MeshBuilder.CreateTorus(
      "v2_brushRing",
      { diameter: 1, thickness: 0.07, tessellation: 40 },
      scene,
    );
    const rm = new StandardMaterial("v2_brushRingMat", scene);
    rm.emissiveColor = new Color3(0.2, 0.85, 0.95);
    rm.diffuseColor = new Color3(0, 0, 0);
    rm.disableLighting = true;
    rm.disableDepthWrite = true;
    brushRing.material = rm;
    brushRing.isPickable = false;
    brushRing.renderingGroupId = 1;
    brushRing.setEnabled(false);

    // SHIFT + 마우스 휠 → 브러쉬 커서 크기 조정 (카메라 줌은 막음).
    const maskWheel = (e: WheelEvent): void => {
      if (!e.shiftKey) return; // SHIFT 없으면 일반 휠(카메라 줌) 그대로
      e.preventDefault();
      e.stopImmediatePropagation(); // Babylon 카메라 줌 입력 차단
      const cur = ctx.brushThicknessRef.current;
      const next = Math.max(0.5, Math.min(30, cur + (e.deltaY < 0 ? 1 : -1)));
      if (next === cur) return;
      ctx.brushThicknessRef.current = next; // 브러쉬 링 즉시 반영
      ctx.onBrushThicknessChangeRef.current?.(next); // 패널 상태 동기화
    };
    canvas.addEventListener("wheel", maskWheel, {
      capture: true,
      passive: false,
    });

    // 현재 활성(선택)된 STL — 색칠은 이 메쉬에만 적용 (원본 getActiveMesh).
    const getActiveMesh = (): Mesh | null => {
      const ids = Array.from(ctx.selectedRef.current);
      let id: string | undefined = ids[0];
      if (!id) id = [...ctx.meshMapRef.current.keys()][0];
      return id ? ctx.meshMapRef.current.get(id) ?? null : null;
    };
    // scene.pick 술어 — 활성 STL 메쉬만 picking 대상으로 한정.
    const onlyActive = (m: { uniqueId: number }): boolean => {
      const a = getActiveMesh();
      return !!a && (m as unknown as Mesh) === a;
    };

    // mm → 화면 px (거리 dist 에서의 원근 투영) — 원본 mmToPx verbatim.
    const mmToPx = (mm: number, dist: number): number =>
      (mm * engine.getRenderHeight()) / (2 * dist * Math.tan(camera.fov / 2));

    // ── 브러쉬 상태 ──
    let brushing = false;
    let lastBrush: { x: number; y: number } | null = null;

    // mask — 보호 영역을 STL 표면에 데칼로 직접 색칠. 원본 addMaskPoint 이식.
    const addMaskPoint = (x: number, y: number): void => {
      const pick = scene.pick(x, y, onlyActive);
      if (!pick?.hit || !pick.pickedPoint || !pick.pickedMesh) return;
      // 데칼 투영 방향 — 원본은 smooth normal 우선. Babylon getNormal(true,true)
      //   = 정점 보간(smooth) world 법선. 실패 시 face 법선 fallback.
      let normal: Vector3 | null = pick.getNormal(true, true);
      if (!normal || normal.lengthSquared() < 1e-9) {
        normal = pick.getNormal(false, true);
      }
      if (!normal || normal.lengthSquared() < 1e-9) return;
      normal = normal.normalizeToNew();
      const viewDir = pick.pickedPoint.subtract(camera.position);
      if (Vector3.Dot(normal, viewDir) > 0) normal = normal.negate();
      const dia = Math.max(ctx.brushThicknessRef.current, 1);
      // 데칼 투영 깊이 — 작게 잡아 반대편(뒷면)까지 뚫고 칠해지지 않게 한다.
      const depthSize = Math.min(dia, 3);

      // STL 표면 geometry 에 밀착하는 데칼로 색칠 (size.z = 투영 깊이).
      const decal = MeshBuilder.CreateDecal("v2_maskDecal", pick.pickedMesh, {
        position: pick.pickedPoint,
        normal,
        size: new Vector3(dia, dia, depthSize),
      });

      // 클릭한 면 각도와 비슷한 삼각형만 유지 → 다른 각도의 면으로 안 번짐.
      const dpos = decal.getVerticesData("position");
      const didx = decal.getIndices();
      const dnorm = decal.getVerticesData("normal");
      if (dpos && didx && dnorm) {
        const COS = Math.cos((45 * Math.PI) / 180); // 45° 이내 면만
        const depthLimit = depthSize * 0.55; // 클릭 표면 근처만 유지 → 뒷면 제외
        const hit = pick.pickedPoint;
        const wm = decal.computeWorldMatrix(true);
        const kp: number[] = [];
        const ki: number[] = [];
        let k = 0;
        for (let t = 0; t < didx.length; t += 3) {
          const i0 = didx[t] * 3;
          const i1 = didx[t + 1] * 3;
          const i2 = didx[t + 2] * 3;
          const a = Vector3.TransformCoordinates(
            new Vector3(dpos[i0], dpos[i0 + 1], dpos[i0 + 2]),
            wm,
          );
          const b = Vector3.TransformCoordinates(
            new Vector3(dpos[i1], dpos[i1 + 1], dpos[i1 + 2]),
            wm,
          );
          const c = Vector3.TransformCoordinates(
            new Vector3(dpos[i2], dpos[i2 + 1], dpos[i2 + 2]),
            wm,
          );
          const tn = Vector3.TransformNormal(
            new Vector3(
              dnorm[i0] + dnorm[i1] + dnorm[i2],
              dnorm[i0 + 1] + dnorm[i1 + 1] + dnorm[i2 + 1],
              dnorm[i0 + 2] + dnorm[i1 + 2] + dnorm[i2 + 2],
            ),
            wm,
          );
          if (tn.lengthSquared() < 1e-12) continue;
          tn.normalize();
          if (Vector3.Dot(tn, normal) < COS) continue;
          const ctr = a.add(b).add(c).scale(1 / 3);
          if (Vector3.Dot(ctr.subtract(hit), normal) < -depthLimit) continue;
          for (const ii of [i0, i1, i2]) {
            kp.push(dpos[ii], dpos[ii + 1], dpos[ii + 2]);
          }
          ki.push(k, k + 1, k + 2);
          k += 3;
        }
        if (ki.length === 0) {
          decal.dispose();
          return;
        }
        const norms: number[] = [];
        VertexData.ComputeNormals(kp, ki, norms);
        const vd = new VertexData();
        vd.positions = kp;
        vd.indices = ki;
        vd.normals = norms;
        vd.applyToMesh(decal);
      }

      const maskMesh = pick.pickedMesh as Mesh;
      // painted 점 저장용 normal — 시각용 smooth normal 이 아니라 picked face 의
      //   face normal 사용. isMasked 의 정면 검사가 face normal 기반이라
      //   일관성 유지 → 마진 찾기 painted set 이 원본과 동일하게 나온다.
      let storeNormal = pick.getNormal(false, true);
      if (!storeNormal || storeNormal.lengthSquared() < 1e-9) {
        storeNormal = normal; // fallback
      } else {
        storeNormal = storeNormal.normalizeToNew();
        if (Vector3.Dot(storeNormal, viewDir) > 0) {
          storeNormal = storeNormal.negate();
        }
      }
      ctx.paintPointsRef.current.push(
        makePaintPoint(maskMesh, pick.pickedPoint, storeNormal, dia),
      );
      decal.isPickable = false;
      // 모델과 같은 렌더링 그룹(0) + 깊이쓰기 ON → 뒷면 색칠 투과 방지.
      const dm = new StandardMaterial("v2_maskMat", scene);
      dm.emissiveColor = new Color3(0.96, 0.52, 0.13); // 주황 (#F5852B 계열)
      dm.diffuseColor = new Color3(0, 0, 0);
      dm.disableLighting = true;
      dm.backFaceCulling = false;
      dm.zOffset = -2;
      decal.material = dm;
      decal.setParent(pick.pickedMesh); // 모델과 함께 움직이도록
      ctx.paintOverlaysRef.current.push(decal);
      markTouched(maskMesh); // 통지는 스트로크 종료 시 flush.
    };

    // mask — Ctrl+드래그 지우개. 원본 eraseMaskAt 이식.
    const eraseMaskAt = (x: number, y: number): void => {
      const pick = scene.pick(x, y, onlyActive);
      if (!pick?.hit || !pick.pickedPoint) return;
      const p = pick.pickedPoint;
      let eraseN: Vector3 | null = pick.getNormal(true, true);
      if (!eraseN || eraseN.lengthSquared() < 1e-9) {
        eraseN = pick.getNormal(false, true);
      }
      if (eraseN && eraseN.lengthSquared() < 1e-9) eraseN = null;
      if (eraseN) {
        eraseN = eraseN.normalizeToNew();
        const vd = pick.pickedPoint.subtract(camera.position);
        if (Vector3.Dot(eraseN, vd) > 0) eraseN = eraseN.negate();
      }
      const COS = Math.cos((30 * Math.PI) / 180);
      const r = Math.max(ctx.brushThicknessRef.current / 2, 1);
      for (let i = ctx.paintPointsRef.current.length - 1; i >= 0; i--) {
        const entry = ctx.paintPointsRef.current[i];
        const wm = entry.mesh.getWorldMatrix();
        const wp = Vector3.TransformCoordinates(entry.localPoint, wm);
        if (Vector3.Distance(wp, p) >= r + entry.radius) continue;
        if (eraseN) {
          const en = Vector3.TransformNormal(
            entry.localNormal,
            wm,
          ).normalize();
          if (Vector3.Dot(en, eraseN) < COS) continue;
        }
        markTouched(entry.mesh); // 통지는 스트로크 종료 시 flush.
        ctx.paintOverlaysRef.current[i]?.dispose(false, true);
        ctx.paintOverlaysRef.current.splice(i, 1);
        ctx.paintPointsRef.current.splice(i, 1);
      }
    };

    const obs = scene.onPointerObservable.add((pi) => {
      const ev = pi.event as PointerEvent;

      if (pi.type === PointerEventTypes.POINTERMOVE) {
        // 커서(브러쉬 링) 갱신 + 브러쉬 페인팅.
        const pick = scene.pick(scene.pointerX, scene.pointerY, onlyActive);
        const dist =
          pick?.hit && pick.pickedPoint
            ? Vector3.Distance(camera.position, pick.pickedPoint)
            : camera.radius;
        const sizePx = Math.max(mmToPx(ctx.brushThicknessRef.current, dist), 4);

        let ringShown = false;
        if (pick?.hit && pick.pickedPoint) {
          let n: Vector3 | null = pick.getNormal(true, true);
          if (!n || n.lengthSquared() < 1e-9) n = pick.getNormal(false, true);
          if (n && n.lengthSquared() < 1e-9) n = null;
          if (n) {
            n = n.normalizeToNew();
            const vd = pick.pickedPoint.subtract(camera.position);
            if (Vector3.Dot(n, vd) > 0) n = n.negate();
            const d = Math.max(ctx.brushThicknessRef.current, 1);
            brushRing.scaling.set(d, d, d);
            brushRing.position = pick.pickedPoint.add(n.scale(0.1));
            orientYTo(brushRing, n);
            (brushRing.material as StandardMaterial).emissiveColor =
              ev.ctrlKey
                ? new Color3(0.95, 0.25, 0.25) // 지우개
                : new Color3(0.2, 0.85, 0.95); // 칠하기
            brushRing.setEnabled(true);
            ringShown = true;
          }
        }
        if (!ringShown) brushRing.setEnabled(false);

        if (brushing) {
          // lastBrush→현재 점 구간을 stepPx 간격으로 채운다 (연속 획).
          const stepPx = Math.max(sizePx * 0.1, 2);
          const paintAt = (px: number, py: number): void => {
            if (ev.ctrlKey) eraseMaskAt(px, py);
            else addMaskPoint(px, py);
          };
          if (!lastBrush) {
            paintAt(scene.pointerX, scene.pointerY);
            lastBrush = { x: scene.pointerX, y: scene.pointerY };
          } else {
            const dx = scene.pointerX - lastBrush.x;
            const dy = scene.pointerY - lastBrush.y;
            const d = Math.hypot(dx, dy);
            if (d >= stepPx) {
              const steps = Math.min(Math.floor(d / stepPx), 80);
              for (let s = 1; s <= steps; s++) {
                const t = (s * stepPx) / d;
                paintAt(lastBrush.x + dx * t, lastBrush.y + dy * t);
              }
              const adv = (steps * stepPx) / d;
              lastBrush = {
                x: lastBrush.x + dx * adv,
                y: lastBrush.y + dy * adv,
              };
            }
          }
        }
      } else if (pi.type === PointerEventTypes.POINTERDOWN) {
        // 좌클릭 → 칠하기 스트로크 시작.
        if (ev.button === 0) {
          brushing = true;
          lastBrush = { x: scene.pointerX, y: scene.pointerY };
          if (ev.ctrlKey) eraseMaskAt(scene.pointerX, scene.pointerY);
          else addMaskPoint(scene.pointerX, scene.pointerY);
        }
      } else if (pi.type === PointerEventTypes.POINTERUP) {
        // 스트로크 종료 — 이 스트로크에서 색칠/지운 mesh 들의 painted face 를
        //   여기서 1 회만 재계산·통지 (단발 클릭도 DOWN→UP 이라 포함).
        brushing = false;
        lastBrush = null;
        flushPaintedNotifications();
      } else if (pi.type === PointerEventTypes.POINTERDOUBLETAP) {
        // 마진 안쪽 더블클릭 → floodfill 자동 색칠 (원본 fillFromFace 이식).
        //   마진 ref 가 없으면 fillMarginFromFace 가 console.warn 후 무시.
        if (ev.button !== 0) return;
        const pick = scene.pick(scene.pointerX, scene.pointerY, onlyActive);
        if (
          !pick?.hit ||
          !pick.pickedMesh ||
          pick.faceId === undefined ||
          pick.faceId < 0
        )
          return;
        let sid: string | undefined;
        for (const [id, m] of ctx.meshMapRef.current.entries()) {
          if (m === pick.pickedMesh) {
            sid = id;
            break;
          }
        }
        if (!sid) return;
        // 더블탭 = floodfill 채우기 의도. 직전 첫 클릭의 POINTERUP flush 가
        //   예약한 무효화를 취소해 marginRef 를 살려둔다 (감사 B3 회귀 방지).
        //   floodfill 은 마진을 소비하되 유지하는 원본 워크플로우.
        cancelPendingInvalidation(ctx, sid);
        fillMarginFromFace(ctx, sid, pick.faceId);
      }
    });

    return () => {
      // 스트로크 중 모드 전환 등으로 UP 을 못 받은 경우 대비 — 남은 touched
      //   mesh 를 정리 통지 (통지 누락 방지). 이 flush 가 무효화를 재예약할 수
      //   있으므로 반드시 타이머 정리보다 "먼저" 호출한다.
      flushPaintedNotifications();
      // 예약된 무효화 타이머 처리 — 드롭하지 않는다.
      //   · 모드 전환(마운트 유지): pending 을 clearTimeout 후 즉시 실행
      //     (invalidateDentalResults). 모드 이탈 후엔 더블탭이 불가능하므로 지연할
      //     이유가 없고, 이렇게 해야 "칠→300ms 내 모드 이탈"에서도 그 칠 변경의
      //     무효화가 보장된다(감사 B3). 방금 flush 가 새로 예약한 것도 포함된다.
      //   · 언마운트(씬 dispose 경로): 뒤이어 전체 dispose 가 오므로 invalidate
      //     (setState 유발) 를 부르면 언마운트 중 부모 상태 갱신이 된다. 타이머만
      //     clearTimeout 하고 콜백은 발화하지 않는다 — dispose 가 mesh/ref 를 모두
      //     정리한다. isUnmountingRef 로 두 경우를 구분한다.
      const unmounting = ctx.isUnmountingRef.current;
      // effect 본문에서 캡처해 둔 pendingInvalidations(동일 Map 참조)를 순회.
      for (const [stlId, t] of pendingInvalidations) {
        clearTimeout(t);
        if (!unmounting) invalidateDentalResults(ctx, stlId);
      }
      pendingInvalidations.clear();
      scene.onPointerObservable.remove(obs);
      canvas.style.cursor = "";
      brushRing.dispose(false, true);
      rm.dispose();
      canvas.removeEventListener("wheel", maskWheel, true);
      // 원본은 도구 종료 시 clearMask() 로 색칠을 지웠다. v2 에서는 모드
      // 전환 시 painted(세션 상태)를 유지 — margin/island 조각이 같은 색칠을
      // 재사용할 수 있도록. 명시적 지우기는 clearDentalPaint()(패널 버튼).
    };
    // invalidateDentalResults 는 컴포넌트 본문 함수(매 렌더 재생성)라 deps 에
    // 넣으면 editMode 무변경에도 브러쉬 effect 가 반복 재설정된다. editMode 만 의존.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);
}
