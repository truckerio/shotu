import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("shared picker searches opt out of correction", () => {
  for (const file of ["./MechanicMultiSelect.jsx", "./UnitOfMeasurePicker.jsx"]) {
    assert.match(source(file), /textEntryProps\("search"\)/);
  }
});

test("account credentials and device names use the matching semantic policies", () => {
  const passwordDialog = source("../account/ChangePasswordDialog.jsx");
  const passkeys = source("../account/PasskeyManager.jsx");
  const resetPassword = source("../../features/auth/ResetPasswordPage.jsx");

  assert.equal(passwordDialog.match(/textEntryProps\("identifier"\)/g)?.length, 3);
  assert.equal(resetPassword.match(/textEntryProps\("identifier"\)/g)?.length, 2);
  assert.equal(passkeys.match(/textEntryProps\("name"\)/g)?.length, 2);
});
