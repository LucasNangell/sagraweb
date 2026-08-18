import { describe, expect, it } from "vitest";

import {
  capPortalMockupSceneBasePx,
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW,
} from "./mockupEngine";

describe("capPortalMockupSceneBasePx", () => {
  it("usa teto 280 no viewport largo e não ultrapassa o fitted menor", () => {
    expect(capPortalMockupSceneBasePx(960, false)).toBe(PAPELARIA_MOCKUP_SCENE_BASE_PX);
    expect(capPortalMockupSceneBasePx(200, false)).toBe(200);
    expect(capPortalMockupSceneBasePx(PAPELARIA_MOCKUP_SCENE_BASE_PX, false)).toBe(
      PAPELARIA_MOCKUP_SCENE_BASE_PX,
    );
  });

  it("usa teto 220 no viewport estreito e não ultrapassa o fitted menor", () => {
    expect(capPortalMockupSceneBasePx(960, true)).toBe(PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW);
    expect(capPortalMockupSceneBasePx(180, true)).toBe(180);
    expect(capPortalMockupSceneBasePx(PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW, true)).toBe(
      PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW,
    );
  });
});
