import { describe, expect, it } from "vitest";

import { toBalloonHtml } from "./analiseLabBalloonHtml";

describe("toBalloonHtml", () => {
  it("strips inline styles and classes while keeping structure", () => {
    const html = toBalloonHtml(
      `<style>.x{color:red}</style><p class="foo" style="color:red">Olá<br/>mundo</p><font color="blue">x</font>`,
      "Título",
    );
    expect(html).toContain("<p>");
    expect(html).toContain("<br");
    expect(html.toLowerCase()).not.toContain("style=");
    expect(html.toLowerCase()).not.toContain("class=");
    expect(html.toLowerCase()).not.toContain("<style");
    expect(html.toLowerCase()).not.toContain("<font");
    expect(html).toContain("Olá");
  });

  it("removes leading title block that matches itemTitulo", () => {
    const html = toBalloonHtml(
      `<h2>Sangria insuficiente</h2><p>Ajuste a sangria para 3mm.</p>`,
      "Sangria insuficiente",
    );
    expect(html.toLowerCase()).not.toContain("<h2>");
    expect(html).not.toMatch(/Sangria insuficiente/i);
    expect(html).toContain("Ajuste a sangria");
  });

  it("strips providencias blocks when requested", () => {
    const html = toBalloonHtml(
      `<p>Descrição do problema</p>
       <div class="providencias-bar">Providências</div>
       <ul class="action-list"><li class="action-item">Corrigir</li></ul>`,
      "Título",
      { stripProvidencias: true },
    );
    expect(html).toContain("Descrição do problema");
    expect(html.toLowerCase()).not.toContain("provid");
    expect(html.toLowerCase()).not.toContain("corrigir");
  });
});
