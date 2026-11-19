import * as T from 'three';
import { clamp, smooth, wrap } from './physics.js';
import { garagePoint, groundAt } from './region.js';

const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const seatCars=new Set(['ferrari','bugatti','hummer']);
const talks=[
  ['Hey, Chandru. Ready to take the scenic route?', 'I like how quiet it gets just outside the village.'],
  ['Hey, Lucia. I was hoping you’d stop by.', 'Want to see how the city looks from the road?']
];
const driveLines=[
  ['Good call taking the car. I like this already.', 'Let’s keep driving a little longer.', 'We made it to Tokyo. Let’s find somewhere to stop.'],
  ['I’m glad you asked me along.', 'This is a pretty good date, Lucia.', 'Tokyo already? Let’s stop and take it in.']
];
export const canTakePassenger=car=>seatCars.has(car.spec.key);

export function makeCompanion(actor,name,index) {
  const home=garagePoint.clone().add(v(.25,0,-4.85));
  const date={
    actor,name,index,home,root:actor.root,accepted:false,mode:'waiting',pose:'Idle',
    menu:false,affection:null,motion:null,distance:0,talkIndex:0,car:null,line:'',lineTime:0,
    stage:0,tokyo:false
  };
  date.root.position.copy(home);
  return date;
}
export function say(date,line,duration=3.7){
  date.line=line;
  date.lineTime=duration;
}
function face(root,target,weight=1){
  const angle=Math.atan2(target.x-root.position.x,target.z-root.position.z);
  root.rotation.y+=wrap(angle-root.rotation.y)*weight;
}
export function nearCompanion(date,player) {
  return date&&['waiting','following'].includes(date.mode)&&date.root.position.distanceToSquared(player)<2.55**2;
}
export function selectAction(date,action,player){
  if(!nearCompanion(date,player)||date.affection)return false;
  date.menu=false;
  switch(action){
    case 'date':
      date.accepted=true;date.mode='following';date.distance=0;date.stage=0;date.tokyo=false;
      say(date,date.index===0?'I’d love to. Let’s take one of the two-seat cars.':'A drive together sounds good. Lead the way.');
      return true;
    case 'end':
      date.accepted=false;date.mode='waiting';
      say(date,'I had a lovely time. Thanks for the drive.');
      return true;
    case 'talk':
      say(date,talks[date.index][date.talkIndex++%2]);
      date.affection={kind:'talk',time:0,duration:2.4,from:player.clone(),weight:0};
      return true;
    case 'hug':
    case 'kiss': {
      const kiss=action==='kiss';
      say(date,kiss?'“Can I kiss you?”  “Yes.”':'“Can I hug you?”  “Of course.”',2.7);
      const direction=player.clone().sub(date.root.position);direction.y=0;
      if(direction.lengthSq()<.05)direction.set(0,0,1);
      direction.normalize();
      const target=date.root.position.clone().addScaledVector(direction,kiss?.27:.43);
      target.y=groundAt(target.x,target.z,player.y);
      const closeAngle=Math.atan2(-direction.x,-direction.z);
      date.affection={kind:action,time:0,duration:kiss?2.9:3.3,from:player.clone(),target,angle:closeAngle,weight:0};
      return true;
    }
    default:return false;
  }
}
export function affectionStep(date,dt,player,driver){
  const moment=date.affection;
  moment.time+=dt;
  face(date.root,player,Math.min(1,dt*9));
  face(driver,date.root.position,Math.min(1,dt*9));
  if(moment.target){
    const t=moment.time/moment.duration;
    const approach=smooth(clamp((t-.16)/.24,0,1));
    const retreat=1-smooth(clamp((t-.73)/.27,0,1));
    const closest=approach*retreat;
    moment.weight=smooth(clamp((t-.32)/.14,0,1))*retreat;
    player.copy(moment.from).lerp(moment.target,closest);
    driver.position.copy(player);
    const contact=moment.kind==='kiss';
    const amount=moment.weight;
    driver.rotation.x=(contact?.055:.071)*amount;
    date.root.rotation.x=(contact?.056:.058)*amount;
    driver.rotation.z=(contact?.042:.012)*amount;
    date.root.rotation.z=(contact?.043:.012)*amount;
  }
  date.pose='Idle';
  if(moment.time>=moment.duration){
    date.affection=null;
    date.root.rotation.x=date.root.rotation.z=driver.rotation.x=driver.rotation.z=0;
  }
  return driver.rotation.y;
}
function worldPoint(car,x,y,z) {
  return v(x,y,z).applyAxisAngle(T.Object3D.DEFAULT_UP,car.root.rotation.y).add(car.root.position);
}
function passengerSeat(car) {
  const [x,y,z]=car.spec.seat;
  return worldPoint(car,-x,y-.61,z);
}
function passengerDoor(car){
  const p=worldPoint(car,-car.spec.halfWidth-.57,0,-.11);
  p.y=groundAt(p.x,p.z,car.root.position.y);
  return p;
}
export function boardCompanion(date,car){
  if(!date.accepted)return;
  const door=passengerDoor(car);
  const approach=date.root.position.distanceTo(door);
  date.mode='boarding';date.car=car;
  date.motion={time:0,from:date.root.position.clone(),door,walk:clamp(approach/2.7,.25,2.2),slide:.72};
  say(date,'I’ll take the passenger seat.');
}
export function exitCompanion(date,car,blocked,playerExit){
  if(!date||date.car!==car||date.mode!=='riding')return;
  const door=passengerDoor(car);
  const candidates=[door,worldPoint(car,-car.spec.halfWidth-.55,0,-1.28),worldPoint(car,0,0,-car.spec.halfLength-.58)];
  if(playerExit)candidates.push(playerExit.clone().add(v(.63,0,.45)),playerExit);
  const stop=candidates.find(p=>!blocked(p))??playerExit??door;
  stop.y=groundAt(stop.x,stop.z,car.root.position.y);
  date.motion={time:0,from:passengerSeat(car),door:stop,slide:1.12};
  date.mode='exiting';
}
function boardStep(date,dt) {
  const {root,car,motion}=date;
  motion.time+=dt;
  if(motion.time<motion.walk){
    root.position.copy(motion.from).lerp(motion.door,smooth(motion.time/motion.walk));
    face(root,motion.door,dt*8);
    date.pose='Walk';
    return;
  }
  const fraction=clamp((motion.time-motion.walk)/motion.slide,0,1);
  root.position.copy(motion.door).lerp(passengerSeat(car),smooth(fraction));
  root.rotation.y+=wrap(car.root.rotation.y-root.rotation.y)*dt*8;
  date.pose=fraction>.24?'Passenger':'Idle';
  if(fraction===1){date.mode='riding';date.motion=null;}
}
function exitStep(date,dt) {
  const {root,motion}=date;
  motion.time+=dt;
  const t=clamp(motion.time/motion.slide,0,1);
  root.position.copy(motion.from).lerp(motion.door,smooth(t));
  date.pose=t<.38?'Passenger':'Idle';
  if(t===1){date.mode=date.accepted?'following':'waiting';date.car=date.motion=null;}
}
function followStep(date,dt,player,angle,blocked){
  date.pose='Idle';
  const root=date.root;
  const toward=player.clone().add(v(-.70,0,-1.12).applyAxisAngle(T.Object3D.DEFAULT_UP,angle));
  const diff=toward.sub(root.position);diff.y=0;
  const distance=diff.length();
  if(distance<.77){face(root,player,dt*3);return;}
  if(root.position.distanceToSquared(player)<.64)return;
  diff.normalize();
  const speed=distance>4?4.8:2.25;
  for(const turn of [0,.6,-.6,1.1,-1.1]){
    const delta=diff.clone().applyAxisAngle(T.Object3D.DEFAULT_UP,turn);
    const p=root.position.clone().addScaledVector(delta,dt*speed);
    if(blocked(p.x,p.z,root.position.y))continue;
    face(root,p,dt*8);
    root.position.set(p.x,groundAt(p.x,p.z,root.position.y),p.z);
    date.pose=distance>4?'Run':'Walk';
    return;
  }
}
export function moveCompanion(date,dt,player,angle,blocked) {
  date.lineTime=Math.max(0,date.lineTime-dt);
  if(date.mode==='boarding'){boardStep(date,dt);return;}
  if(date.mode==='exiting'){exitStep(date,dt);return;}
  if(date.mode==='riding'){
    const car=date.car;
    date.root.position.copy(passengerSeat(car));
    date.root.rotation.set(car.pitch,car.root.rotation.y,0);
    date.pose='Passenger';
    date.distance+=Math.abs(car.speed)*dt;
    if(car.root.position.z>432&&!date.tokyo){
      say(date,driveLines[date.index][2],4.6);date.tokyo=true;
    } else if(date.stage<2&&date.distance>[36,105][date.stage]) {
      say(date,driveLines[date.index][date.stage++],4.2);
    }
    return;
  }
  if(date.mode==='following'&&!date.menu){followStep(date,dt,player,angle,blocked);return;}
  date.pose='Idle';
  if(nearCompanion(date,player))face(date.root,player,dt*3.7);
}
