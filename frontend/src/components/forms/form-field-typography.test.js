import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const typography = readFileSync(new URL("../../typography.css", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../../styles/foundation.css", import.meta.url), "utf8");
const createFields = readFileSync(
  new URL("../../features/create-workorder/create-workorder-editor.css", import.meta.url),
  "utf8",
);

test("editable field values use regular typography while labels remain emphasized", () => {
  assert.match(typography, /--weight-regular:\s*400;/);
  assert.match(
    foundation,
    /input,\s*select,\s*textarea\s*\{[^}]*font:\s*inherit;[^}]*font-weight:\s*var\(--weight-regular\);/s,
  );
  assert.match(createFields, /\.field\s*\{[^}]*font-weight:\s*var\(--weight-regular\);/s);
  assert.match(createFields, /\.field\s*>\s*span\s*\{[^}]*font-weight:\s*var\(--weight-semibold\);/s);
});
