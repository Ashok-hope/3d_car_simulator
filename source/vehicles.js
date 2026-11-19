import * as T from 'three';
import parts from './parts.json';
import { footprint, damp } from './physics.js';
import { bayPositions } from './world.js';
import { garagePoint } from './region.js';

const entries = [
  ['ferrari','Ferrari F8 Tributo','Mid-engine supercar',1,1,1.06,2.31,2.65,7.9,57,.52,0xff4a38],
  ['bugatti','Bugatti Divo','Track-focused hypercar',1,1,1.04,2.36,2.71,9.3,65,.48,0x527d98],
  ['mclaren','McLaren Ultimate Vision GT','Central-seat concept',1,.83,1.11,2.46,2.99,8.8,61,.49,0xf09c51],
  ['vision','Vision 1789','Prototype hypercar',1,1,1.07,2.46,2.85,8.5,61,.54,0xb2b2bd],
  ['hummer','Hummer HX','Off-road SUV',-1,1,1,2.26,2.64,5.3,37,.58,0xa9a76d],
  ['yamaha','Yamaha MT-09 SP','Motorcycle',-1,1,.34,1.08,1.46,8.9,50,.61,0x4a79c8],
  ['quad','Quad Bike','All-terrain quad',1,.49,.65,1.25,1.74,5.5,27,.67,0x9f5742],
];
export const specs = entries.map(([key,name,category,direction,scale,halfWidth,halfLength,wheelbase,power,max,lock,tint],index) => ({
  key,name,category,direction,scale,halfWidth,halfLength,wheelbase,power,max,lock,tint,index,
  bike:index>=5, motorcycle:index===5,
  brake:index===4?10.5:13,
  radius:[.35,.35,.39,.36,.44,.31,.35][index],
  seat:[[.36,.27,-.26],[.33,.24,-.38],[0,.23,-.16],[.30,.24,-.29],[.39,.66,-.28],[0,.81,-.27],[0,1.07,-.17]][index],
  eye:[[.36,1.04,.15],[.33,1.07,.14],[0,1.03,.36],[.30,.91,.19],[.39,1.43,.21],[0,1.57,-.03],[0,1.59,.08]][index],
  entrySide:1
}));
const clean = name => T.PropertyBinding.sanitizeNodeName(name).toLowerCase();
const center = bounds => new T.Vector3(...bounds[0]).lerp(new T.Vector3(...bounds[1]),.5);
const yOffsets = {quad:1.70,yamaha:.506,hummer:.019,mclaren:.015};
function pivotAt(parent, point) {
  const group = new T.Group();
  group.position.copy(point);
  parent.add(group);
  group.updateWorldMatrix(true,false);
  return group;
}
function paintMaterials(model,spec) {
  model.traverse(node=>{
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material) ? node.material.map(m=>m.clone()) : node.material.clone();
    for (const material of [].concat(node.material)) {
      const name=node.name.toLowerCase(), label=material.name.toLowerCase();
      if (['ferrari','bugatti','vision','hummer','quad'].includes(spec.key) && !/glow/i.test(name)) {
        // The source FBX atlases use alpha for material masks. They are opaque body parts.
        material.transparent=false;
        material.opacity=1;
        material.alphaTest=0;
        material.depthWrite=true;
      }
      if (/carpaint|exterior/.test(name) && !/wheel/.test(name) && spec.index!==2) {
        if (!material.map) material.color.set(spec.tint);
        else material.color.set(spec.key==='ferrari'?0xe84b39:spec.tint);
        material.roughness = .36;
        material.metalness = .36;
        material.envMapIntensity = .85;
      }
      if ((/glass.*windows|glasses_glass$/.test(name) || label==='glass') && !/border/.test(name)) {
        material.transparent = true;
        material.opacity = .32;
        material.depthWrite = false;
        material.color.set(0x809ea1);
      }
      if (/glows/i.test(name)) {
        material.alphaTest=.48;
        material.transparent=false;
        material.depthWrite=true;
        if(/position_front_and_back/i.test(name)) node.visible=false;
      }
      if (spec.key==='yamaha') {
        // This model's neutral color textures carry shading details and use paint slots for color.
        if (/tyre|tire/.test(label)) {
          material.color.set(0x222528);
          material.roughness=.91;
        } else if (/^(blue|rim)$/.test(label)) {
          material.color.set(0x294f9e);
          material.roughness=.38;
          material.metalness=.42;
        } else if (/black|primary|secondary/.test(label)) {
          material.color.set(/primary/.test(label)?0x364150:0x212528);
          material.roughness=.51;
        } else if (/^gold/.test(label)) {
          material.color.set(0x997e44);
          material.metalness=.55;
        }
      }
    }
  });
}

function partitionWheelMeshes(body, find, setup) {
  const base = find('Object_15');
  if (!base?.isMesh || !base.geometry.index) return;
  for (const name of ['Object_15','Object_29','Object_30','Object_36','Object_37','Object_38','Object_39','Object_41','Object_55']) {
    const node=find(name);
    if (!node?.isMesh || !node.geometry.index) continue;
    const positions=node.geometry.attributes.position;
    const index=node.geometry.index.array;
    const sections=[[],[],[],[],[]];
    const vertex=new T.Vector3(), avg=new T.Vector3();
    node.updateWorldMatrix(true,false);
    for (let i=0;i<index.length;i+=3) {
      avg.set(0,0,0);
      for(let j=0;j<3;j++) avg.add(vertex.fromBufferAttribute(positions,index[i+j]).applyMatrix4(node.matrixWorld));
      avg.multiplyScalar(1/3);
      const which=Math.abs(avg.x)<.72 ? 4 : (avg.x>0?0:1)+(avg.z>0?0:2);
      sections[which].push(index[i],index[i+1],index[i+2]);
    }
    const geometry=node.geometry;
    for (let i=0;i<5;i++) {
      if (!sections[i].length) continue;
      const copy=node.clone(false);
      copy.geometry=new T.BufferGeometry();
      for (const key in geometry.attributes) copy.geometry.setAttribute(key,geometry.attributes[key]);
      copy.geometry.setIndex(sections[i]);
      node.parent.add(copy);
      if (i<4) setup(i,copy);
    }
    node.visible=false;
  }
}

export function makeVehicle(asset,spec) {
  const root = new T.Group();
  const suspension = new T.Group();
  const body = new T.Group();
  body.add(asset);
  paintMaterials(asset,spec);
  const nodes = new Map();
  asset.traverse(node => {if (node.isMesh) nodes.set(clean(node.name),node);});
  const find = name => nodes.get(clean(name));
  const info=parts[spec.key];
  const wheels=[];
  const mount=(point,front)=>{
    const yaw=pivotAt(body,point);
    const roll=pivotAt(yaw,new T.Vector3());
    const item={yaw,roll,front};
    wheels.push(item);
    return item;
  };
  const steerParts=[];
  if (spec.key==='mclaren') {
    const shapes=[[1.06,.39,1.45],[-1.06,.39,1.45],[1.10,.47,-2.08],[-1.10,.47,-2.08]].map((p,i)=>mount(new T.Vector3(...p),i<2));
    partitionWheelMeshes(body,find,(i,node)=>shapes[i].roll.attach(node));
    const steering = ['Object_5','Object_10','Object_11','Object_12','Object_51','Object_52'].map(find).filter(Boolean);
    if(steering.length){
      const pivot=pivotAt(body,new T.Vector3(0,.76,.96));
      for(const part of steering) pivot.attach(part);
      steerParts.push([pivot,'z']);
    }
  } else if (spec.key==='yamaha') {
    const front=mount(new T.Vector3(0,-.20,-.887),true);
    const rear=mount(new T.Vector3(0,-.185,.59),false);
    for (const name of Object.keys(info)) {
      const node=find(name);
      if (!node) continue;
      if (/^wheel_lf.child/i.test(name)) front.roll.attach(node);
      if (/^wheel_lr.child/i.test(name)) rear.roll.attach(node);
    }
    const bars=pivotAt(body,new T.Vector3(0,.35,-.62));
    for(const name of Object.keys(info)) {
      const node=find(name);
      if (node && /^(forks|handlebars)/.test(name)) bars.attach(node);
    }
    steerParts.push([bars,'y']);
    asset.traverse(node=>{if(/placeholder|^icosphere$/i.test(node.name)) node.visible=false;});
  } else if (spec.key==='quad') {
    for (const name of ['Wheel','Wheel2','Wheel3','Wheel4']) {
      const p=center(info[name].b);
      const wheel=mount(p,p.z>0);
      const node=find(name);
      if (node) wheel.roll.attach(node);
    }
    const bar=pivotAt(body,new T.Vector3(0,.47,.88));
    if(find('Handle')) bar.attach(find('Handle'));
    steerParts.push([bar,'y']);
  } else {
    for (const code of ['FL','FR','BL','BR']) {
      const prefix='wheel'+code.toLowerCase();
      const names=Object.keys(info).filter(n=>n.toLowerCase().startsWith(prefix));
      const tyre=names.find(n=>/tyre|tire/i.test(n));
      if (!tyre) continue;
      const wheel=mount(center(info[tyre].b),code[0]==='F');
      for(const name of names) if(find(name)) wheel.roll.attach(find(name));
      for(const name of Object.keys(info).filter(n=>new RegExp('caliper_'+code,'i').test(n))) if(find(name)) wheel.yaw.attach(find(name));
    }
  }
  let door;
  const doorNames=Object.keys(info).filter(n=>/detach_door_L/i.test(n));
  if (doorNames.length) {
    const lead=info[doorNames.find(n=>/paint$|exterior$/i.test(n))??doorNames[0]].b;
    const p=center(lead);
    p.z=spec.direction>0?lead[1][2]-.14:lead[0][2]+.14;
    door=pivotAt(body,p);
    for(const name of doorNames) if(find(name)) door.attach(find(name));
  }
  const glows=[];
  asset.traverse(node=>{
    if(!node.isMesh) return;
    if(/brake|reverse|position_back/i.test(node.name) && /glow/i.test(node.name)) {
      const material=node.material;
      if(material?.color && !Array.isArray(material)) {
        material.emissive?.set(/reverse/i.test(node.name)?0xfff5dc:0xff1607);
        glows.push([material,/reverse/i.test(node.name)]);
      }
    }
  });
  body.position.y=(yOffsets[spec.key]??0)*spec.scale;
  body.scale.setScalar(spec.scale);
  body.rotation.y=spec.direction>0?0:Math.PI;
  suspension.add(body);
  root.add(suspension);
  const hitR=spec.halfWidth;
  const car={root,suspension,body,door,glows,wheels,steerParts,spec,speed:0,slide:0,steer:0,spin:0,lean:0,pitch:0,dip:0,doorAmount:0,parked:true, hitR};
  park(car);
  return car;
}

export function park(car) {
  const [x,z]=bayPositions[car.spec.index];
  car.root.position.set(garagePoint.x+x,garagePoint.y+.025,garagePoint.z+z);
  car.root.rotation.y=x<0?Math.PI/2:-Math.PI/2;
  Object.assign(car,{speed:0,slide:0,steer:0,lean:0,pitch:0,grade:0,doorAmount:0,parked:true});
}

export function animateCar(car,dt,braking=false) {
  const steer=car.steer*car.spec.direction;
  car.suspension.rotation.x=car.pitch+(car.grade??0);
  car.suspension.rotation.z=car.spec.key==='yamaha'?car.lean:car.lean*.33;
  for(const wheel of car.wheels) {
    wheel.yaw.rotation.y=wheel.front?steer:0;
    wheel.roll.rotation.x=car.spin*car.spec.direction;
  }
  for(const [pivot,axis] of car.steerParts) pivot.rotation[axis]=steer*(axis==='z'?-1.35:1);
  if(car.door) {
    car.door.rotation.y=car.spec.key==='vision'?car.doorAmount*.35:-car.doorAmount*car.spec.direction;
    car.door.rotation.z=car.spec.key==='vision'?car.doorAmount*.72:0;
  }
  for(const [material,reverse] of car.glows) {
    const strength=(reverse ? car.speed<-.1 : braking) ? 2 : .08;
    material.emissiveIntensity=damp(material.emissiveIntensity,strength,12,dt);
  }
}

export const boundsFor=(car,x=car.root.position.x,z=car.root.position.z,yaw=car.root.rotation.y)=>
  footprint(x,z,yaw,car.spec.halfWidth,car.spec.halfLength);
