import * as T from 'three';
import { box } from './world.js';

export const alpsScale=.003;
export const tokyoOffset=new T.Vector3(-47,-26.4,862);
export const garageY=-.36;
export const garagePoint=new T.Vector3(-28,garageY,214);
export const startingPoint=new T.Vector3(-25,-.327,238);
export const startingYaw=.77;
export const garageWalls=[];
const cells=new Map();
const cellSize=12;
const layers={alps:[],tokyo:[]};
const p3=(x,y,z)=>new T.Vector3(x,y,z);
const asphalt=new T.MeshStandardMaterial({color:0x40464a,roughness:.98,side:T.DoubleSide});
const shoulder=new T.MeshStandardMaterial({color:0x909597,roughness:.93,side:T.DoubleSide});
const concrete=new T.MeshStandardMaterial({color:0x666b6e,roughness:.88});
const stripe=new T.MeshStandardMaterial({color:0xdba953,roughness:.91});
const rail=new T.MeshStandardMaterial({color:0x808e94,roughness:.6,metalness:.22});
const roadLines=[];
export const overview=[];

function lookup(x,z){return Math.floor(x/cellSize)+':'+Math.floor(z/cellSize);}
function addTriangle(a,b,c,role){
  const x1=a.x, z1=a.z, x2=b.x,z2=b.z,x3=c.x,z3=c.z;
  const denom=(z2-z3)*(x1-x3)+(x3-x2)*(z1-z3);
  if(Math.abs(denom)<.005)return;
  const tri=[x1,z1,a.y,x2,z2,b.y,x3,z3,c.y,1/denom,role];
  const iMin=Math.floor(Math.min(x1,x2,x3)/cellSize),iMax=Math.floor(Math.max(x1,x2,x3)/cellSize);
  const jMin=Math.floor(Math.min(z1,z2,z3)/cellSize),jMax=Math.floor(Math.max(z1,z2,z3)/cellSize);
  for(let i=iMin;i<=iMax;i++)for(let j=jMin;j<=jMax;j++){
    const key=i+':'+j;
    let list=cells.get(key);
    if(!list){ list=[];cells.set(key,list); }
    list.push(tri);
  }
}
function surfaceHeight(x,z,y,walk=true) {
  const candidates=cells.get(lookup(x,z));
  let best=NaN, distance=Infinity;
  if(!candidates)return best;
  for(const [x1,z1,y1,x2,z2,y2,x3,z3,y3,inv,role] of candidates){
    if(!walk&&role==='walk')continue;
    const a=((z2-z3)*(x-x3)+(x3-x2)*(z-z3))*inv;
    const b=((z3-z1)*(x-x3)+(x1-x3)*(z-z3))*inv;
    if(a<-.0001||b<-.0001||a+b>1.0001)continue;
    const h=a*y1+b*y2+(1-a-b)*y3;
    const d=Number.isFinite(y)?Math.abs(h-y):-h;
    if(d<distance){best=h;distance=d;}
  }
  return best;
}
export function groundAt(x,z,y){
  const floor=surfaceHeight(x,z,y);
  return Number.isFinite(floor)?floor:(Number.isFinite(y)?y-.025:0);
}
export function canDrive(x,z,y){
  const floor=surfaceHeight(x,z,y);
  return Number.isFinite(floor)&&(!Number.isFinite(y)||Math.abs(y-floor)<3.2);
}
function hitsGarage(x,z,r) {
  return garageWalls.some(([a,b,c,d])=>(x-Math.max(a,Math.min(x,b)))**2+(z-Math.max(c,Math.min(z,d)))**2<r*r);
}
export function wallHit(x,z,r,y) {
  if(hitsGarage(x,z,r))return true;
  if(canDrive(x,z,y))return false;
  const threshold=Math.min(.2,r*.26);
  return ![[threshold,0],[-threshold,0],[0,threshold],[0,-threshold]].some(([dx,dz])=>canDrive(x+dx,z+dz,y));
}
export function cameraWallHit(x,z,r){
  return hitsGarage(x,z,r);
}
export function inGarage(p){
  return Math.abs(p.x-garagePoint.x)<9.8&&p.z>garagePoint.z-8.1&&p.z<garagePoint.z+11.4;
}
export function districtName(p) {
  if(inGarage(p))return 'MOTOR CLUB GARAGE';
  if(p.z>=432)return 'TOKYO';
  if(p.z>362)return 'TOKYO CONNECTOR';
  return 'CHAMONIX ALPS';
}
function materialRole(name,mat){
  const n=name.toLowerCase(),m=mat.toLowerCase();
  if(/customspline|center_route|traffic_|vertex_hide|sun_sun|godr/.test(n+' '+m))return 'nav';
  if(/pavement|sidewalk/.test(m))return 'walk';
  if(n.startsWith('part1_road_group2'))return 'road';
  if(/road/.test(n)&&!/arrow/.test(n)&&/asphalt|insb_road|wood|road|short|atlas|pave/.test(m))return 'road';
  if(['road1','road3','roadsp'].includes(m))return 'road';
  return '';
}
export function installRegion(asset,key,data){
  asset.scale.setScalar(alpsScale);
  if(key==='tokyo')asset.position.copy(tokyoOffset);
  asset.updateMatrixWorld(true);
  const v=p3(),a=p3(),b=p3(),c=p3();
  asset.traverse(n=>{
    if(!n.isMesh)return;
    const m=n.material,role=materialRole(n.name,m.name);
    if(role==='nav'){n.visible=false;return;}
    if(!role&&/atlas.*alpha|^alpha/i.test(m.name)){
      m.alphaTest=.42;m.depthWrite=true;m.transparent=false;
    } else if(!/water|glass/i.test(m.name)) {
      m.transparent=false;m.opacity=1;m.depthWrite=true;
    }
    if(m.map)m.map.anisotropy=4;
    if(!role)return;
    const pos=n.geometry.attributes.position,idx=n.geometry.index;
    for(let i=0;i<(idx?.count??pos.count);i+=3){
      a.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(n.matrixWorld);
      b.fromBufferAttribute(pos,idx?idx.getX(i+1):i+1).applyMatrix4(n.matrixWorld);
      c.fromBufferAttribute(pos,idx?idx.getX(i+2):i+2).applyMatrix4(n.matrixWorld);
      addTriangle(a,b,c,role);
    }
  });
  layers[key]=data[key].map(([x,z])=>[x*alpsScale+asset.position.x,z*alpsScale+asset.position.z]);
  overview.push(layers[key]);
  return asset;
}
function surfaceStrip(group,curve,width,material,record,offset=0){
  const steps=Math.ceil(curve.getLength()/1.75);
  const vertices=[],indices=[],uv=[];
  const points=[];
  for(let i=0;i<=steps;i++){
    const p=curve.getPointAt(i/steps),t=curve.getTangentAt(i/steps);
    const n=p3(t.z,0,-t.x).normalize();
    const l=p.clone().addScaledVector(n,width/2+offset),r=p.clone().addScaledVector(n,-width/2+offset);
    vertices.push(...l.toArray(),...r.toArray());
    uv.push(0,i/2,1,i/2);
    if(i){
      const k=(i-1)*2;
      indices.push(k,k+2,k+1,k+2,k+3,k+1);
      if(record){
        addTriangle(points.at(-1)[0],l,points.at(-1)[1],'road');
        addTriangle(l,r,points.at(-1)[1],'road');
      }
    }
    points.push([l,r]);
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new T.Mesh(geo,material);group.add(mesh);
}
function road(group,points,width,mark=true,bridge=false){
  const curve=new T.CatmullRomCurve3(points.map(p=>p3(...p)),false,'centripetal');
  surfaceStrip(group,curve,width+1.45,shoulder,true);
  const up=new T.CatmullRomCurve3(points.map(([x,y,z])=>p3(x,y+.012,z)),false,'centripetal');
  surfaceStrip(group,up,width,asphalt,true);
  if(mark){
    for(let i=3;i<curve.getLength()-2;i+=7){
      const progress=i/curve.getLength();
      const p=curve.getPointAt(progress),t=curve.getTangentAt(progress);
      const m=box(group,.105,.028,2.9,p.x,p.y+.035,p.z,stripe);
      m.rotation.y=Math.atan2(t.x,t.z);
    }
  }
  if(bridge){
    for(const side of [-1,1]){
      const top=new T.CatmullRomCurve3(points.map(([x,y,z])=>p3(x,y+.7,z)),false,'centripetal');
      surfaceStrip(group,top,.21,rail,false,side*(width/2+.5));
    }
    const length=curve.getLength();
    for(let i=4;i<length-3;i+=5){
      const u=i/length,p=curve.getPointAt(u),t=curve.getTangentAt(u),n=p3(t.z,0,-t.x).normalize();
      for(const side of [-1,1]){
        const q=p.clone().addScaledVector(n,side*(width/2+.5));
        box(group,.13,.87,.13,q.x,q.y+.39,q.z,rail);
      }
      if(i%20===4)box(group,1.15,5.6,1.55,p.x,p.y-2.8,p.z,concrete);
    }
  }
  overview.push(points.map(([x,,z])=>[x,z]));
  return curve;
}
function pad(group,x,z,w,l,h,mat,role='road'){
  box(group,w,.2,l,x,h-.1,z,mat);
  const a=p3(x-w/2,h,z-l/2), b=p3(x+w/2,h,z-l/2),c=p3(x-w/2,h,z+l/2),d=p3(x+w/2,h,z+l/2);
  addTriangle(a,b,c,role);addTriangle(c,b,d,role);
}
function sign(group,text,x,y,z,yaw=0){
  const cv=document.createElement('canvas');cv.width=1024;cv.height=260;
  const ctx=cv.getContext('2d');ctx.fillStyle='#153a35';ctx.fillRect(0,0,1024,260);
  ctx.strokeStyle='#c7ded2';ctx.lineWidth=11;ctx.strokeRect(16,16,992,228);ctx.fillStyle='#edf3de';
  ctx.font='bold 120px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,130);
  const map=new T.CanvasTexture(cv);map.colorSpace=T.SRGBColorSpace;
  const panel=new T.Mesh(new T.PlaneGeometry(7,1.78),new T.MeshBasicMaterial({map,side:T.DoubleSide}));
  panel.position.set(x,y+3.15,z);panel.rotation.y=yaw;
  group.add(panel);
  box(group,.17,2.6,.18,x,y+1.3,z,rail);
}
export function buildConnections(group){
  pad(group,-28,216,23,34,garageY,concrete);
  const drive=[[-28,garageY,224],[-28,garageY,233],[-25,-.365,238],[-18,-.39,243],[-10,-.40,247],[-1,-.35,250],[5,-.275,251]];
  road(group,drive,7,false);
  pad(group,-34,231,2.85,14,garageY+.065,shoulder,'walk');
  pad(group,-34.9,237,4.6,2.1,garageY+.065,shoulder,'walk');
  sign(group,'GARAGE',-39,garageY,234);
  const corridor=[[49.5,-.35,349],[43.5,-.34,358.5],[37.5,-.32,369],[29,-.31,378],
    [13,-.29,387],[-5,-.27,394],[-25,-.19,402],[-32,-.16,411],[-24,-.18,421],
    [-14,-.27,430],[-6,-.30,438],[1,-.34,445]];
  road(group,corridor,8.2,true,true);
  sign(group,'TOKYO  ↗',51.5,-.35,351,.55);
  sign(group,'CHAMONIX  ↗',-7,-.29,431,-.8);
}
function offsetLoop(points,width,reversed) {
  const path=points.map((point,i)=>{
    const a=points[(i-1+points.length)%points.length],b=points[(i+1)%points.length];
    const x=b[0]-a[0],z=b[1]-a[1],d=Math.hypot(x,z)||1;
    const replica=[point[0]+z/d*width,point[1]-x/d*width];
    return canDrive(replica[0],replica[1])?replica:point;
  });
  const ordered=reversed?path.reverse():path;
  const guide=new T.CatmullRomCurve3(ordered.map(([x,z])=>p3(x,0,z)),true,'centripetal');
  guide.arcLengthDivisions=2400;
  const steps=Math.ceil(guide.getLength()/2.45);
  const fitted=[];
  for(let i=0;i<steps;i++){
    const u=i/steps,p=guide.getPointAt(u),d=guide.getTangentAt(u);
    let chosen=[p.x,p.z];
    for(const offset of [0,.72,-.72,1.45,-1.45,2.25,-2.25,3.15,-3.15,4.1,-4.1,5,-5]){
      const x=p.x+d.z*offset,z=p.z-d.x*offset;
      if(!canDrive(x,z)||!canDrive(x+d.z*.34,z-d.x*.34)||!canDrive(x-d.z*.34,z+d.x*.34))continue;
      chosen=[x,z];
      break;
    }
    fitted.push(chosen);
  }
  return fitted;
}
export function laneRoutes(){
  return [[layers.alps,1.75,false],[layers.alps,-1.75,true],
          [layers.tokyo,1.75,false],[layers.tokyo,-1.75,true]].map(item=>offsetLoop(...item));
}
