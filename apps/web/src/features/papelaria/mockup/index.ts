export type {
  PapelariaMockupConfig,
  PapelariaMockupFaceConfig,
  PapelariaMockupResolveInput,
  PapelariaMockupResolveResult,
} from "./types";

export {
  PAPELARIA_MOCKUP_CONFIGS,
  PAPELARIA_MOCKUP_CONFIG_LIST,
} from "./papelariaMockupConfigs";

export { getPapelariaMockupConfig } from "./getPapelariaMockupConfig";
export type { PapelariaMockupResolveResultExtended } from "./getPapelariaMockupConfig";

export {
  formatMockupConfigJson,
  MOCKUP_DEMO_PAGE_URLS,
  parseMockupConfigJson,
  validateMockupConfigObject,
} from "./mockupConfigUtils";

export {
  buildFaceTransform,
  buildSceneTransform,
  configUsesFold,
  cropToBackgroundStyle,
  faceLayoutStyle,
  normalizeCrop,
  paginasUsadas,
  resolvePageUrl,
  resolveSceneBasePx,
  sceneDimensionsPx,
} from "./mockupEngine";
