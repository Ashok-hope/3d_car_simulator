import * as T from 'three';
import { boundsFor } from './vehicles.js';
import { clamp, footprint, wrap } from './physics.js';

const up=new T.Vector3(0,1,0);
const forward=new T.Vector3(0,0,1);

export function trafficModels(asset) {
  asset.updateMatrixWorld(true);
  const box=new T.Box3();
  const location=new T.Vector3();
  return [0,-6.59,6.69,-9.9,13.15,-12.64,16.45].map(x=>{
    const group=new T.Group();
    const centerpiece={front:[],back:[],lights:[]};
    asset.traverse(n=>{
      if(!n.isMesh)return;
      box.setFromObject(n).getCenter(location);
      if(Math.abs(location.x-x)>1.27)return;
      const name=n.name.toLowerCase();
      if(/wheelspairf(?!b)/.test(name))centerpiece.front.push(location.z);
      if(/wheelspairb(?!f)/.test(name))centerpiece.back.push(location.z);
      if(/headlight/.test(name)&&Math.abs(location.z)>.5)centerpiece.lights.push(location.z);
      if(/glow/i.test(name))return;
      const part=n.clone(false);
      part.applyMatrix4(n.parent.matrixWorld);
      part.position.x-=x;
      part.material=n.material.clone();
      const glass=/glass/i.test(name);
      part.material.transparent=glass;
      part.material.opacity=glass?.53:1;
      part.material.depthWrite=!glass;
      if(!glass)part.material.alphaTest=0;
      group.add(part);
      if(/wheelspair/.test(name)){
        const axle=new T.Group();
        axle.name='npcAxle';
        box.setFromObject(part).getCenter(axle.position);
        group.add(axle);
        axle.attach(part);
      }
    });
    const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
    const direction=average(centerpiece.front.length?centerpiece.front:centerpiece.lights)-(centerpiece.back.length?average(centerpiece.back):0);
    group.rotation.y=direction>=0?0:Math.PI;
    group.updateMatrixWorld(true);
    box.setFromObject(group);
    const size=box.getSize(new T.Vector3());
    const center=box.getCenter(new T.Vector3());
    group.position.set(-center.x,-box.min.y,-center.z);
    return {model:group,width:clamp(size.x/2,.8,1.45),length:clamp(size.z/2,1.8,3)};
  });
}

export function createTraffic(root,routes,models,groundAt,shadow) {
  const vehicles=[];
  for(const [routeIndex,points] of routes.entries()){
    if(points.length<4)continue;
    const curve=new T.CatmullRomCurve3(points.map(([x,z])=>new T.Vector3(x,0,z)),true,'centripetal');
    curve.arcLengthDivisions=Math.max(720,points.length*14);
    const length=curve.getLength();
    const count=clamp(Math.floor(length/95),2,8);
    for(let i=0;i<count;i++){
      const {model,width,length:halfLength}=models[(i+routeIndex*2)%models.length];
      const object=new T.Group();
      object.rotation.order='YXZ';
      object.add(model.clone());
      const axles=[];
      object.traverse(o=>{if(o.name==='npcAxle')axles.push(o);});
      shadow(object,width*2.7,halfLength*2.25);
      root.add(object);
      const car={root:object,curve,length,s:(i+.67)*length/count,cruise:8.7+(i%3)*1.8,speed:0,width,halfLength,
        axles,wheelDirection:model.rotation.y>.1?-1:1};
      const {x,z,yaw}=sample(car,car.s);
      object.position.set(x,groundAt(x,z)+.019,z);
      object.rotation.y=yaw;
      vehicles.push(car);
    }
  }
  return vehicles;
}

function sample(car,distance) {
  const u=((distance%car.length)+car.length)%car.length/car.length;
  const p=car.curve.getPointAt(u), tangent=car.curve.getTangentAt(u);
  return {x:p.x,z:p.z,yaw:Math.atan2(tangent.x,tangent.z)};
}
function circles(car,x=car.root.position.x,z=car.root.position.z,yaw=car.root.rotation.y) {
  return footprint(x,z,yaw,car.width,car.halfLength);
}
function overlaps(a,b,gap=0) {
  return a.some(([x,z,r])=>b.some(([px,pz,pr])=>(x-px)**2+(z-pz)**2<(r+pr+gap)**2));
}
function barrierFor(car) {
  return {x:car.root.position.x,z:car.root.position.z,y:car.root.position.y,shape:circles(car),owner:car};
}
export function trafficHit(traffic,x,z,r,y) {
  return traffic.some(car=>Math.abs(car.root.position.y-y)<2.5&&overlaps([[x,z,r]],circles(car)));
}

export function simulateTraffic(traffic,dt,fleet,walker,groundAt,wallHit) {
  const barriers=traffic.map(barrierFor);
  for(const car of fleet){
    if(car.parked)continue;
    const {x,y,z}=car.root.position;
    barriers.push({x,y,z,shape:boundsFor(car)});
  }
  if(walker)barriers.push({x:walker.x,z:walker.z,y:walker.y,shape:[[walker.x,walker.z,.58]]});
  for(let index=0;index<traffic.length;index++){
    const car=traffic[index], p=car.root.position;
    const nearby=barriers.filter(b=>b.owner!==car&&Math.abs(b.y-p.y)<3.2&&(b.x-p.x)**2+(b.z-p.z)**2<47**2);
    let gap=Infinity;
    const look=Math.max(11,6+car.speed*1.4+car.speed**2/10);
    if(nearby.length){
      for(let distance=1;distance<=look;distance+=1.45){
        const ahead=sample(car,car.s+distance);
        if(nearby.some(b=>overlaps(circles(car,ahead.x,ahead.z,ahead.yaw),b.shape,.40))){
          gap=distance-1;
          break;
        }
      }
    }
    const bend=sample(car,car.s+Math.max(5,car.speed)).yaw;
    const curveSpeed=car.cruise/(1+Math.abs(wrap(bend-car.root.rotation.y))*1.3);
    const target=Math.min(curveSpeed,Math.sqrt(2*4.5*Math.max(0,gap-1.3)));
    car.speed+=clamp(target-car.speed,-7.8*dt,2.6*dt);
    const nextS=car.s+car.speed*dt;
    const next=sample(car,nextS);
    const shape=circles(car,next.x,next.z,next.yaw);
    if(nearby.some(b=>overlaps(shape,b.shape,.065))||wallHit(next.x,next.z,Math.min(.58,car.width*.5))){
      car.speed=0;
      continue;
    }
    car.s=nextS%car.length;
    p.set(next.x,groundAt(next.x,next.z,p.y)+.019,next.z);
    car.root.rotation.y=next.yaw;
    const front=sample(car,car.s+1.45), back=sample(car,car.s-1.45);
    const slope=groundAt(front.x,front.z,p.y)-groundAt(back.x,back.z,p.y);
    car.root.rotation.x=clamp(-Math.atan2(slope,2.9),-.30,.30);
    for(const axle of car.axles)axle.rotation.x+=car.wheelDirection*car.speed*dt/.33;
    barriers[index]=barrierFor(car);
  }
}
