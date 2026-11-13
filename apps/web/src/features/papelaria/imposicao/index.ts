export {
  DEFAULT_IMPOSICAO_CONFIG,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoPaginaOrigem,
  type PapelariaImposicaoWorkStyle,
} from "./types";
export {
  cloneDefaultImposicaoConfig,
  configFromModeloOrDefault,
  formatImposicaoConfigJson,
  formatImposicaoVariantsJson,
  parseImposicaoConfigJson,
  parseImposicaoVariantsJson,
  validateImposicaoConfigObject,
  variantsFromModeloOrEmpty,
  type PapelariaImposicaoVariante,
  type PapelariaImposicaoVariants,
} from "./imposicaoConfigUtils";
export { ImposicaoConfigEditor } from "./ImposicaoConfigEditor";
