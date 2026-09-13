import * as T from './vendor/three.module.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)), ease=v=>{v=clamp(v);return v*v*(3-2*v);};
const vec=(x,y,z)=>new T.Vector3(x,y,z), UP=vec(0,1,0);

export class FlyScene {
  constructor(canvas,{reduced=false,onError=()=>{}}={}) {
    this.canvas=canvas;this.reduced=reduced;this.onError=onError;this.visible=true;this.paused=false;this.mode='idle';
    this.time=0;this.lastFrame=0;this.frameId=0;this.active=0;this.action=null;this.count=13;this.resources=new Set();
    this.scene=new T.Scene();this.scene.background=new T.Color('#0a2020');
    this.camera=new T.PerspectiveCamera(37,1,.1,30);this.camera.position.set(3.05,3.12,5.15);this.camera.lookAt(0,1.03,.12);
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(1.5,globalThis.devicePixelRatio||1));this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.3;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.scene.add(new T.HemisphereLight(0xd6fff0,0x34240b,2.2));
    const key=new T.DirectionalLight(0xffead2,3.7);key.position.set(-2.8,5,3);key.castShadow=true;key.shadow.mapSize.set(512,512);
    Object.assign(key.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:12});key.shadow.bias=-.0015;this.scene.add(key);
    const rim=new T.DirectionalLight(0x91e7d0,2.6);rim.position.set(2.8,3,-3);this.scene.add(rim);
    this.materials={
      body:this.material({color:0x846341,roughness:.65,metalness:.05}),dark:this.material({color:0x3d3022,roughness:.8}),
      leg:this.material({color:0x61472e,roughness:.55}),joint:this.material({color:0x9b7847,roughness:.45}),
      felt:this.material({color:0x245b49,roughness:.95}),rail:this.material({color:0x152f2b,roughness:.7}),
      brass:this.material({color:0xd3ad6c,metalness:.55,roughness:.4}),cream:this.material({color:0xffe5b0,roughness:.35}),
      wing:this.material({color:0xd9f3e8,roughness:.22,metalness:.12,transparent:true,opacity:.44,side:T.DoubleSide,depthWrite:false}),
      eye:new T.MeshPhongMaterial({color:0xffb14f,map:this.eyeTexture(),shininess:80,specular:0xffdba8}),
      lamp:this.material({color:0xd4ffb1,emissive:0x9bcf87,emissiveIntensity:.4,roughness:.4})
    };
    this.geometries={sphere:this.geometry(new T.SphereGeometry(1,24,18)),cylinder:this.geometry(new T.CylinderGeometry(1,1,1,10)),box:this.geometry(new T.BoxGeometry(1,1,1))};
    this.floor=this.mesh(this.geometries.cylinder,this.material({color:0x12352e,roughness:1}),[0,.0,.0],[2.7,.1,2.7]);this.floor.receiveShadow=true;
    this.table=new T.Group();this.scene.add(this.table);
    this.mesh(this.geometries.box,this.materials.rail,[0,.54,.22],[3.9,.22,2.38],this.table);
    const felt=this.mesh(this.geometries.box,this.materials.felt,[0,.665,.22],[3.69,.035,2.17],this.table);felt.receiveShadow=true;
    for(const x of [-1.78,1.78])this.mesh(this.geometries.box,this.materials.brass,[x,.69,.22],[.015,.01,1.95],this.table);
    for(const z of [-.78,1.22])this.mesh(this.geometries.box,this.materials.brass,[0,.69,z],[3.55,.01,.015],this.table);
    for(const x of [-1.45,1.45])this.mesh(this.geometries.cylinder,this.materials.rail,[x,.25,.7],[.10,.5,.10],this.table);
    this.mesh(this.geometries.cylinder,this.materials.rail,[0,.28,-.88],[.63,.16,.52]);
    this.mesh(this.geometries.cylinder,this.materials.brass,[0,.14,-.88],[.09,.28,.09]);
    this.fly=new T.Group();this.fly.position.set(0,0,-.72);this.scene.add(this.fly);
    this.buildFly();
    this.backMaterial=new T.MeshStandardMaterial({map:this.cardTexture(),roughness:.78});this.resources.add(this.backMaterial);
    this.edgeMaterial=this.material({color:0xece3c9,roughness:.95});
    this.cardGeometry=this.geometry(new T.BoxGeometry(.235,.009,.35));
    this.cardsRoot=new T.Group();this.scene.add(this.cardsRoot);this.publicRoot=new T.Group();this.scene.add(this.publicRoot);
    this.cards=[];this.publicCards=[];this.setCount(13);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
    this.contextLost=event=>{event.preventDefault();this.onError();};canvas.addEventListener('webglcontextlost',this.contextLost);
    this.tick=this.tick.bind(this);this.wake();
  }
  geometry(g){this.resources.add(g);return g;}
  material(spec){const m=new T.MeshStandardMaterial(spec);this.resources.add(m);return m;}
  mesh(geometry,material,position,scale,parent=this.scene){const m=new T.Mesh(geometry,material);m.position.set(...position);m.scale.set(...scale);m.castShadow=true;parent.add(m);return m;}
  sphere(position,scale,material,parent=this.fly){return this.mesh(this.geometries.sphere,material,position,scale,parent);}
  texture(canvas){const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.resources.add(texture);return texture;}
  eyeTexture(){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const c=canvas.getContext('2d');
    c.fillStyle='#ef7d20';c.fillRect(0,0,256,256);
    for(let row=-1;row<13;row++)for(let col=-1;col<13;col++){
      const x=col*24+(row%2)*12,y=row*21;c.beginPath();for(let i=0;i<6;i++){const a=Math.PI/3*i; i?c.lineTo(x+12*Math.cos(a),y+12*Math.sin(a)):c.moveTo(x+12*Math.cos(a),y+12*Math.sin(a));}c.closePath();
      c.fillStyle=['#f29230','#f6a445','#e97d25'][(row+col+30)%3];c.fill();c.strokeStyle='#d3692455';c.lineWidth=1.4;c.stroke();
    }
    return this.texture(canvas);
  }
  cardTexture(id){
    const canvas=document.createElement('canvas');canvas.width=192;canvas.height=288;const c=canvas.getContext('2d');
    c.fillStyle=id===undefined?'#183e35':'#fff8e7';c.fillRect(0,0,192,288);c.strokeStyle=id===undefined?'#baad75':'#d8cbb3';c.lineWidth=5;c.strokeRect(10,10,172,268);
    if(id===undefined){
      c.save();c.beginPath();c.rect(18,18,156,252);c.clip();c.strokeStyle='#789b7666';c.lineWidth=1.4;
      for(let k=-290;k<400;k+=19){c.beginPath();c.moveTo(k,0);c.lineTo(k+288,288);c.stroke();c.beginPath();c.moveTo(k,288);c.lineTo(k+288,0);c.stroke();}
      c.restore();c.fillStyle='#163b31';c.beginPath();c.arc(96,144,42,0,Math.PI*2);c.fill();c.strokeStyle='#c7b781';c.lineWidth=2;c.stroke();
      c.fillStyle='#e3d2a0';c.font='58px Georgia';c.textAlign='center';c.fillText('♠',96,164);
    }else{
      const rank=Math.floor(id/4)+3,name=({11:'J',12:'Q',13:'K',14:'A',15:'2'})[rank]||String(rank),suit=['♠','♥','♣','♦'][id%4];
      c.fillStyle=id%4===1||id%4===3?'#b54231':'#16392f';c.font='bold 45px Georgia';c.textAlign='left';c.fillText(name,22,59);c.font='37px Georgia';c.fillText(suit,22,98);
      c.font='82px Georgia';c.textAlign='center';c.fillText(suit,96,190);
      c.save();c.translate(192,288);c.rotate(Math.PI);c.font='bold 36px Georgia';c.textAlign='left';c.fillText(name,20,50);c.restore();
    }
    return this.texture(canvas);
  }
  line(points,color,parent,width=1){const geometry=this.geometry(new T.BufferGeometry().setFromPoints(points.map(p=>vec(...p)))),material=new T.LineBasicMaterial({color,transparent:true,opacity:.7,linewidth:width});this.resources.add(material);const line=new T.Line(geometry,material);parent.add(line);return line;}
  bone(parent,radius=.028){const mesh=this.mesh(this.geometries.cylinder,this.materials.leg,[0,0,0],[radius,1,radius],parent);mesh.userData.radius=radius;return mesh;}
  join(mesh,a,b){const direction=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(UP,direction.clone().normalize());mesh.scale.set(mesh.userData.radius,direction.length(),mesh.userData.radius);}
  buildFly(){
    this.sphere([0,1.12,-.06],[.34,.49,.29],this.materials.body);
    this.sphere([0,.91,-.27],[.32,.47,.27],this.materials.dark);
    for(let i=0;i<5;i++){const y=.6+i*.135,r=.19+.085*Math.sin(i/4*Math.PI);const ring=this.mesh(this.geometry(new T.TorusGeometry(r,.036,8,32)),this.materials.body,[0,y,-.26],[1,1,.88],this.fly);ring.rotation.x=Math.PI/2;}
    this.neck=new T.Group();this.neck.position.set(0,1.56,.12);this.fly.add(this.neck);
    this.sphere([0,.22,0],[.39,.31,.32],this.materials.body,this.neck);
    for(const side of [-1,1]){
      const eye=this.sphere([side*.265,.23,.19],[.237,.279,.22],this.materials.eye,this.neck);eye.rotation.y=side*.22;
      this.sphere([side*.21,.39,.35],[.045,.055,.022],this.materials.cream,this.neck);
      this.sphere([side*.075,.02,.305],[.06,.10,.07],this.materials.joint,this.neck);
    }
    this.sphere([0,-.035,.35],[.037,.08,.06],this.materials.dark,this.neck);
    this.antennas=[];
    for(const side of [-1,1]){
      const antenna=new T.Group();antenna.position.set(side*.095,.455,.10);this.neck.add(antenna);
      const points=[[0,0,0],[side*.075,.17,-.005],[side*.14,.27,.04],[side*.17,.28,.10]];
      this.line(points,0xb79554,antenna);this.sphere(points.at(-1),[.025,.045,.025],this.materials.lamp,antenna);this.antennas.push(antenna);
    }
    this.wings=[];
    for(const side of [-1,1]){
      const wing=new T.Group();wing.position.set(side*.17,1.42,-.19);this.fly.add(wing);
      const shape=new T.Shape();shape.moveTo(0,0);shape.bezierCurveTo(side*.28,.14,side*1.03,.20,side*1.16,.69);shape.bezierCurveTo(side*1.17,.99,side*.65,1.09,side*.37,.69);shape.bezierCurveTo(side*.15,.34,side*.02,.10,0,0);
      this.mesh(this.geometry(new T.ShapeGeometry(shape,24)),this.materials.wing,[0,0,0],[1,1,1],wing).castShadow=false;
      for(const branch of [.28,.5,.75,1])this.line([[0,0,.008],[side*.35,.25,.008],[side*(.50+.55*branch),.42+.4*branch,.008]],0xc5c895,wing);
      this.line([[side*.18,.18,.01],[side*.40,.55,.01],[side*.73,.87,.01]],0xd3cc99,wing);
      wing.rotation.y=side*-.42;this.wings.push(wing);
    }
    // Sparse bristles preserve the insect silhouette without a heavy hair mesh.
    for(let i=0;i<18;i++){
      const a=i*2.39996,y=.95+(i%6)*.095,x=Math.sin(a)*.29,z=Math.cos(a)*.25;
      this.line([[x,y,z],[x*1.17,y+.11,z*1.18]],0x4d3925,this.fly);
    }
    this.limbs=[];
    for(let row=0;row<3;row++)for(const side of [-1,1]){
      const limb={row,side,upper:this.bone(this.fly,row? .025:.033),lower:this.bone(this.fly,row?.021:.027),elbow:this.sphere([0,0,0],[.052,.052,.052],this.materials.joint),tip:new T.Group()};
      this.fly.add(limb.tip);
      for(const bend of [-1,1])this.line([[0,0,0],[side*.025,-.005,.075],[side*.02+bend*.025,0,.11]],0x62462b,limb.tip);
      this.limbs.push(limb);
    }
  }
  makeBack(){const materials=[this.edgeMaterial,this.edgeMaterial,this.backMaterial,this.backMaterial,this.edgeMaterial,this.edgeMaterial];const m=new T.Mesh(this.cardGeometry,materials);m.castShadow=true;m.receiveShadow=true;return m;}
  setCount(count){
    if(this.cards.length===count)return;
    this.cardsRoot.clear();this.cards=[];this.count=count;
    for(let i=0;i<count;i++){
      const m=this.makeBack(),x=(i-(count-1)/2)*Math.min(.245,2.85/Math.max(1,count-1)),z=.14+Math.abs(x)*.05;
      m.position.set(x,.704+i*.0004,z);m.rotation.y=-x*.025;m.userData.base=m.position.clone();this.cardsRoot.add(m);this.cards.push(m);
    }
  }
  setPublic(cards,actor){
    for(const m of this.publicCards){m.userData.face.map.dispose();this.resources.delete(m.userData.face.map);m.userData.face.dispose();this.resources.delete(m.userData.face);}
    this.publicRoot.clear();this.publicCards=[];this.revealStarted=performance.now();
    const spread=Math.min(.255,2.7/Math.max(1,cards.length-1));
    cards.forEach((id,i)=>{
      const face=new T.MeshStandardMaterial({map:this.cardTexture(id),roughness:.8});this.resources.add(face);
      const m=new T.Mesh(this.cardGeometry,[this.edgeMaterial,this.edgeMaterial,face,this.backMaterial,this.edgeMaterial,this.edgeMaterial]);
      m.position.set((i-(cards.length-1)/2)*spread,.72+i*.0005,actor===1?.88:1.07);m.userData={face,id,base:m.position.clone()};m.castShadow=true;
      this.publicRoot.add(m);this.publicCards.push(m);
    });
  }
  sync(state){this.mode=state.mode;this.paused=state.paused;this.setCount(state.count);if(this.publicCards.length!==state.cards.length||this.publicCards.some((m,i)=>m.userData.id!==state.cards[i]))this.setPublic(state.cards,state.actor);this.wake();}
  reset(state){this.cancelAction();this.setPublic([],null);this.sync(state);this.neural(0);}
  beginAction(count,duration){
    this.action={count,duration,started:performance.now(),indices:this.cards.map((_,i)=>i).sort((a,b)=>Math.abs(a-(this.cards.length-1)/2)-Math.abs(b-(this.cards.length-1)/2)).slice(0,count)};this.wake();
  }
  cancelAction(){this.action=null;for(const card of this.cards){card.position.copy(card.userData.base);card.rotation.z=0;card.scale.set(1,1,1);}this.wake();}
  commit({actor,cards,pass,count}){this.action=null;this.setCount(count);if(!pass)this.setPublic(cards,actor);this.wake();}
  neural(active){this.active=clamp(active/138639);this.wake();}
  visibility(value){this.visible=value;this.wake();}
  resize(){
    const rect=this.canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
    this.renderer.setSize(Math.round(rect.width),Math.round(rect.height),false);this.camera.aspect=rect.width/rect.height;
    this.camera.fov=37;this.camera.position.set(1.55,2.65,4.35);
    this.camera.lookAt(0,1.40,.04);this.camera.updateProjectionMatrix();this.wake();
  }
  wake(){if(this.disposed||this.frameId||!this.visible||this.paused)return;this.frameId=requestAnimationFrame(now=>this.tick(now));}
  pose(now){
    const t=this.reduced?0:this.time,win=this.mode==='win',lose=this.mode==='lose',thinking=this.mode==='thinking';
    const dance=win&&!this.reduced?Math.sin(t*6.6):0,breath=this.reduced?0:Math.sin(t*1.7)*.015;
    this.fly.position.set(win?dance*.15:0,win?Math.abs(dance)*.095:lose?-.08:breath,-.72);
    this.fly.rotation.set(lose?.11:0,win?Math.sin(t*3.3)*.16:0,win?dance*.07:0);
    let gaze=vec(thinking?Math.sin(t*.8)*.85:Math.sin(t*.35)*.12,.72,thinking?.17:.91),selectedTip=null,pushing=false;
    for(const m of this.cards){m.position.copy(m.userData.base);m.rotation.z=0;}
    if(this.action){
      const a=this.action,elapsed=now-a.started,p=rootMotion().actionPose(a.count,elapsed,this.reduced);
      if(a.count){
        a.indices.forEach((index,order)=>{
          const card=this.cards[index];if(!card)return;
          const picked=this.reduced?1:ease((elapsed-200-order*160)/160),push=ease(p.push);
          card.position.y+=.08*picked+Math.sin(push*Math.PI)*.025;card.position.z+=.14*picked+.51*push;card.position.x+=(order-(a.count-1)/2)*.01*push;
          card.rotation.z=Math.sin(picked*Math.PI)*.09;
        });
        const current=this.cards[a.indices[p.index]];
        if(current){gaze=current.position.clone();selectedTip=gaze.clone();selectedTip.y+=.025;selectedTip.z-=.055;}
        pushing=p.push>0;
      }else gaze=vec(.3,.75,.8);
    }
    const neckPos=vec(0,1.76,-.47),delta=gaze.clone().sub(neckPos);
    this.neck.rotation.y=lose?-.10:win?dance*.08:clamp(Math.atan2(delta.x,delta.z)*.35,-.3,.3);
    this.neck.rotation.x=lose?.76:win?-.08:.20+Math.min(.26,Math.atan2(-delta.y,Math.abs(delta.z))*.2);
    this.neck.rotation.z=lose?-.13:thinking?Math.sin(t*.6)*.035:0;
    this.wings.forEach((wing,i)=>{const side=i===0?-1:1;wing.rotation.z=side*(lose?-.48:win?.15+Math.sin(t*13)*.23:Math.sin(t*2.7)*.025);wing.rotation.x=lose?.28:win?-.12:.08;});
    this.antennas.forEach((antenna,i)=>{antenna.rotation.z=(i===0?-1:1)*(lose?.35:win?.12:.025*Math.sin(t*1.9+i));});
    for(const limb of this.limbs){
      const {side,row}=limb;let shoulder,elbow,tip;
      if(row===0){
        shoulder=vec(side*.28,1.32,.10);tip=vec(side*.51,.765,.82);elbow=vec(side*.65,1.03,.43);
        if(thinking&&!this.action){tip.x+=Math.sin(t*.8+side)*.055;tip.z+=Math.sin(t*.7)*.035;}
        if(selectedTip&&(side===Math.sign(selectedTip.x||1)||pushing)){tip=selectedTip.clone();tip.z+=.72;elbow=shoulder.clone().lerp(tip,.53);elbow.x+=side*.20;elbow.y+=.16;}
        if(win){tip=vec(side*(.58+Math.sin(t*6.6+side)*.12),1.92+Math.cos(t*6.6+side)*.12,.33);elbow=vec(side*.65,1.50,.30);}
        if(lose){tip=vec(side*.35,.72,.72);elbow=vec(side*.49,1.02,.37);}
        if(this.action?.count===0){tip.x+=side*.22;tip.y+=Math.sin(clamp((now-this.action.started)/this.action.duration)*Math.PI)*.24;}
      }else if(row===1){shoulder=vec(side*.27,1.03,-.02);elbow=vec(side*.70,.85,.12);tip=vec(side*.92,.71,.38);if(win)tip.y+=Math.max(0,Math.sin(t*6.6+side))*.17;}
      else {shoulder=vec(side*.23,.85,-.29);elbow=vec(side*.52,.61,-.50);tip=vec(side*.63,.40,-.17);if(win)tip.x+=dance*side*.13;}
      this.join(limb.upper,shoulder,elbow);this.join(limb.lower,elbow,tip);limb.elbow.position.copy(elbow);limb.tip.position.copy(tip);
    }
    this.materials.lamp.emissiveIntensity=.20+this.active*3.5;
    for(const m of this.publicCards){const p=this.reduced?1:ease((now-this.revealStarted)/280);m.rotation.z=(1-p)*Math.PI;m.position.y=m.userData.base.y+Math.sin(p*Math.PI)*.16;}
  }
  tick(now){
    this.frameId=0;if(this.disposed||!this.visible||this.paused)return;
    const interval=this.reduced?150:33;
    if(now-this.lastFrame>=interval){this.time+=Math.min(.12,(now-(this.lastFrame||now))/1000);this.lastFrame=now;try{this.pose(now);this.renderer.render(this.scene,this.camera);}catch{this.onError();return;}}
    this.wake();
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;if(this.frameId)cancelAnimationFrame(this.frameId);this.resizeObserver?.disconnect();this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    for(const resource of this.resources)resource.dispose?.();this.materials.eye.dispose();this.renderer.dispose();
  }
}
function rootMotion(){return globalThis.PokerMotion;}
