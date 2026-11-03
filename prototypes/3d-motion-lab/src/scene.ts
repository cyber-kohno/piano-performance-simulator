import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { keys, KEYBOARD_WIDTH, TRAVEL, evaluate, keyDepth } from './motion';
import type { Note } from './motion';
import { fingers, pointsForPose, restPose } from './fingers';
import type { Hand } from './fingers';
import { fitCamera } from './framing';
import { WRIST, forearmEndpoints, FULL_VIEW_MIN, FULL_VIEW_MAX } from './movement';
import type { MotionStyle } from './movement';
import type { IdleFingerStyle, StrikeStyle } from './scale-motion';

export function createScene(container: HTMLElement, detailContainer:HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101a25');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 10);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const detailRenderer=new THREE.WebGLRenderer({antialias:true});
  detailRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  detailContainer.appendChild(detailRenderer.domElement);
  const detailCameras=[new THREE.PerspectiveCamera(40,1,0.001,10),new THREE.PerspectiveCamera(40,1,0.001,10)];
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x526175, 3));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-0.2, 0.6, 0.3);
  scene.add(light);
  function box(w:number,h:number,d:number,color:string) {
    return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color, roughness:0.55}));
  }
  const base = box(KEYBOARD_WIDTH+0.025,0.025,0.18,'#26394b');
  base.position.set(0,-0.03,-0.02); scene.add(base);
  const keyMeshes = keys.map(k => {
    const mesh = box(k.width,k.height,k.length,k.black ? '#26303c' : '#edf1ee');
    mesh.position.set(k.target[0],k.target[1]-k.height/2,k.z);
    scene.add(mesh);
    return { mesh, restY: mesh.position.y, key:k };
  });
  const colors = ['#ffbd70','#63dfcf','#7faaff','#c5a0ff','#ff8ca5'];
  function makeHand(side:Hand) {
    const group=new THREE.Group(); scene.add(group);
    const palm=box(0.09,0.022,0.055,side==='left'?'#8eb0ca':'#bd937c');
    palm.position.set(0,0.028,0.075);group.add(palm);
    const digits=fingers.map((finger,i)=>{
      const segments=[box(finger===1?0.018:0.012,0.012,1,side==='left'?'#adcce0':'#d4ab92'),box(finger===1?0.017:0.011,0.011,1,side==='left'?'#adcce0':'#d4ab92')];
      segments.forEach(mesh=>group.add(mesh));
      const joints=[0,1].map(()=>{
        const joint=new THREE.Mesh(new THREE.SphereGeometry(0.007,12,8),new THREE.MeshStandardMaterial({color:side==='left'?'#7393ae':'#aa8169'}));
        group.add(joint);return joint;
      });
      const marker=new THREE.Mesh(new THREE.SphereGeometry(0.003,12,8),new THREE.MeshBasicMaterial({color:colors[i],depthTest:false}));
      marker.renderOrder=10;group.add(marker);
      return {finger,segments,joints,marker};
    });
    const targets=fingers.map(()=>{
      const target=new THREE.Mesh(new THREE.SphereGeometry(0.004,16,10),new THREE.MeshBasicMaterial({color:'#ffdc7b',wireframe:true,depthTest:false}));
      target.renderOrder=11;scene.add(target);return target;
    });
    const arm=new THREE.Group();scene.add(arm);
    const material=new THREE.MeshStandardMaterial({color:side==='left'?'#789bb8':'#b78e76',roughness:0.65});
    const forearm=new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.016,1,16),material);
    const elbow=new THREE.Mesh(new THREE.SphereGeometry(0.026,16,12),material);
    const wrist=new THREE.Mesh(new THREE.SphereGeometry(0.016,16,12),material);
    arm.add(forearm,elbow,wrist);
    return {side,group,digits,targets,arm,forearm,elbow,wrist};
  }
  const hands=[makeHand('left'),makeHand('right')];
  const segmentAxis=new THREE.Vector3(0,0,1);
  // Include raised hands and the full elbow-to-wrist guide at either end.
  const framingBounds = new THREE.Box3(
    new THREE.Vector3(...FULL_VIEW_MIN),
    new THREE.Vector3(...FULL_VIEW_MAX),
  );
  let topView = false;
  function view(top:boolean) {
    topView = top;
    // Clear residual OrbitControls damping before applying the preset.
    controls.enableDamping=false; controls.update();
    controls.target.copy(fitCamera(camera,framingBounds,top));
    controls.update(); controls.enableDamping=true;
  }
  view(false);
  const observer = new ResizeObserver(() => {
    const {width,height} = container.getBoundingClientRect();
    camera.aspect = width/Math.max(height,1); camera.updateProjectionMatrix();
    renderer.setSize(width,height);
    view(topView);
  });
  observer.observe(container);
  let detailWidth=0,detailHeight=0;
  const detailObserver=new ResizeObserver(()=>{
    const {width,height}=detailContainer.getBoundingClientRect();
    detailWidth=Math.floor(width);detailHeight=Math.floor(height);
    if(width>0&&height>0)detailRenderer.setSize(detailWidth,detailHeight);
  });
  detailObserver.observe(detailContainer);
  return {
    view,
    draw(notes:Note[],time:number,debug:boolean,manualAngles?:Record<Hand,number[]>,style:MotionStyle='smooth',showForearms=true,idleStyle:IdleFingerStyle='connected',strikeStyle:StrikeStyle='smooth',wristMotion=false) {
      const frame = evaluate(manualAngles?[]:notes,time,style,idleStyle,strikeStyle,wristMotion);
      hands.forEach(({side,group,digits,targets,arm,forearm,elbow,wrist})=>{
        const pose=frame[side];
        group.rotation.set(...pose.rotation);
        const pivot=new THREE.Vector3(...WRIST);
        const offset=pivot.clone().sub(pivot.clone().applyQuaternion(group.quaternion));
        group.position.fromArray(pose.position).add(offset);
        const endpoints=forearmEndpoints(pose.position,side,pose.forearmGuide);
        const wristPosition=new THREE.Vector3(...endpoints.wrist),elbowPosition=new THREE.Vector3(...endpoints.elbow);
        const direction=elbowPosition.clone().sub(wristPosition);
        arm.visible=showForearms;
        wrist.position.copy(wristPosition);elbow.position.copy(elbowPosition);
        forearm.position.copy(wristPosition).add(elbowPosition).multiplyScalar(0.5);
        forearm.scale.y=direction.length();
        forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
        if(manualAngles)for(const finger of fingers)pose.joints[finger]=restPose(finger,manualAngles[side][finger-1]*Math.PI/180);
        digits.forEach(({finger,segments,joints,marker})=>{
          const points=pointsForPose(side,finger,pose.joints[finger]).map(p=>new THREE.Vector3(...p));
          segments.forEach((mesh,i)=>{
            const direction=points[i+1].clone().sub(points[i]);
            mesh.position.copy(points[i]).add(points[i+1]).multiplyScalar(0.5);
            mesh.scale.z=direction.length();mesh.quaternion.setFromUnitVectors(segmentAxis,direction.normalize());
            joints[i].position.copy(points[i]);
          });
          marker.position.copy(points[2]);marker.visible=debug;
          marker.scale.setScalar(pose.activeNotes.some(n=>n.finger===finger)?1.5:1);
        });
        targets.forEach((target,index)=>{
          const note=pose.activeNotes[index];target.visible=debug&&!!note;
          if(note){target.position.fromArray(pose.targets[index]);target.position.y-=(pose.depths?.[index]??pose.depth)*TRAVEL;}
        });
      });
      keyMeshes.forEach(({mesh,restY,key}) => {
        const depth=Math.max(keyDepth(frame.left,key.midiNote),keyDepth(frame.right,key.midiNote));
        mesh.position.y = restY-depth*TRAVEL;
        mesh.material.color.set(depth>0 ? '#5ed9c3' : key.black ? '#26303c' : '#edf1ee');
      });
      controls.update(); renderer.render(scene,camera);
      if(detailWidth>0&&detailHeight>0) {
        detailRenderer.setScissorTest(true);
        hands.forEach(({side},i)=>{
          hands.forEach(h=>{
            h.group.visible=h.side===side;
            h.arm.visible=showForearms&&h.side===side;
            h.targets.forEach((t,index)=>{t.visible=h.side===side&&debug&&!!frame[h.side].activeNotes[index];});
          });
          const x=Math.floor(i*detailWidth/2),width=Math.floor((i+1)*detailWidth/2)-x;
          const detailCamera=detailCameras[i];detailCamera.aspect=width/detailHeight;
          const p=new THREE.Vector3(...frame[side].position);
          const bounds=new THREE.Box3(p.clone().add(new THREE.Vector3(-0.10,-0.04,-0.065)),p.clone().add(new THREE.Vector3(0.10,0.09,0.15)));
          fitCamera(detailCamera,bounds,false);
          detailRenderer.setViewport(x,0,width,detailHeight);detailRenderer.setScissor(x,0,width,detailHeight);
          detailRenderer.render(scene,detailCamera);
        });
        hands.forEach(h=>{h.group.visible=true;h.arm.visible=showForearms;h.targets.forEach((t,index)=>{t.visible=debug&&!!frame[h.side].activeNotes[index];});});
        detailRenderer.setScissorTest(false);
      }
    },
    dispose() {
      observer.disconnect(); detailObserver.disconnect();controls.dispose();
      scene.traverse(object => { if (object instanceof THREE.Mesh) {object.geometry.dispose(); const materials=Array.isArray(object.material)?object.material:[object.material]; materials.forEach(m=>m.dispose());} });
      renderer.dispose(); renderer.domElement.remove();
      detailRenderer.dispose();detailRenderer.domElement.remove();
    },
  };
}
