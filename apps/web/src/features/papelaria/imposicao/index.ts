export {
  DEFAULT_IMPOSICAO_CONFIG,
  DEFAULT_JDF_IMPORT_ROOT_PAPELARIA,
  DEFAULT_JDF_IMPORT_ROOT_PASTA,
  DEFAULT_JDF_IMPORT_ROOT_TIMBRADO,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoPaginaOrigem,
  type PapelariaImposicaoWorkStyle,
} from "./types";
export {
  clampOcupadasToGrid,
  cloneDefaultImposicaoConfig,
  cloneImposicaoConfigForProduto,
  configFromModeloOrDefault,
  fillGridOcupadas,
  fillGridWithPagina,
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
  paintCellOcupada,
  rotateCellOcupada,
  toggleCellOcupada,
  type ImposicaoGridFace,
} from "./imposicaoGridLayout";
