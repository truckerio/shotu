import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./WorkorderPhotosModule.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./workorder-photos.css", import.meta.url), "utf8");

test("photos use a bounded gallery instead of chat bubble attachment layout", () => {
  assert.match(component, /className="workorder-photo-grid"/);
  assert.match(component, /className="workorder-photo-card"/);
  assert.doesNotMatch(component, /className="chat-(?:attachments|image-attachment|image-link|attachment-image)"/);
  assert.match(css, /\.workorder-photo-link\s*{[^}]*aspect-ratio:\s*4\s*\/\s*3/s);
  assert.match(css, /\.workorder-photo-image\s*{[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*width:\s*100%/s);
});

test("photos replace a failed legacy image with an explicit unavailable state", () => {
  assert.match(component, /onError=\{\(\) => setUnavailable\(true\)\}/);
  assert.match(component, /Image unavailable/);
  assert.match(component, /Upload this photo again to restore it\./);
  assert.match(component, /role="img"/);
});

test("photos remain one column on phone widths", () => {
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*\.workorder-photo-grid\s*{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.workorder-photo-grid\s*{[^}]*min-width:\s*0/s);
});
