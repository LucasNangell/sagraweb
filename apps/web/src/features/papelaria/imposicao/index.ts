export {
  DEFAULT_IMPOSICAO_CONFIG,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoPaginaOrigem,
  type PapelariaImposicaoWorkStyle,
} from "./types";
export {
  clampOcupadasToGrid,
  cloneDefaultImposicaoConfig,
  configFromModeloOrDefault,
  fillGridOcupadas,
  formatImposicaoConfigJson,
  formatImposicaoVariantsJson,
  parseImposicaoConfigJson,
  parseImposicaoVariantsJson,
  resolveGridOcupadas,
  validateImposicaoConfigObject,
  variantsFromModeloOrEmpty,
  type ImposicaoOcupada,
  type PapelariaImposicaoVariante,
  type PapelariaImposicaoVariants,
} from "./imposicaoConfigUtils";
export { ImposicaoConfigEditor } from "./ImposicaoConfigEditor";
export { ImposicaoGridPreview } from "./ImposicaoGridPreview";
export {
  buildImposicaoGridLayout,
  toggleCellOcupada,
} from "./imposicaoGridLayout";
