# 참고용 시뮬레이션 (2026-10-02, Task0 협의 §20·§22 근거) — 저장소 검증 스크립트 아님
# B안 도포 경로(서펜타인 0°, 행 간격 w, 경계 w/2 안쪽)로 도포=노광 커버리지 기준 (a)(c)(d) 를 73µm 래스터에서 시험.
# 실행: python sim-coverage-20261002.py  (numpy 불요). 검증기(verify-task0-*.mjs) 작성 시 대조군 출처.

import math, time
P=0.073  # 픽셀 피치 mm
def run(name, bbox, inside, inside_er, paths, w):
    x0,y0,x1,y1=bbox
    nx=int((x1-x0)/P)+1; ny=int((y1-y0)/P)+1
    cov075=bytearray(nx*ny); covw=bytearray(nx*ny)
    def stamp(buf,R):
        for kind,*a in paths:
            if kind=='row':
                sx0,sx1,sy=a
                j0=max(0,int((sy-R-y0)/P)); j1=min(ny-1,int((sy+R-y0)/P)+1)
                for j in range(j0,j1+1):
                    py=y0+j*P; dy=py-sy
                    if abs(dy)>R: continue
                    ext=math.sqrt(R*R-dy*dy)  # 끝 반원 포함
                    i0=max(0,int(math.ceil((sx0-ext-x0)/P))); i1=min(nx-1,int((sx1+ext-x0)/P))
                    if i1>=i0: buf[j*nx+i0:j*nx+i1+1]=b'\x01'*(i1-i0+1)
            else:  # dot
                cx,cy=a
                j0=max(0,int((cy-R-y0)/P)); j1=min(ny-1,int((cy+R-y0)/P)+1)
                for j in range(j0,j1+1):
                    dy=y0+j*P-cy
                    if abs(dy)>R: continue
                    ext=math.sqrt(R*R-dy*dy)
                    i0=max(0,int(math.ceil((cx-ext-x0)/P))); i1=min(nx-1,int((cx+ext-x0)/P))
                    if i1>=i0: buf[j*nx+i0:j*nx+i1+1]=b'\x01'*(i1-i0+1)
    stamp(cov075,0.75*w); stamp(covw,1.0*w)
    nint=0; ok=0; unc_a=set(); unc_d=set(); nall=0
    for j in range(ny):
        py=y0+j*P; row=j*nx
        for i in range(nx):
            px=x0+i*P
            if not inside(px,py): continue
            nall+=1
            k=row+i
            if not covw[k]: unc_d.add(k)
            if inside_er(px,py):
                nint+=1
                if cov075[k]: ok+=1
                else: unc_a.add(k)
    def maxcomp(s):
        best=0; seen=set()
        for k in s:
            if k in seen: continue
            st=[k]; seen.add(k); n=0
            while st:
                c=st.pop(); n+=1; ci=c%nx; cj=c//nx
                for d in ((1,0),(-1,0),(0,1),(0,-1)):
                    ii,jj=ci+d[0],cj+d[1]
                    if 0<=ii<nx and 0<=jj<ny:
                        q=jj*nx+ii
                        if q in s and q not in seen: seen.add(q); st.append(q)
            best=max(best,n)
        return best*P*P
    a=(ok/nint*100) if nint else float('nan')
    c=maxcomp(unc_a); d=maxcomp(unc_d)
    W2=w*w
    print(f"{name:34s} (a){a:7.3f}% {'통과' if (nint==0 or a>=99.9) else 'FAIL'} | (c)최대구멍 {c:6.2f}mm² {'통과' if c<W2 else 'FAIL'} | (d)전체·w 최대 {d:6.2f}mm² {'통과' if d<W2 else 'FAIL'}")

def rows_rect(xa,xb,ya,yb,w,hole=None,phase=0.0):
    out=[]; ya2=ya+w/2; yb2=yb-w/2; xa2=xa+w/2; xb2=xb-w/2
    k=math.ceil((ya2-phase)/w)
    while phase+k*w<=yb2+1e-9:
        y=phase+k*w
        if hole and hole[2]<=y<=hole[3]:
            if xa2<hole[0]: out.append(('row',xa2,hole[0],y))
            if xb2>hole[1]: out.append(('row',hole[1],xb2,y))
        else: out.append(('row',xa2,xb2,y))
        k+=1
    return out
def rows_circle(R,w,phase=0.0):
    r=R-w/2; out=[]
    if r<=0: return out
    k=math.ceil((-r-phase)/w)
    while phase+k*w<=r:
        y=phase+k*w; h=math.sqrt(max(0,r*r-y*y)); out.append(('row',-h,h,y)); k+=1
    return out

for w in (0.5,1.0):
    print(f"\n===== 도포폭 w = {w} mm  (w² = {w*w:.2f} mm²) =====")
    t=time.time()
    rect=lambda x,y: 10<=x<=150 and 10<=y<=85
    rect_er=lambda x,y: 10+w/2<=x<=150-w/2 and 10+w/2<=y<=85-w/2
    hole=(78.5,81.5,46,49)  # 가운데 3x3mm even-odd 구멍 (행 제거)
    run("1 전면층 140x75, 정상", (9.5,9.5,150.5,85.5), rect, rect_er, rows_rect(10,150,10,85,w), w)
    run("2 전면층 + 3x3 구멍(Task0 대조군)", (9.5,9.5,150.5,85.5), rect, rect_er, rows_rect(10,150,10,85,w,hole=hole), w)
    for R in (1,10):
        circ=lambda x,y,R=R: x*x+y*y<=R*R; ce=lambda x,y,R=R: x*x+y*y<=(R-w/2)**2
        run(f"3 원 반경 {R}mm, 정상", (-R-1,-R-1,R+1,R+1), circ, ce, rows_circle(R,w), w)
    # 얇은 띠(행 방향과 평행), 폭 1.2w, 길이 20mm. 전역 행 위상이 나쁘면 띠 안에 행이 없음
    hw=1.2*w
    strip=lambda x,y: 0<=x<=20 and 0<=y<=hw
    strip_er=lambda x,y: w/2<=x<=20-w/2 and w/2<=y<=hw-w/2
    run("4 얇은 띠 폭1.2w, 전역 행(빗나감)", (-1,-1,21,hw+1), strip, strip_er, [('dot',10,hw/2)], w)
    run("5 얇은 띠 폭1.2w, 중심선 1줄", (-1,-1,21,hw+1), strip, strip_er, [('row',w/2,20-w/2,hw/2)], w)
    # 크라운 마진 같은 얇은 링: 반경 10, 폭 0.6w (<w → 침식 영역 없음)
    rw=0.6*w; Ro=10; Ri=Ro-rw
    ring=lambda x,y: Ri*Ri<=x*x+y*y<=Ro*Ro
    ring_er=lambda x,y: False
    run("6 얇은 링 폭0.6w, 점 1개만", (-11,-11,11,11), ring, ring_er, [('dot',Ro-rw/2,0)], w)
    rm=Ro-rw/2; segs=[]
    n=int(2*math.pi*rm/(P*2))
    pts=[(rm*math.cos(2*math.pi*i/n), rm*math.sin(2*math.pi*i/n)) for i in range(n)]
    run("7 얇은 링 폭0.6w, 중심선 따라 도포", (-11,-11,11,11), ring, ring_er, [('dot',x,y) for x,y in pts], w)
    print(f"  ({time.time()-t:.0f}s)")
