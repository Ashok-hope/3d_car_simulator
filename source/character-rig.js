import * as T from 'three';
import { clamp, damp } from './physics.js';

const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
function aim(bone,child,target,weight){
  const joint=bone.getWorldPosition(v());
  const original=child.getWorldPosition(v()).sub(joint).normalize();
  const direction=target.clone().sub(joint).normalize();
  if(direction.lengthSq()<.5)return;
  const change=new T.Quaternion().setFromUnitVectors(original,direction);
  const rotation=change.multiply(bone.getWorldQuaternion(new T.Quaternion()));
  const parent=bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
  bone.quaternion.slerp(parent.multiply(rotation),weight);
  bone.updateWorldMatrix(false,true);
}
export function reach(bones,chain,target,pole,weight){
  const [upper,lower,end]=chain.map(name=>bones[name]);
  if(!upper||!lower||!end||weight<.001)return;
  const joint=upper.getWorldPosition(v()), mid=lower.getWorldPosition(v());
  const a=mid.distanceTo(joint),b=end.getWorldPosition(v()).distanceTo(mid);
  if(a<.001||b<.001)return;
  const direction=target.clone().sub(joint);
  const distance=clamp(direction.length(),Math.abs(a-b)+.001,a+b-.001);
  direction.normalize();
  const bend=pole.clone().sub(joint);
  bend.addScaledVector(direction,-bend.dot(direction)).normalize();
  const projection=(a*a+distance*distance-b*b)/(2*distance);
  mid.copy(joint).addScaledVector(direction,projection).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-projection*projection)));
  aim(upper,lower,mid,weight);
  aim(lower,end,target,weight);
}

export function takeBoneMap(model){
  const bones={};
  model.traverse(o=>{if(o.isBone)bones[o.name]=o;});
  return bones;
}
export function luciaAvatar(asset) {
  const root=new T.Group();
  const model=new T.Group();
  model.add(asset);
  root.add(model);
  root.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(asset);
  const height=1.69, scale=height/(bounds.max.y-bounds.min.y);
  const center=bounds.getCenter(v());
  model.scale.setScalar(scale);
  model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
  const source=takeBoneMap(asset);
  const bones={};
  const labels={hips:'Hip',spine:'Spine02',neck:'NeckTwist01',head:'Head'};
  for(const [side,tag] of [['L','L'],['R','R']]){
    Object.assign(labels,{
      ['upper'+side]:tag+'_Upperarm',['lower'+side]:tag+'_Forearm',['hand'+side]:tag+'_Hand',
      ['thigh'+side]:tag+'_Thigh',['calf'+side]:tag+'_Calf',['foot'+side]:tag+'_Foot'
    });
  }
  for(const [alias,label] of Object.entries(labels)){
    const bone=Object.entries(source).find(([name])=>name.toLowerCase()===('CC_Base_'+label).toLowerCase())?.[1];
    if(bone)bones[alias]=bone;
  }
  if(!bones.hips||!bones.footL||!bones.handL)throw new Error('Lucia’s body rig is missing.');
  root.updateMatrixWorld(true);
  const rest=Object.fromEntries(Object.entries(bones).map(([name,bone])=>[name,{
    q:bone.quaternion.clone(),p:bone.position.clone(),world:root.worldToLocal(bone.getWorldPosition(v()))
  }]));
  let phase=0,walking=0,seated=0,passenger=0;
  function update(pose,dt,bike){
    for(const [name,b] of Object.entries(bones)){b.quaternion.copy(rest[name].q);b.position.copy(rest[name].p);}
    const moving=pose==='Run'?1:pose==='Walk'?.57:0;
    walking=damp(walking,moving,10,dt);
    seated=damp(seated,pose==='Drive'||pose==='Passenger'?1:0,9,dt);
    passenger=damp(passenger,pose==='Passenger'?1:0,10,dt);
    phase+=dt*(moving>.8?12:8.5);
    const hip=rest.hips.world.clone();
    hip.y+=Math.abs(Math.cos(phase))*.031*walking-.26*seated;
    bones.hips.position.copy(bones.hips.parent.worldToLocal(root.localToWorld(hip)));
    root.updateWorldMatrix(true,true);
    for(const [side,phaseOffset] of [['L',0],['R',Math.PI]]){
      const sign=Math.sign(rest['hand'+side].world.x)||1;
      const swing=Math.sin(phase+phaseOffset);
      const foot=rest['foot'+side].world.clone();
      foot.z+=swing*.37*walking;
      foot.y+=Math.max(0,swing)*.12*walking;
      foot.lerp(v(sign*(bike?.17:.18),bike?.36:.25,bike?-.01:.37),seated);
      reach(bones,['thigh'+side,'calf'+side,'foot'+side], root.localToWorld(foot), root.localToWorld(v(sign*.24,.61,.77)),Math.min(1,walking*1.65+seated));
      const hand=v(sign*.205,.85,.025);
      hand.z-=swing*.28*walking;
      hand.y+=Math.max(0,-swing)*.06*walking;
      const destination=v(sign*(bike?.30:.28),bike?1.01:.84,bike?.48:.50);
      destination.lerp(v(sign*.19,.69,.34),passenger);
      hand.lerp(destination,seated);
      reach(bones,['upper'+side,'lower'+side,'hand'+side],root.localToWorld(hand),root.localToWorld(v(sign*.35,1.05,.16)),.985);
    }
  }
  return {root,bones,height,update};
}

export function affectionatePose(actor,partner,kind,weight){
  if(weight<.001||kind==='talk')return;
  const kiss=kind==='kiss';
  for(const [side,sign] of [['L',1],['R',-1]]){
    const target=partner.root.localToWorld(v(-sign*(kiss?.14:.18),(kiss?.70:.75)*partner.height,kiss?.045:-.12));
    const pole=actor.root.localToWorld(v(sign*.48,.64*actor.height,.21));
    reach(actor.bones,['upper'+side,'lower'+side,'hand'+side],target,pole,weight*.96);
  }
}
