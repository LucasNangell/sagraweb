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
  parseImposicaoConfigJson,
  validateImposicaoConfigObject,
} from "./imposicaoConfigUtils";
