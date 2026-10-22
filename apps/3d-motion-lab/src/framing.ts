import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three';

// Fit every corner in perspective space, including the near side of the keyboard.
export function fitCamera(camera: PerspectiveCamera, bounds: Box3, top: boolean) {
  const center = bounds.getCenter(new Vector3());
  const backward = new Vector3(0, top ? 1 : 0.85, top ? 0 : 1).normalize();
  camera.up.set(0, top ? 0 : 1, top ? -1 : 0);
  camera.position.copy(center).add(backward);
  camera.lookAt(center);
  const inverse = camera.quaternion.clone().invert();
  const tanY = Math.tan(MathUtils.degToRad(camera.fov / 2)) * 0.9;
  const tanX = tanY * camera.aspect;
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new Vector3(x,y,z).sub(center).applyQuaternion(inverse);
        distance = Math.max(distance, corner.z + Math.abs(corner.x)/tanX, corner.z + Math.abs(corner.y)/tanY);
      }
    }
  }
  camera.position.copy(center).addScaledVector(backward, distance + camera.near);
  camera.far = Math.max(10, distance + bounds.getSize(new Vector3()).length()*2);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return center;
}
