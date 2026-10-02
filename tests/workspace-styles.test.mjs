import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

// These are stylesheet contracts, not a substitute for rendered browser QA.
const stylesheet = postcss.parse(readFileSync(new URL("../src/workspace.css", import.meta.url), "utf8"));
function declarations(selector, media = null) {
  const result = {};
  stylesheet.walkRules((rule) => {
    const parentMedia = rule.parent.type === "atrule" && rule.parent.name === "media" ? rule.parent.params : null;
    if (parentMedia !== media || !rule.selector.split(",").map((item) => item.trim()).includes(selector)) return;
    rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

test("disabled file upload has a visible disabled state on its clickable label", () => {
  const disabled = declarations("label.button:has(input:disabled)");
  assert.equal(disabled.cursor, "not-allowed");
  assert.ok(Number(disabled.opacity) > 0 && Number(disabled.opacity) < 1);
});

test("dataset busy state and workspace loading have explicit presentation", () => {
  const busy = declarations('.data-center-page .dataset[aria-busy="true"]');
  assert.ok(busy["border-color"]);
  assert.ok(busy.background);
  assert.ok(declarations(".workspace-state").display);
  assert.equal(declarations(".operation-spinner")["border-radius"], "50%");
});

test("data entry typography stays readable on desktop and phones", () => {
  assert.ok(parseFloat(declarations(".data-workspace-intro")["font-size"]) >= 16);
  assert.ok(parseFloat(declarations(".data-center-page .metadata-fields label")["font-size"]) >= 14);
  assert.ok(parseFloat(declarations(".data-center-page .metadata-fields input")["font-size"]) >= 14);
  assert.ok(parseFloat(declarations(".data-center-page .dataset-description")["font-size"]) >= 12);
  assert.ok(parseFloat(declarations(".data-center-page .metadata-fields input", "(max-width: 520px)")["font-size"]) >= 16);
});

test("data workspace stacks cards and metadata without fixed mobile minimum widths", () => {
  assert.equal(declarations(".data-center-page .dataset", "(max-width: 760px)")["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(declarations(".data-center-page .metadata-fields label", "(max-width: 760px)")["min-width"], "0");
  assert.equal(declarations(".data-center-page .metadata-fields .citation-field", "(max-width: 760px)")["min-width"], "0");
});

function luminance(color) {
  const channels = color.replace("#", "").match(/../g).map((value) => parseInt(value, 16) / 255);
  return channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
function contrast(foreground, background) {
  return (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
}

test("data workspace explanatory and status text has readable contrast", () => {
  assert.ok(contrast(declarations(".data-workspace-intro").color, "#f5f7f7") >= 4.5);
  assert.ok(contrast(declarations(".data-center-page .dataset-description").color, "#fcfdfc") >= 4.5);
  for (const tone of ["gray", "amber", "green"]) {
    const style = { ...declarations(`.badge.${tone}`), ...declarations(`.data-center-page .badge.${tone}`) };
    assert.ok(contrast(style.color, style.background) >= 4.5, `${tone} badge text should have 4.5:1 contrast`);
  }
});

test("import review and mode selection remain readable and stack on phones", () => {
  assert.ok(parseFloat(declarations(".data-center-page .import-mode")["font-size"]) >= 14);
  assert.ok(parseFloat(declarations(".data-center-page .import-review > p")["font-size"]) >= 16);
  assert.equal(declarations(".data-center-page .import-review-file")["overflow-wrap"], "anywhere");
  assert.equal(declarations(".data-center-page .dataset-actions", "(max-width: 760px)").display, "grid");
  assert.ok(parseFloat(declarations(".data-center-page .import-mode select", "(max-width: 520px)")["font-size"]) >= 16);
});
