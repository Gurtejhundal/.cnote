#!/usr/bin/env python3
"""Generate the .cnote 256x256 extension icon.

Brand: flat acid-lime tile, black angle brackets, and a black pencil
replacing the slash in the familiar </> coding mark. No glow/gradient.
"""
from __future__ import annotations
import math, struct, zlib
from pathlib import Path

SIZE=256
SCALE=4
W=H=SIZE*SCALE
OUT=Path(__file__).resolve().parents[1]/'media'/'cnote-icon.png'
LIME=(190,255,38)
DARK=(24,25,29)


def clamp(v:float)->float: return max(0.0,min(1.0,v))

def rounded_rect_sdf(x,y,cx,cy,hx,hy,r):
    qx=abs(x-cx)-(hx-r); qy=abs(y-cy)-(hy-r)
    ox=max(qx,0.0); oy=max(qy,0.0)
    return math.hypot(ox,oy)+min(max(qx,qy),0.0)-r

def capsule_distance(x,y,ax,ay,bx,by):
    abx,aby=bx-ax,by-ay; apx,apy=x-ax,y-ay
    den=abx*abx+aby*aby
    t=0.0 if den==0 else clamp((apx*abx+apy*aby)/den)
    px,py=ax+abx*t,ay+aby*t
    return math.hypot(x-px,y-py)

def rotate(x,y,cx,cy,angle):
    s,c=math.sin(angle),math.cos(angle); dx,dy=x-cx,y-cy
    return dx*c+dy*s+cx,-dx*s+dy*c+cy

def aa(d,w=1.0): return clamp(0.5-d/w)

def blend(dst,rgb,a):
    dr,dg,db,da=dst; a=clamp(a)
    if a<=0:return dst
    sr,sg,sb=[v/255 for v in rgb]; oa=a+da*(1-a)
    return ((sr*a+dr*da*(1-a))/oa,(sg*a+dg*da*(1-a))/oa,(sb*a+db*da*(1-a))/oa,oa)

def pixel(px,py):
    x=(px+.5)/SCALE; y=(py+.5)/SCALE
    tile=rounded_rect_sdf(x,y,128,128,114,114,42)
    alpha=aa(tile,1.1)
    if alpha<=0:return (0,0,0,0)
    base=(LIME[0]/255,LIME[1]/255,LIME[2]/255,1.0)

    # Left/right chevrons: thick, rounded, balanced like the supplied mark.
    thick=11.5
    for ax,ay,bx,by in [
        (82,82,48,116),(48,116,82,150),
        (174,82,208,116),(208,116,174,150),
    ]:
        a=aa(capsule_distance(x,y,ax,ay,bx,by)-thick,1.0)
        if a>0: base=blend(base,DARK,a)

    # Pencil replaces the slash. It rises from bottom-left to top-right.
    rx,ry=rotate(x,y,129,116,math.radians(-30))
    body=rounded_rect_sdf(rx,ry,129,116,12.5,37,5.5)
    a=aa(body,1.0)
    if a>0: base=blend(base,DARK,a)

    # Eraser/cap, separated by a lime notch.
    cap=rounded_rect_sdf(rx,ry,129,76,12.5,8,6)
    a=aa(cap,1.0)
    if a>0: base=blend(base,DARK,a)
    separator=rounded_rect_sdf(rx,ry,129,85.5,13,2,1.2)
    a=aa(separator,.9)
    if a>0: base=blend(base,LIME,a)

    # Pencil tip.
    if 151<=ry<=170:
        half=max(0.0,(170-ry)*0.62)
        if abs(rx-129)<=half:
            base=blend(base,DARK,1.0)
    # Small lime cut between body and tip.
    cut=rounded_rect_sdf(rx,ry,129,150,13,2,1)
    a=aa(cut,.9)
    if a>0: base=blend(base,LIME,a)

    r,g,b,a=base
    return round(clamp(r)*255),round(clamp(g)*255),round(clamp(b)*255),round(clamp(a*alpha)*255)

def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)

def write_png(path):
    high=[[pixel(x,y) for x in range(W)] for y in range(H)]
    rows=bytearray(); area=SCALE*SCALE
    for y in range(SIZE):
        rows.append(0)
        for x in range(SIZE):
            sums=[0,0,0,0]
            for sy in range(SCALE):
                for sx in range(SCALE):
                    p=high[y*SCALE+sy][x*SCALE+sx]
                    for i in range(4): sums[i]+=p[i]
            rows.extend(round(v/area) for v in sums)
    sig=b'\x89PNG\r\n\x1a\n'; ihdr=struct.pack('>IIBBBBB',SIZE,SIZE,8,6,0,0,0)
    png=sig+chunk(b'IHDR',ihdr)+chunk(b'IDAT',zlib.compress(bytes(rows),9))+chunk(b'IEND',b'')
    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(png)
    print(f'generated {path} ({len(png)} bytes)')

if __name__=='__main__': write_png(OUT)
