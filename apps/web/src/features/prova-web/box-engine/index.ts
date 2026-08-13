export {
  createBoxScene,
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  MAX_ROT_X,
  ORBIT_SENS_X,
  ORBIT_SENS_Y,
  type BoxSceneHandle,
} from "./boxSceneThree";
export { createGraphBoxScene } from "./boxGraphScene";
export { boxMockupFromConfig } from "./boxMockupFromConfig";
export {
  boxDiagonalMm,
  flapAngleDeg,
  resolveFlapProgress,
  type BoxHinge,
  type BoxPanelDef,
} from "./boxTypes";
export {
  childAttachOffsets,
  hingeAxisScene,
  hingeOriginScene,
  hingeSegmentFromLegacy,
  netMmToScene,
  netUv,
  rotateAroundAxis,
  easeInOutCubic,
} from "./boxKinematics";
