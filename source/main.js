import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { animateCar, boundsFor, makeVehicle, park, specs } from './vehicles.js';
import { clamp, damp, physics, smooth, wrap } from './physics.js';
import { bayPositions, garagePlace } from './world.js';
import { installRegion, buildConnections, laneRoutes, districtName, startingPoint, startingYaw, garagePoint, inGarage, overview, groundAt, wallHit, cameraWallHit } from './region.js';
import { trafficModels, createTraffic, simulateTraffic, trafficHit } from './traffic.js';
import { createDog, moveDog } from './pedestrians.js';
import { affectionatePose, luciaAvatar, reach, takeBoneMap } from './character-rig.js';
import { affectionStep, boardCompanion, canTakePassenger, exitCompanion, makeCompanion, moveCompanion, nearCompanion, selectAction } from './companion.js';

const $ = id => document.getElementById(id);
const canvas=$('view');
const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const keys=new Set();
const state={page:'loading',selected:0,preview:0,quality:'medium',sound:true,character:0,introduced:false,view:0,rear:false,mapWide:false};
try {
  const saved=JSON.parse(localStorage.getItem('west-street-motor-club')??'{}');
  if(Number.isInteger(saved.selected)&&specs[saved.selected]) state.selected=saved.selected;
  if(['low','medium','high'].includes(saved.quality)) state.quality=saved.quality;
  if(typeof saved.sound==='boolean') state.sound=saved.sound;
  if(Number.isInteger(saved.character)&&saved.character>=0&&saved.character<2)state.character=saved.character;
  state.introduced=saved.introduced===true;
} catch {}
function save() {
  try {
    const {selected,quality,sound,character,introduced}=state;
    localStorage.setItem('west-street-motor-club',JSON.stringify({selected,quality,sound,character,introduced}));
  } catch {}
}

const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;
const scene=new T.Scene();
scene.background=new T.Color(0xb0c7d6);
scene.fog=new T.FogExp2(0xb0c7d6,.0032);
const camera=new T.PerspectiveCamera(60,1,.10,480);
const env=new RoomEnvironment();
const pmrem=new T.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(env,.045).texture;
env.dispose();pmrem.dispose();
scene.environmentIntensity=.55;
const hemi=new T.HemisphereLight(0xfff0d7,0x596861,2.1);
const sun=new T.DirectionalLight(0xffe0b5,2.45);
sun.position.set(-25,55,-33);
scene.add(hemi,sun);
const garageFill=new T.PointLight(0xffd7a0,94,20,2);
garageFill.position.copy(garagePoint).add(v(-2,4,3));
const garageEdge=new T.PointLight(0xc9e8ff,75,18,2);
garageEdge.position.copy(garagePoint).add(v(5,3.2,-3));
scene.add(garageFill,garageEdge);

let ready=false, firstCamera=true, menuReturn='menu', active=null, transition=null, inside=false, cinematic=0, orbit=0;
let driver, driverModel, driverMixer, pose=null, actions={};
const ridingBones={};
let dtAccumulator=0, elapsed=0;
const fleet=[];
let traffic=[], dog;
const castNames=['Chandru','Lucia'];
const cast=[], partnerCast=[];
let date=null;
let variant=null;
const world=new T.Group();
const garageWorld=new T.Group();
scene.add(world,garageWorld);
const look=v(), desired=v(), focus=v(), ahead=v();
const player=v();
let playerAngle=Math.PI;
const shadowImage=document.createElement('canvas');
shadowImage.width=64;shadowImage.height=64;
const shadowContext=shadowImage.getContext('2d');
const radial=shadowContext.createRadialGradient(32,32,3,32,32,32);
radial.addColorStop(0,'rgba(16,19,17,0.72)');radial.addColorStop(.55,'rgba(15,18,16,0.4)');radial.addColorStop(1,'rgba(15,18,16,0)');
shadowContext.fillStyle=radial;shadowContext.fillRect(0,0,64,64);
const shadowTex=new T.CanvasTexture(shadowImage);
function shadow(root,w,l) {
  const m=new T.Mesh(new T.PlaneGeometry(w,l),new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  m.rotation.x=-Math.PI/2;
  m.position.y=.017;
  root.add(m);
  return m;
}

function resize() {
  const ratio={low:.75,medium:1,high:1.45}[state.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio*ratio,ratio,1800/innerWidth));
  renderer.setSize(innerWidth,innerHeight,false);
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize',resize);
resize();
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const local=location.protocol==='file:'||Boolean(document.querySelector('meta[name="packed-assets"]'));
function embedded(name) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='packed/'+name+'.js';
    script.onload=()=>{
      const encoded=window.modelBytes;
      delete window.modelBytes;
      script.remove();
      if (!encoded) { reject(Error('Missing encoded asset '+name)); return; }
      const b=atob(encoded);
      const data=new Uint8Array(b.length);
      for(let i=0;i<b.length;i++) data[i]=b.charCodeAt(i);
      resolve(data.buffer);
    };
    script.onerror=()=>{script.remove();reject(Error('Missing asset '+name));};
    document.head.append(script);
  });
}
async function loadData(name) {
  if (local) return embedded(name);
  const response=await fetch('assets/'+name);
  if(!response.ok) throw Error('Load failed '+name);
  return response.arrayBuffer();
}
async function glb(key) {
  return loader.parseAsync(await loadData(key+'.glb'),'');
}
async function initialize() {
  let loaded=0;
  const progress=()=>{$('progress').value=++loaded/14;};
  const coordinates=JSON.parse(new TextDecoder().decode(await loadData('regions.json')));
  for(const [key,label] of [['alps','Chamonix Alps'],['tokyo','Tokyo']]){
    $('loadingDetail').textContent='Loading '+label;
    world.add(installRegion((await glb(key)).scene,key,coordinates));
    progress();
  }
  buildConnections(world);
  const garageAsset=await glb('garage');
  garageAsset.scene.traverse(n=>{
    if (!n.isMesh) return;
    const m=n.material;
    if (/occluder|godray/i.test(m.name)) n.visible=false;
    if (/windows/i.test(m.name)) {m.transparent=true;m.opacity=.58;m.depthWrite=false;}
    if (/ground/i.test(m.name)) m.polygonOffset=true,m.polygonOffsetFactor=-2;
  });
  garageWorld.add(garagePlace(garageAsset.scene));progress();
  const actor=await glb('driver');
  driver=new T.Group();
  driverModel=clone(actor.scene);
  driverModel.traverse(n=>{if(n.isBone) ridingBones[n.name]=n;});
  driver.add(driverModel);
  scene.add(driver);
  cast.push(driverModel);
  partnerCast.push(makeChandru(actor));
  $('loadingDetail').textContent='Loading Lucia';
  const lucia=await glb('lucia-date');
  const newLucia=luciaAvatar(clone(lucia.scene));
  driver.add(newLucia.root);
  cast.push(newLucia);
  partnerCast.push(luciaAvatar(lucia.scene));
  for(const member of partnerCast){
    member.root.visible=false;
    scene.add(member.root);
  }
  progress();
  setDriver();
  $('loadingDetail').textContent='Preparing the pavement dog';
  dog=createDog((await glb('dog')).scene,world,shadow);
  progress();
  driverMixer=new T.AnimationMixer(driverModel);
  for (const clip of actor.animations) actions[clip.name]=driverMixer.clipAction(clip);
  poseAs('Idle',0);
  progress();
  for (const spec of specs) {
    $('loadingDetail').textContent='Preparing '+spec.name;
    const asset=await glb(spec.key);
    const car=makeVehicle(asset.scene,spec);
    fleet.push(car);
    shadow(car.root,spec.halfWidth*2.65,spec.halfLength*2.28);
    garageWorld.add(car.root);
    progress();
  }
  const trafficAsset=await glb('traffic');
  traffic=createTraffic(world,laneRoutes(),trafficModels(trafficAsset.scene),groundAt,shadow);
  progress();
  ready=true;
  state.preview=state.selected;
  page('menu');
  $('progress').value=1;
}

function poseAs(name,fade=.2) {
  if(pose===name || !actions[name]) return;
  if(pose && fade) actions[pose].fadeOut(fade);
  else if(pose) actions[pose].stop();
  const action=actions[name].reset();
  action.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  if(fade) action.fadeIn(fade);
  pose=name;
}
function makeChandru(asset){
  const root=new T.Group();
  const model=clone(asset.scene);
  root.add(model);
  const bones=takeBoneMap(model);
  const mixer=new T.AnimationMixer(model);
  const clips=new Map(asset.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
  let previous='';
  function update(pose,dt){
    const clipName=pose==='Passenger'?'Drive':pose;
    if(clipName!==previous&&clips.has(clipName)){
      if(previous)clips.get(previous)?.fadeOut(.16);
      clips.get(clipName).reset().play().fadeIn(.16);
      previous=clipName;
    }
    mixer.update(dt);
    if(pose==='Passenger'){
      for(const [side,sign] of [['L',1],['R',-1]]){
        reach(bones,['upper'+side,'lower'+side,'hand'+side],root.localToWorld(v(sign*.15,.69,.29)),root.localToWorld(v(sign*.45,.68,-.05)),.88);
      }
    }
  }
  return {root,bones,height:1.75,update};
}
function beginCompanion(){
  const companion=1-state.character;
  const actor=partnerCast[companion];
  for(const member of partnerCast)member.root.visible=member===actor;
  date=makeCompanion(actor,castNames[companion],companion);
  date.root.rotation.set(0,0,0);
}
function partnerAction(name){
  if(active||transition||!interactivePage()||!date?.menu)return;
  if(selectAction(date,name,player))keys.clear();
}
function resetCompanion(){
  for(const member of partnerCast)member.root.visible=false;
  date=null;
}
function setDriver(){
  if(cast.length<castNames.length)return;
  variant=state.character===0?null:cast[state.character];
  for(const [index,member] of cast.entries()) (member.root??member).visible=index===state.character;
  $('driverName').textContent=castNames[state.character];
}
function chooseDriver(){
  state.character=(state.character+1)%castNames.length;
  setDriver();
  save();
}
function interactivePage() {return state.page==='drive';}
function page(name) {
  state.page=name;
  firstCamera=true;
  for(const [id,isVisible] of Object.entries({
    menu:name==='menu',labels:name==='menu',garageUI:name==='garage',settings:name==='settings',
    hud:name==='drive',intro:name==='intro',pause:name==='pause',loading:name==='loading'
  })) $(id).hidden=!isVisible;
  $('defaultCar').textContent=specs[state.selected].name;
  if(name!=='drive'){
    $('dateMenu').hidden=true; $('dateLine').hidden=true;
    if(date)date.menu=false;
  }
  if(name==='menu' || name==='garage') {
    resetCompanion();
    for(const car of fleet){park(car);car.root.visible=name==='garage'||car.spec.index===state.selected;}
    if(name==='menu'){
      const car=fleet[state.selected];
      car.root.position.copy(garagePoint).add(v(3.65,.028,.15));
      car.root.rotation.y=-.47;
      driver.visible=true;
      driver.position.copy(garagePoint).add(v(-3.65,0,.72));
      driver.rotation.set(0,.18,0);
      poseAs('Idle');
    } else {
      driver.visible=false;
      updateGarageUI();
    }
  }
  if(name==='settings'){
    $('quality').value=state.quality;
    $('sound').checked=state.sound;
  }
}
function updateGarageUI() {
  const spec=specs[state.preview];
  $('bay').textContent='BAY '+String(spec.index+1).padStart(2,'0')+' / 07';
  $('carName').textContent=spec.name;
  $('spec').textContent=spec.category+(spec.index===state.selected?'  ·  Selected':'');
  $('select').textContent=spec.index===state.selected?'Use this vehicle':'Select vehicle';
}
function browse(delta) {
  state.preview=(state.preview+delta+fleet.length)%fleet.length;
  updateGarageUI();
}
function confirmCar(){
  state.selected=state.preview;
  save();
  page('menu');
}
function start(atGarage=false){
  audio();
  for(const car of fleet){park(car);car.root.visible=true;}
  beginCompanion();
  active=atGarage?null:fleet[state.selected];
  if(active){
    active.parked=false;
    active.root.position.copy(startingPoint);
    active.root.rotation.y=startingYaw;
  } else {
    player.copy(garagePoint).add(v(0,0,-2.52));
    playerAngle=Math.PI;
    driver.position.copy(player);
    driver.rotation.set(0,playerAngle,0);
    driver.visible=true;
  }
  state.view=0;
  state.rear=false;
  transition=null;
  inside=atGarage;
  orbit=atGarage?Math.PI:0;
  cinematic=0;
  syncSeat();
  poseAs(atGarage?'Idle':'Drive',0);
  page(atGarage||state.introduced?'drive':'intro');
  state.introduced=true;
  save();
}
function setLocal(vector,car){
  vector.applyAxisAngle(T.Object3D.DEFAULT_UP,car.root.rotation.y).add(car.root.position);
  return vector;
}
function seatOf(car) {
  const [x,y,z]=car.spec.seat;
  return setLocal(v(x,y-.61,z),car);
}
function entranceFor(car) {
  const x=car.spec.entrySide*(car.spec.halfWidth+.51);
  const z=car.spec.bike?-.23:.09;
  const preferred=setLocal(v(x,0,z),car);
  preferred.y=groundAt(preferred.x,preferred.z,car.root.position.y);
  return preferred;
}
function exitPoint(car) {
  const p=entranceFor(car);
  if(!crowdedAt(p.x,p.z,.35,car)) return p;
  for(const [x,z] of [[-car.spec.halfWidth-.62,0],[0,-car.spec.halfLength-.76],[0,car.spec.halfLength+.76]]) {
    const q=setLocal(v(x,0,z),car);q.y=groundAt(q.x,q.z,car.root.position.y);
    if(!crowdedAt(q.x,q.z,.35,car)) return q;
  }
  return null;
}
function syncSeat() {
  if(!active) return;
  const p=seatOf(active);
  driver.visible=state.view!==2 || state.rear || state.page!=='drive';
  driver.position.copy(p);
  driver.rotation.set(active.pitch,active.root.rotation.y,active.spec.bike?active.lean:0);
}
function nearestVehicle() {
  let close=null,distance=2.24;
  for (const car of fleet) {
    const d=entranceFor(car).distanceTo(player);
    if(d<distance){distance=d;close=car;}
  }
  return close;
}
function startTransition(){
  if (transition||date?.affection||date?.menu||date?.mode==='exiting') return;
  if(active){
    if(date?.mode==='boarding')return;
    if(Math.abs(active.speed)>1.35) return;
    const to=exitPoint(active);
    if(!to){flash('Make room beside the vehicle');return;}
    active.speed=active.slide=0;
    transition={enter:false,car:active,t:0,from:seatOf(active),to,angle:active.root.rotation.y};
    state.rear=false;state.view=0;
    exitCompanion(date,active,p=>crowdedAt(p.x,p.z,.33,active),to);
  } else {
    const car=nearestVehicle();
    if(!car) return;
    if(date?.accepted){
      if(!canTakePassenger(car)){flash('Choose the Ferrari, Bugatti or Hummer for two seats');return;}
      boardCompanion(date,car);
    }
    transition={enter:true,car,t:0,from:player.clone(),to:seatOf(car),angle:playerAngle};
    car.speed=car.slide=0;
  }
  driver.visible=true;
}
function updateTransition(dt){
  const item=transition;
  const {car,enter,from,to,angle}=item;
  item.t+=dt;
  const t=clamp(item.t/(car.spec.bike?1.24:1.47),0,1);
  const slide=smooth(clamp((t-.22)/.53,0,1));
  const hinge=Math.sin(Math.PI*smooth(t))*.98;
  car.doorAmount=hinge;
  driver.position.copy(from).lerp(to,slide);
  driver.position.y+=Math.sin(Math.PI*slide)*(car.spec.bike?.25:.11);
  const turning=(enter?car.root.rotation.y:car.root.rotation.y+.72);
  driver.rotation.set(.12*Math.sin(slide*Math.PI),angle+wrap(turning-angle)*smooth(t),0);
  if((enter&&t>.36)||(!enter&&t<.54)) poseAs('Drive',.34);
  else if(t<.84) poseAs(car.spec.bike?'Walk':'Idle',.23);
  else poseAs('Idle',.2);
  if(t<1) return;
  car.doorAmount=0;
  transition=null;
  if(enter){
    active=car;
    car.parked=false;
    state.selected=car.spec.index;
    state.view=0;
    state.rear=false;
    poseAs('Drive',.12);
    save();
  } else {
    active=null;
    player.copy(to);
    playerAngle=turning;
    orbit=playerAngle;
    poseAs('Idle',.16);
  }
}
function ridingPose() {
  if(!active?.spec.bike||transition||pose!=='Drive') return;
  const bike=active.spec.motorcycle;
  for(const [side,sign] of [['L',1],['R',-1]]) {
    const handle=v(sign*(bike?.365:.44),bike?1.08:1.27,bike?.462:.42);
    handle.applyAxisAngle(T.Object3D.DEFAULT_UP,active.steer*.63);
    active.suspension.localToWorld(handle);
    const elbow=active.suspension.localToWorld(v(sign*.45,.80,.04));
    const peg=active.suspension.localToWorld(v(sign*(bike?.215:.33),bike?.29:.38,bike?-.21:-.30));
    const knee=active.suspension.localToWorld(v(sign*.38,.67,.35));
    reach(ridingBones,['upper'+side,'lower'+side,'hand'+side],handle,elbow,.97);
    reach(ridingBones,['thigh'+side,'calf'+side,'foot'+side],peg,knee,.89);
  }
}
function crowdedAt(x,z,r,except,height=except?.root.position.y??player.y) {
  if(wallHit(x,z,r,height)) return true;
  for(const car of fleet){
    if(car===except||Math.abs(car.root.position.y-height)>2.5) continue;
    if(boundsFor(car).some(([a,b,radius])=>(x-a)**2+(z-b)**2<(r+radius)**2)) return true;
  }
  return trafficHit(traffic,x,z,r,height);

}

const press=(...codes)=>codes.some(key=>keys.has(key));
const moved={throttle:0,steering:0,handbrake:false};
function step(dt) {
  elapsed+=dt;
  if(!ready) return;
  const play=interactivePage();
  if(state.page==='intro'){
    cinematic+=dt;
    if(cinematic>5.7) page('drive');
    syncSeat();
  }
  if(play) {
    simulateTraffic(traffic,dt,fleet,active?null:player,groundAt,wallHit);
    moveDog(dog,dt,active?.root.position??player);
    if(date&&!date.affection)moveCompanion(date,dt,player,playerAngle,(x,z,y)=>crowdedAt(x,z,.30,null,y));
    if(date?.affection) {
      poseAs('Idle');
      playerAngle=affectionStep(date,dt,player,driver);
    } else if(transition) updateTransition(dt);
    else if(active) {
      moved.throttle=date?.mode==='boarding'?0:Number(press('KeyW','ArrowUp'))-Number(press('KeyS','ArrowDown'));
      moved.steering=Number(press('KeyA','ArrowLeft'))-Number(press('KeyD','ArrowRight'));
      moved.handbrake=press('Space')||date?.mode==='boarding';
      physics(active,moved,dt,(x,z,yaw)=>boundsFor(active,x,z,yaw).some(([a,b,r])=>crowdedAt(a,b,r,active)));
      const p=active.root.position;
      p.y=groundAt(p.x,p.z,p.y)+.025;
      const angle=active.root.rotation.y, dx=Math.sin(angle)*1.15,dz=Math.cos(angle)*1.15;
      const rise=groundAt(p.x+dx,p.z+dz,p.y)-groundAt(p.x-dx,p.z-dz,p.y);
      active.grade=damp(active.grade??0,clamp(-Math.atan2(rise,2.3),-.28,.28),9,dt);
      syncSeat();
    } else {
      const sidestep=date?.menu?0:Number(press('KeyD','ArrowRight'))-Number(press('KeyA','ArrowLeft'));
      const forward=date?.menu?0:Number(press('KeyW','ArrowUp'))-Number(press('KeyS','ArrowDown'));
      const run=press('ShiftLeft','ShiftRight');
      if(sidestep||forward){
        const yaw=orbit+Math.atan2(-sidestep,forward);
        const speed=run?5.6:2.75;
        const x=player.x+Math.sin(yaw)*speed*dt;
        const z=player.z+Math.cos(yaw)*speed*dt;
        if(!crowdedAt(x,player.z,.31,null)) player.x=x;
        if(!crowdedAt(player.x,z,.31,null)) player.z=z;
        playerAngle+=wrap(yaw-playerAngle)*Math.min(1,dt*13);
        poseAs(run?'Run':'Walk');
      } else poseAs('Idle');
      player.y=groundAt(player.x,player.z,player.y);
      driver.position.copy(player);
      driver.rotation.set(0,playerAngle,0);
      driver.visible=true;
    }
    const p=active?.root.position??player;
    const at=inGarage(p);
    if(inside&&!at&&!transition) {
      for(const car of fleet) if(car!==active) park(car);
      flash('Garage vehicles returned to their bays');
      inside=false;
    } else if(at) inside=true;
    for(const car of fleet) animateCar(car,dt,car===active&&(moved.handbrake||(moved.throttle<0&&car.speed>0)));
  } else if(state.page==='menu'||state.page==='garage') {
    for(const car of fleet) animateCar(car,dt);
  }
  driverMixer.update(dt);
  if(play&&!variant) ridingPose();
  if(variant) variant.update(pose,dt,active?.spec.bike??transition?.car.spec.bike??false);
  if(play&&date){
    date.actor.update(date.pose,dt,false);
    if(date.affection){
      const actor={root:driver,bones:variant?.bones??ridingBones,height:variant?.height??1.75};
      affectionatePose(actor,date.actor,date.affection.kind,date.affection.weight);
      affectionatePose(date.actor,actor,date.affection.kind,date.affection.weight);
    }
  }
  audioStep();
}

let notice='', expires=0;
function flash(message){notice=message;expires=elapsed+2.5;}
const cameraNames=['Chase','Hood','Cabin','Wide'];
function tuckCamera(origin, target) {
  const delta=target.clone().sub(origin);
  const steps=Math.ceil(Math.hypot(delta.x,delta.z)/.34);
  for(let i=1;i<=steps;i++){
    const t=i/steps;
    if(cameraWallHit(origin.x+delta.x*t,origin.z+delta.z*t,.28)) {
      const safe=Math.max(.13,(i-1)/steps);
      target.x=origin.x+delta.x*safe;
      target.z=origin.z+delta.z*safe;
      target.y=Math.min(target.y,origin.y+1.4);
      return;
    }
  }
}
function mood(dt){
  if(!ready){desired.copy(garagePoint).add(v(0,5,12));focus.copy(garagePoint);}
  else if(state.page==='menu'||(state.page==='settings'&&menuReturn==='menu')){
    desired.copy(garagePoint).add(v(.08+Math.sin(elapsed*.24)*.18,2.15,7.8));
    focus.copy(garagePoint).add(v(0,1.04,-.1));
  } else if(state.page==='garage') {
    const car=fleet[state.preview];
    const [sx]=bayPositions[state.preview];
    desired.copy(car.root.position).add(v(-Math.sign(sx)*4.25,2.48,2.55));
    focus.copy(car.root.position).add(v(0,.48,0));
  } else if(state.page==='intro'&&active){
    const p=active.root.position;
    const t=cinematic/5.7;
    desired.copy(p).add(v(Math.cos(t*3.1)*6.6,1.55+t*2.7,Math.sin(t*3.1)*6.6-1.4));
    focus.copy(p).add(v(0,.8,0));
  } else if(date?.affection&&interactivePage()){
    const origin=date.root.position.clone().add(driver.position).multiplyScalar(.5);
    const side=v(1,0,0).applyAxisAngle(T.Object3D.DEFAULT_UP,driver.rotation.y);
    desired.copy(origin).addScaledVector(side,3.1).add(v(0,1.64,.27));
    focus.copy(origin).add(v(0,1.14,0));
    tuckCamera(focus,desired);
  } else if(transition){
    const car=transition.car;
    desired.copy(setLocal(v(3.9,2.35,-2.8),car));
    focus.copy(driver.position).add(v(0,.9,0));
    tuckCamera(focus,desired);
  } else if(active){
    const car=active, p=car.root.position, yaw=car.root.rotation.y;
    ahead.set(Math.sin(yaw),0,Math.cos(yaw));
    if(state.rear){
      desired.copy(p).addScaledVector(ahead,5.3).add(v(0,2.15,0));
      focus.copy(p).addScaledVector(ahead,-6).add(v(0,.92,0));
    } else if(state.view===0||state.view===3) {
      const wide=state.view===3;
      desired.copy(p).addScaledVector(ahead,wide?-9.4:-6.3).add(v(0,wide?5.9:2.8,0));
      focus.copy(p).addScaledVector(ahead,1.45).add(v(0,.94,0));
    } else if(state.view===1) {
      desired.copy(setLocal(v(0,car.spec.eye[1]+.19,car.spec.halfLength*.68),car));
      focus.copy(desired).addScaledVector(ahead,14).add(v(0,-.75,0));
    } else {
      desired.copy(setLocal(v(...car.spec.eye),car));
      focus.copy(desired).addScaledVector(ahead,14).add(v(0,-.22,0));
    }
    if(state.rear||state.view===0||state.view===3) tuckCamera(v(p.x,p.y+1.2,p.z),desired);
  } else {
    desired.copy(player).add(v(-Math.sin(orbit)*4.65,2.6,-Math.cos(orbit)*4.65));
    focus.copy(player).add(v(0,1.2,0));
    tuckCamera(focus,desired);
  }
  const immed=firstCamera||(active&&!state.rear&&[1,2].includes(state.view)&&interactivePage());
  const follow=state.page==='garage'?4.5:8.5;
  camera.position.lerp(desired,immed?1:1-Math.exp(-follow*dt));
  look.lerp(focus,immed?1:1-Math.exp(-follow*1.3*dt));
  camera.lookAt(look);
  firstCamera=false;
}
const ctx=$('map').getContext('2d');
function minimap(p){
  const mapScale=state.mapWide?.103:.58, x=q=>84+(q-p.x)*mapScale, z=q=>84+(q-p.z)*mapScale;
  ctx.clearRect(0,0,168,168);
  ctx.strokeStyle='#b7c2c098';
  ctx.lineWidth=3;
  ctx.lineJoin='round';
  for(const [index,path] of overview.entries()){
    ctx.beginPath();
    path.forEach(([a,b],i)=>i?ctx.lineTo(x(a),z(b)):ctx.moveTo(x(a),z(b)));
    if(index<2)ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle='#f6b34e';
  ctx.fillRect(x(garagePoint.x)-3,z(garagePoint.z)-3,6,6);
  ctx.fillStyle='#ffdda5';ctx.font='700 10px Segoe UI';
  ctx.fillText('Garage',x(garagePoint.x)+6,z(garagePoint.z)+4);
  ctx.fillStyle='#58d3c3';
  ctx.fillRect(x(48)-2,z(350)-2,4,4);
  ctx.fillText('Tokyo route',x(48)+5,z(350)+4);
  ctx.fillStyle='#ebf4df';
  for(const {root} of traffic) ctx.fillRect(x(root.position.x)-1,z(root.position.z)-1,2,2);
  ctx.translate(84,84);
  ctx.rotate(-(active?.root.rotation.y??playerAngle)+Math.PI);
  ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,4);ctx.lineTo(0,2);ctx.lineTo(-4,4);ctx.closePath();
  ctx.fill();ctx.setTransform(1,0,0,1,0,0);
}
function hud() {
  if(!interactivePage()) return;
  const p=active?.root.position??player;
  $('district').textContent=districtName(p);
  $('vehicle').textContent=active?(active.spec.name+(date?.mode==='riding'?' · '+date.name+' riding along':'')):
    castNames[state.character]+' · On foot';
  $('speed').hidden=!active;
  $('kph').textContent=String(Math.round(Math.abs(active?.speed??0)*3.6)).padStart(3,'0');
  $('gear').textContent=active?.speed<-.15?'R':active?.speed>.25?String(Math.min(7,1+Math.floor(active.speed/8))):'N';
  const close=active?null:nearestVehicle();
  const nearby=!active&&!transition&&nearCompanion(date,player);
  if(date?.menu&&!nearby)date.menu=false;
  $('dateMenu').hidden=!date?.menu;
  $('dateName').textContent=date?.name??'';
  $('inviteDate').hidden=Boolean(date?.accepted);
  $('endDate').hidden=!date?.accepted;
  $('dateLine').hidden=!date?.lineTime;
  if(date?.lineTime)$('dateLine').textContent=date.name+' · '+date.line;
  $('interaction').textContent=notice&&elapsed<expires?notice:transition||date?.affection||date?.menu?'':
    date?.mode==='boarding'?date.name+' is getting in':active?(Math.abs(active.speed)<1.35?'E  Exit vehicle':''):
    nearby?'F  Interact with '+date.name+(close?'   ·   E  Enter '+close.spec.name:''):close?'E  Enter '+close.spec.name:'';
  $('controls').textContent=active?
    ((state.rear?'Rear view':cameraNames[state.view])+'  ·  WASD Drive  ·  Space Handbrake  ·  V Camera  ·  C Rear View  ·  M Map'):
    'WASD Walk  ·  Shift Sprint  ·  F Interact  ·  E Enter  ·  M Map';
  minimap(p);
}

let engine=null;
function audio(){
  if(!state.sound||engine) return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  try{
    const context=new Audio();
    const wave=context.createOscillator(), tone=context.createOscillator();
    const filter=context.createBiquadFilter(), gain=context.createGain();
    wave.type='sawtooth';tone.type='triangle';filter.type='lowpass';
    wave.frequency.value=38;tone.frequency.value=21;filter.frequency.value=180;gain.gain.value=.001;
    wave.connect(filter);tone.connect(filter);filter.connect(gain);gain.connect(context.destination);
    wave.start();tone.start();
    engine={context,wave,tone,filter,gain};
    context.resume().catch(()=>{});
  } catch {}
}
function audioStep(){
  if(!engine)return;
  const {context,wave,tone,filter,gain}=engine;
  const speed=Math.abs(active?.speed??0);
  const throttle=Math.abs(moved.throttle);
  const rpm=47+(speed%8)*11+throttle*18;
  const time=context.currentTime;
  const isDriving=state.sound&&interactivePage()&&active&&!transition;
  wave.frequency.setTargetAtTime(rpm*(active?.spec.motorcycle?1.55:1),time,.08);
  tone.frequency.setTargetAtTime(rpm*.5,time,.09);
  filter.frequency.setTargetAtTime(115+speed*16+throttle*80,time,.08);
  gain.gain.setTargetAtTime(isDriving?.018+throttle*.017:0,time,.10);
}
$('play').onclick=()=>start();
$('meet').onclick=()=>start(true);
for(const button of $('dateMenu').querySelectorAll('[data-action]')){
  button.onclick=()=>partnerAction(button.dataset.action);
}
$('dateClose').onclick=()=>{if(date)date.menu=false;keys.clear();};
$('driverSelect').onclick=chooseDriver;
$('settingsButton').onclick=()=>{menuReturn='menu';page('settings');};
$('pauseSettings').onclick=()=>{menuReturn='pause';page('settings');};
$('closeSettings').onclick=()=>page(menuReturn);
$('quality').onchange=e=>{state.quality=e.target.value;resize();save();};
$('sound').onchange=e=>{state.sound=e.target.checked;audio();save();};
$('garageButton').onclick=()=>{state.preview=state.selected;page('garage');};
$('prev').onclick=()=>browse(-1);
$('next').onclick=()=>browse(1);
$('select').onclick=confirmCar;
$('back').onclick=()=>page('menu');
$('skip').onclick=()=>page('drive');
$('resume').onclick=()=>page('drive');
$('leave').onclick=()=>{active=null;transition=null;page('menu');};
addEventListener('keydown',e=>{
  const key=e.code;
  if(e.target instanceof HTMLSelectElement) return;
  if(ready&&(/^(Arrow|Space|Key[WASDEVC]|Escape)/.test(key)||(key==='Enter'&&['intro','garage'].includes(state.page))))e.preventDefault();
  keys.add(key);
  if(e.repeat||!ready)return;
  if(state.page==='garage'){
    if(key==='ArrowLeft')browse(-1);
    if(key==='ArrowRight')browse(1);
    if(key==='Enter')confirmCar();
    if(key==='Escape')page('menu');
  } else if(interactivePage()) {
    if(key==='KeyF'&&!active&&!transition&&!date?.affection&&nearCompanion(date,player)){
      date.menu=!date.menu;
      keys.clear();
      return;
    }
    if(date?.menu){
      if(key==='Escape'){date.menu=false;keys.clear();}
      const name={Digit1:'talk',Digit2:'hug',Digit3:'kiss',Digit4:'date',Digit5:'end'}[key];
      if(name&&(name!=='date'||!date.accepted)&&(name!=='end'||date.accepted))partnerAction(name);
      return;
    }
    if(key==='KeyM')state.mapWide=!state.mapWide;
    if(key==='KeyC'&&active&&!transition){state.rear=!state.rear;firstCamera=true;}
    if(key==='KeyV'&&active&&!transition){state.view=(state.view+1)%4;state.rear=false;firstCamera=true;}
    if(key==='KeyE')startTransition();
    if(key==='Escape')page('pause');
  } else if(state.page==='pause'&&key==='Escape')page('drive');
  else if(state.page==='settings'&&key==='Escape')page(menuReturn);
  else if(state.page==='intro'&&['Enter','Escape','Space'].includes(key))page('drive');
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>keys.clear());
let dragging=false;
canvas.addEventListener('pointerdown',e=>{
  if(interactivePage()&&!active&&!transition){dragging=true;canvas.setPointerCapture(e.pointerId);}
});
canvas.addEventListener('pointerup',()=>dragging=false);
canvas.addEventListener('lostpointercapture',()=>dragging=false);
canvas.addEventListener('pointermove',e=>{if(dragging)orbit-=e.movementX*.006;});
let last=performance.now();
function frame(now){
  const dt=Math.min((now-last)/1000,.05);
  last=now;
  dtAccumulator+=dt;
  for(;dtAccumulator>=1/90;dtAccumulator-=1/90)step(1/90);
  mood(dt);
  hud();
  renderer.render(scene,camera);
  requestAnimationFrame(frame);
}
if(new URLSearchParams(location.search).has('test')){
  window.driveTest={
    get state(){return {page:state.page,rear:state.rear,view:state.view,selected:state.selected,character:castNames[state.character],companion:date?{name:date.name,mode:date.mode,pose:date.pose,menu:date.menu,accepted:date.accepted,p:date.root.position.toArray(),affection:date.affection?.kind??null,distance:date.distance}:null,transition:!!transition,active:active?.spec.key,player:player.toArray(),dog:dog?.root.position.toArray(),traffic:traffic.map(car=>({p:car.root.position.toArray(),yaw:car.root.rotation.y,speed:car.speed,length:car.length,s:car.s})),cars:fleet.map(car=>({key:car.spec.key,p:car.root.position.toArray(),yaw:car.root.rotation.y,speed:car.speed,wheels:car.wheels.length,parts:car.wheels.map(w=>w.roll.children.length),door:!!car.door})),render:renderer.info.render};},
    ground:(x,z)=>[groundAt(x,z),wallHit(x,z,.34)],
    routeSample:(index,meters)=>{
      const car=traffic[index];
      const p=car.curve.getPointAt((((car.s+meters)%car.length)+car.length)%car.length/car.length);
      return [p.x,p.z];
    },
    move(x,z,yaw){
      if(active){active.root.position.set(x,groundAt(x,z)+.027,z);active.root.rotation.y=yaw;active.speed=active.slide=0;}
      else{player.set(x,groundAt(x,z),z);orbit=yaw;}
    },
  };
}
initialize().catch(err=>{
  console.error(err);
  $('loadingDetail').textContent='Could not open the game. '+err.message;
});
requestAnimationFrame(frame);
