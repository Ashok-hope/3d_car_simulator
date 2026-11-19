import * as T from 'three';
import { damp } from './physics.js';
import { garageY } from './region.js';

const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
function bake(asset,height) {
  asset.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(asset), center=bounds.getCenter(v());
  const scale=height/(bounds.max.y-bounds.min.y);
  const meshes=[];
  asset.traverse(n=>{
    if(!n.isMesh)return;
    const geometry=n.geometry.clone();
    geometry.applyMatrix4(n.matrixWorld);
    geometry.translate(-center.x,-bounds.min.y,-center.z);
    geometry.scale(scale,scale,scale);
    meshes.push({geometry,material:n.material});
  });
  return meshes;
}

export function createDog(asset,world,shadow){
  const root=new T.Group();
  const motion={value:0}, ticking={value:0};
  for(const {geometry,material} of bake(asset,.49)){
    const mat=material.clone();
    mat.transparent=false;
    mat.alphaTest=.32;
    mat.roughness=.82;
    mat.onBeforeCompile=shader=>{
      shader.uniforms.dogPhase=ticking;
      shader.uniforms.dogMotion=motion;
      shader.vertexShader='uniform float dogPhase; uniform float dogMotion;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`
        #include <begin_vertex>
        float feet=1.-smoothstep(.025,.236,position.y);
        float limb=dogPhase+(position.x>0.?0.:3.141593)+(position.z>-.025?0.:3.141593);
        transformed.z+=sin(limb)*feet*.087*dogMotion;
        transformed.y+=max(0.,cos(limb))*feet*.053*dogMotion;
        transformed.x+=sin(dogPhase*.62)*smoothstep(.22,.41,-position.z)*.036;
      `);
    };
    root.add(new T.Mesh(geometry,mat));
  }
  shadow(root,.52,1.1);
  world.add(root);
  root.position.set(-34.1,garageY+.07,225);
  return {root,motion,ticking,direction:1,wait:0};
}
export function moveDog(dog,dt,player){
  if(!dog)return;
  const p=dog.root.position;
  if((dog.direction>0&&p.z>236.6)||(dog.direction<0&&p.z<225)){
    dog.direction*=-1;
    dog.wait=1.35;
  }
  dog.wait=Math.max(0,dog.wait-dt);
  const moving=dog.wait===0 && p.distanceToSquared(player)>3.3;
  dog.motion.value=damp(dog.motion.value,moving?1:0,8,dt);
  dog.ticking.value+=dt*(moving?10:3);
  dog.root.rotation.y=damp(dog.root.rotation.y,dog.direction>0?0:Math.PI,8,dt);
  p.z+=dog.direction*.88*dt*dog.motion.value;
  p.y=garageY+.067;
}
