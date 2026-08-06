import * as THREE from "three";

export type ColorMode = "faithful" | "studio";

export function configureRenderer(
  renderer: THREE.WebGLRenderer,
  mode: ColorMode,
): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (mode === "faithful") {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
  } else {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
  }
}

export function addStudioLights(
  scene: THREE.Scene,
  maxDim: number,
): THREE.Light[] {
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(maxDim * 0.55, maxDim * 0.9, maxDim * 0.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-maxDim * 0.6, maxDim * 0.3, maxDim * 0.4);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25);
  rim.position.set(0, maxDim * 0.2, -maxDim);
  const amb = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(key, fill, rim, amb);
  return [key, fill, rim, amb];
}
