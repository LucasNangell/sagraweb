export type {
  ActiveDynamicFieldPlacement,
  PapelariaPreviewConfig,
  PapelariaPreviewDynamicFieldTemplate,
  PapelariaPreviewFace,
  PapelariaPreviewFaceMeta,
  PapelariaPreviewTextElement,
  PreviewPositionSlotId,
} from "./types";
export { CAMPOS_DINAMICOS_LAYOUT_KEY } from "./types";
export { applyPreviewTemplate, isDerivedPreviewVariable } from "./templateEngine";
export { resolveSvgTextPosition, splitMultilineText } from "./textAlignment";
export {
  formatPreviewConfigJson,
  parsePreviewConfigJson,
  validatePreviewConfigObject,
} from "./previewConfigUtils";
export {
  extractFieldKeysFromFace,
  extractFieldKeysFromTemplate,
  groupFieldsByFace,
  type FaceFieldGroup,
} from "./groupFieldsByFace";
export {
  PREVIEW_POSITION_SLOTS,
  defaultSlotForTemplate,
  isPreviewPositionSlotId,
  nearestPreviewPositionSlot,
  slotToElementRect,
} from "./positionSlots";
export {
  applyDynamicFieldsToConfig,
  buildInitialPreviewConfigFromInspect,
  normalizeInspectCampos,
  buildInitialPreviewConfigFromVariaveis,
  buildRuntimePreviewConfig,
  COMMON_DYNAMIC_FIELD_TEMPLATES,
  getGroupedElementIds,
  getGroupedTemplateIds,
  getTemplateAllowedSlots,
  mergeDadosWithDynamicLayout,
  moveActiveFieldsToSlot,
  moveElementsToSlot,
  parseDynamicFieldsLayout,
  serializeDynamicFieldsLayout,
  templateId,
  templateToElement,
} from "./dynamicFields";
