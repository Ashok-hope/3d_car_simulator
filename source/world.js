import * as T from 'three';
import { garagePoint, garageWalls } from './region.js';
export const bayPositions=[
  [-5.9,-4.75],[-5.9,-.95],[-5.9,2.85],[-5.9,6.1],[5.9,-4.75],[5.9,-.95],[5.9,2.85]
];
const surface=color=>new T.MeshStandardMaterial({color,roughness:.9});
const asphalt=surface(0x42474a);
const boxGeo=new T.BoxGeometry();
export function box(parent, width, height, length, x, y, z, material) {
  const mesh = new T.Mesh(boxGeo, material);
  mesh.position.set(x,y,z);
  mesh.scale.set(width,height,length);
  parent.add(mesh);
  return mesh;
}

export function garagePlace(model) {
  const g = new T.Group();
  g.position.copy(garagePoint);
  openGarageEntrance(model);
  g.add(model);
  const border = surface(0xce9a42);
  for (const [x,z] of bayPositions) {
    const side = Math.sign(x);
    for (const dz of [-1.54,1.54]) box(g,5.58,.016,.045,x,.022,z+dz,border);
    box(g,.06,.015,3.07,x+side*2.78,.022,z,border);
  }
  // Keep the driveway tied into the city loop at the garage's open end.
  box(g,8,.16,10,0,-.115,13.4,asphalt);
  const label = document.createElement('canvas');
  label.width=768; label.height=128;
  const ctx=label.getContext('2d');
  ctx.fillStyle='#192321';ctx.fillRect(0,0,768,128);
  ctx.fillStyle='#ffc566';ctx.font='800 63px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('WEST STREET GARAGE',384,66);
  const texture = new T.CanvasTexture(label);
  texture.colorSpace=T.SRGBColorSpace;
  const sign=new T.Mesh(new T.PlaneGeometry(7.2,1.2),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));
  sign.position.set(0,4.95,10.65); g.add(sign);
  const {x,z}=garagePoint;
  for(const [a,b,c,d] of [[-10,-9.35,-8,11],[9.35,10,-8,11],[-10,10,-8.2,-7.65],[-10,-3.8,7.3,10.6],[3.8,10,7.3,10.6]]) garageWalls.push([x+a,x+b,z+c,z+d]);
  return g;
}

function openGarageEntrance(model) {
  model.updateMatrixWorld(true);
  // Subtract a doorway from the existing wall and shutter geometry, preserving the original wall UVs.
  const planes=[[0,-3.8,1],[0,3.8,-1],[1,.035,1],[1,4.15,-1],[2,6.8,1],[2,10.7,-1]];
  const point=new T.Vector3();
  model.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible||/ground/i.test(mesh.material.name)) return;
    const input=mesh.geometry;
    const attributes=Object.entries(input.attributes);
    const stride=attributes.reduce((sum,[,a])=>sum+a.itemSize,0);
    const getVertex=index=>{
      const values=attributes.flatMap(([,a])=>Array.from({length:a.itemSize},(_,i)=>a.getComponent(index,i)));
      const xyz=point.fromBufferAttribute(input.attributes.position,index).applyMatrix4(mesh.matrixWorld).toArray();
      return [...xyz,...values];
    };
    const vertices=Array.from({length:input.attributes.position.count},(_,i)=>getVertex(i));
    const idx=input.index?.array;
    const count=idx?.length??vertices.length;
    const out=[];
    for(let i=0;i<count;i+=3){
      let polygon=[vertices[idx?idx[i]:i],vertices[idx?idx[i+1]:i+1],vertices[idx?idx[i+2]:i+2]];
      for(const [axis,value,direction] of planes) {
        if(!polygon.length) break;
        const inside=[],outside=[];
        let a=polygon.at(-1);
        for(const b of polygon){
          const da=(a[axis]-value)*direction, db=(b[axis]-value)*direction;
          if((da<0)!==(db<0)){
            const t=da/(da-db);
            const cut=a.map((n,j)=>n+(b[j]-n)*t);
            inside.push(cut);outside.push(cut);
          }
          (db<0?outside:inside).push(b);
          a=b;
        }
        for(let j=1;j<outside.length-1;j++) out.push(outside[0],outside[j],outside[j+1]);
        polygon=inside;
      }
    }
    if(!out.length){mesh.visible=false;return;}
    const output=new T.BufferGeometry();
    let offset=3;
    for(const [key,attribute] of attributes){
      const data=new Float32Array(out.length*attribute.itemSize);
      out.forEach((vertex,i)=>{for(let j=0;j<attribute.itemSize;j++) data[i*attribute.itemSize+j]=vertex[offset+j];});
      output.setAttribute(key,new T.BufferAttribute(data,attribute.itemSize));
      offset+=attribute.itemSize;
    }
    mesh.geometry=output;
  });
}

