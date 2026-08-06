/** Reexport — funções de ângulo legado removidas (effectiveClosedDeg). */
export {
  unfoldLevelProgress,
  resolveOperationProgress,
  closedAngleRad,
} from "./fold-engine/foldProgress";
export {
  defaultPanelPages as defaultSequenciaPaginas,
  normalizePanelPages as normalizeSequenciaPaginas,
  isDefaultPanelPages as sequenciaIsDefault,
} from "./fold-engine/foldPages";
export { quantizeMm } from "./fold-engine/foldNormalization";
