import * as THREE from "three";

export function fitCameraToSphere(
  camera: THREE.PerspectiveCamera,
  sphere: THREE.Sphere,
  aspect: number,
  padding = 1.2,
): void {
  const fov = (camera.fov * Math.PI) / 180;
  const distH =
    (sphere.radius * padding) / Math.sin(fov / 2) / Math.max(0.2, aspect);
  const distV = (sphere.radius * padding) / Math.sin(fov / 2);
  camera.position.z = Math.max(distH, distV);
  camera.near = Math.max(0.1, camera.position.z / 200);
  camera.far = camera.position.z * 20;
  camera.updateProjectionMatrix();
}

export function contentBoundingSphere(
  content: THREE.Object3D,
): THREE.Sphere {
  const box = new THREE.Box3().setFromObject(content);
  const sphere = new THREE.Sphere();
  if (box.isEmpty()) {
    sphere.center.set(0, 0, 0);
    sphere.radius = 100;
    return sphere;
  }
  box.getBoundingSphere(sphere);
  return sphere;
}
