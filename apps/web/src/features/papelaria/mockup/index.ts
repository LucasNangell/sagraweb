export type {
  PapelariaMockupBolsoConfig,
  PapelariaMockupConfig,
  PapelariaMockupFaceConfig,
  PapelariaMockupResolveInput,
  PapelariaMockupResolveResult,
} from "./types";

export {
  aplicarBolsoPadrao,
  BOLSO_PASTA_AVULSO,
  produtoTemBolso,
  resolverBolso,
} from "./bolsoInterno";

export {
  PAPELARIA_MOCKUP_CONFIGS,
  PAPELARIA_MOCKUP_CONFIG_LIST,
} from "./papelariaMockupConfigs";

export {
  escolherPresetPorPaginas,
  getPapelariaMockupConfig,
  mockupConfigMatchesRequest,
} from "./getPapelariaMockupConfig";
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
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW,
  resolvePageUrl,
  resolveSceneBasePx,
  sceneDimensionsPx,
} from "./mockupEngine";
