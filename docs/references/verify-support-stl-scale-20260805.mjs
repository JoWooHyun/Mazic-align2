// B안 검증 2단계: X폭이 전부 1.0으로 나온 원인 규명 + 부품별 실제 단면폭 확인
import fs from "node:fs";
import path from "node:path";
const STL_DIR = "c:/Users/JoWooHyun/Documents/MazicAlign/stl모음";

function parseStl(buf) {
  const head = buf.subarray(0, 5).toString("ascii");
  const looksAscii = head === "solid" && buf.subarray(0, 300).toString("ascii").includes("facet");
  if (looksAscii) {
    const verts = []; const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g; let m;
    while ((m = re.exec(buf.toString("ascii")))) verts.push(+m[1], +m[2], +m[3]);
    return new Float32Array(verts);
  }
  const n = buf.readUInt32LE(80); const out = new Float32Array(n * 9); let o = 0, p = 84;
  for (let i = 0; i < n; i++) { p += 12; for (let v = 0; v < 3; v++) { out[o++] = buf.readFloatLE(p); out[o++] = buf.readFloatLE(p + 4); out[o++] = buf.readFloatLE(p + 8); p += 12; } p += 2; }
  return out;
}
const load = (name) => parseStl(fs.readFileSync(path.join(STL_DIR, name)));
function bboxRaw(tris) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], tris[i + k]); mx[k] = Math.max(mx[k], tris[i + k]); }
  return { mn, mx };
}

console.log("=== 원인 규명: 각 부품의 원본 형상(정규화 전) ===\n");
for (const f of ["SUPPORT_TOP_Cone.stl", "SUPPORT_Cylinder.stl", "SUPPORT_BOTTOM_Cone.stl", "SUPPORT_sphere.stl"]) {
  const b = bboxRaw(load(f));
  console.log(`${f.padEnd(26)} dims X=${(b.mx[0]-b.mn[0]).toFixed(3)} Y=${(b.mx[1]-b.mn[1]).toFixed(3)} Z=${(b.mx[2]-b.mn[2]).toFixed(3)}`);
}

console.log(`
[해석]
- 부품들은 X·Y가 모두 ~1.0 단위(sphere만 40). 즉 "가로세로 1mm 단위 부품".
- TOP_Cone: 밑면 ⌀1.0 → 위로 갈수록 좁아지는 원뿔. Cylinder: ⌀1.0 원기둥. BOTTOM_Cone: ⌀1.0 원뿔.
- 스케일 [0.4,0.4,·] 를 주면 그 부품 전체가 ⌀0.4가 되고, [2,2,·]면 ⌀2가 된다.

=> 앞 프로토타입에서 X폭이 다 1.0이던 이유: 세 부품을 각각 다른 Z구간에 놓았지만
   내가 대표층으로 고른 Y높이가 우연히 "겹치는 경계"였거나, cone이라 그 높이 단면이
   마침 밑면(⌀1.0 * scale) 근처였을 수 있다. 스케일이 실제로 먹는지 부품별로 단독 슬라이스해 확인한다.
`);

// 부품 단독 슬라이스: cone을 scale 0.4로 주면 단면이 정말 0.4 이하로 나오나?
const EPS = 1e-6;
function sliceTrianglesAtY(triangles, y) {
  const out = [];
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    const d0 = triangles[t+1]-y, d1 = triangles[t+4]-y, d2 = triangles[t+7]-y;
    if (d0>EPS&&d1>EPS&&d2>EPS) continue; if (d0<-EPS&&d1<-EPS&&d2<-EPS) continue;
    if (Math.abs(d0)<EPS&&Math.abs(d1)<EPS&&Math.abs(d2)<EPS) continue;
    const cross=[]; const te=(ax,az,bx,bz,da,db)=>{ if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){const tt=da/(da-db);cross.push([ax+tt*(bx-ax),az+tt*(bz-az)]);}else if(Math.abs(da)<EPS)cross.push([ax,az]); };
    te(triangles[t],triangles[t+2],triangles[t+3],triangles[t+5],d0,d1);
    te(triangles[t+3],triangles[t+5],triangles[t+6],triangles[t+8],d1,d2);
    te(triangles[t+6],triangles[t+8],triangles[t],triangles[t+2],d2,d0);
    if(cross.length>=2)out.push({a:cross[0],b:cross[1]});
  }
  return out;
}
function bakeYup(tris){const o=new Float32Array(tris.length);for(let i=0;i<tris.length;i+=3){o[i]=tris[i];o[i+1]=tris[i+2];o[i+2]=-tris[i+1];}return o;}
function placePart(tris,{scale=[1,1,1],translate=[0,0,0]}={}){
  let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity;
  for(let i=0;i<tris.length;i+=3){mnx=Math.min(mnx,tris[i]);mxx=Math.max(mxx,tris[i]);mny=Math.min(mny,tris[i+1]);mxy=Math.max(mxy,tris[i+1]);mnz=Math.min(mnz,tris[i+2]);}
  const cx=(mnx+mxx)/2,cy=(mny+mxy)/2,cz=mnz;const o=new Float32Array(tris.length);
  for(let i=0;i<tris.length;i+=3){o[i]=(tris[i]-cx)*scale[0]+translate[0];o[i+1]=(tris[i+1]-cy)*scale[1]+translate[1];o[i+2]=(tris[i+2]-cz)*scale[2]+translate[2];}
  return o;
}
function widthAt(tris,y){const s=sliceTrianglesAtY(tris,y);let mn=Infinity,mx=-Infinity,mnz=Infinity,mxz=-Infinity;for(const g of s)for(const p of[g.a,g.b]){mn=Math.min(mn,p[0]);mx=Math.max(mx,p[0]);mnz=Math.min(mnz,p[1]);mxz=Math.max(mxz,p[1]);}return{segs:s.length,wx:s.length?(mx-mn):0,wz:s.length?(mxz-mnz):0};}

// 원기둥 ⌀0.4로 스케일 → 단면이 0.4여야
const cyl04 = bakeYup(placePart(load("SUPPORT_Cylinder.stl"), { scale: [0.4, 0.4, 3.0], translate: [0,0,0] }));
const cyl10 = bakeYup(placePart(load("SUPPORT_Cylinder.stl"), { scale: [1.0, 1.0, 3.0], translate: [0,0,0] }));
const cyl20 = bakeYup(placePart(load("SUPPORT_Cylinder.stl"), { scale: [2.0, 2.0, 3.0], translate: [0,0,0] }));
console.log("[스케일이 실제 단면에 반영되는지] 원기둥을 Y=1.5(중간)에서 슬라이스:");
for (const [lbl, m] of [["⌀0.4", cyl04], ["⌀1.0", cyl10], ["⌀2.0", cyl20]]) {
  const w = widthAt(m, 1.5);
  console.log(`   목표 ${lbl} → 단면 X폭 ${w.wx.toFixed(3)} Z폭 ${w.wz.toFixed(3)} (선분 ${w.segs})  ${Math.abs(w.wx - +lbl.slice(1)) < 0.05 ? "✔ 일치" : "✘"}`);
}

// TOP_Cone을 ⌀0.4로: 높이별로 위로 갈수록 좁아지는지
console.log("\n[원뿔 접점이 위로 갈수록 좁아지는지] TOP_Cone scale[0.4,0.4,1.0], 높이별 X폭:");
const cone = bakeYup(placePart(load("SUPPORT_TOP_Cone.stl"), { scale: [0.4, 0.4, 1.0], translate: [0,0,0] }));
const cb = bboxRaw(cone);
for (const frac of [0.1, 0.5, 0.9]) {
  const y = cb.mn[1] + frac * (cb.mx[1] - cb.mn[1]);
  const w = widthAt(cone, y);
  console.log(`   높이 ${(frac*100).toFixed(0)}% (Y=${y.toFixed(2)}) → X폭 ${w.wx.toFixed(3)}`);
}
