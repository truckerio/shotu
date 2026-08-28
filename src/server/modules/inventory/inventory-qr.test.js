import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import {
  createInventoryQrToken,
  inventoryScanUrl,
  inventoryTokenFromCode,
  readInventoryQrToken,
} from "./inventory-qr.js";

const SIGNING_KEY = Buffer.alloc(32, 17).toString("base64");
const UNIT_ID = "11111111-2222-4333-8444-555555555555";

test("inventory QR is authenticated-encrypted, tamper-resistant, and decodes from a printed image", async () => {
  const token = createInventoryQrToken(UNIT_ID, { signingKey: SIGNING_KEY });
  assert.equal(token.includes("11111111"), false);
  const decodedPayload = Buffer.from(token, "base64url");
  const rawUnitId = Buffer.from(UNIT_ID.replaceAll("-", ""), "hex");
  assert.equal(decodedPayload.includes(rawUnitId), false);
  assert.equal(readInventoryQrToken(token, { signingKey: SIGNING_KEY }), UNIT_ID);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(readInventoryQrToken(tampered, { signingKey: SIGNING_KEY }), null);

  const url = inventoryScanUrl(token, "https://workorders.example.test/app");
  assert.equal(inventoryTokenFromCode(url), token);
  assert.equal(url.includes("invoice"), false);
  assert.equal(url.includes("price"), false);
  const png = PNG.sync.read(await QRCode.toBuffer(url, { width: 512, margin: 3, errorCorrectionLevel: "M" }));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, url);
});

test("inventory QR derives a restart-stable domain key from the application auth secret", () => {
  const options = { authSecret: "local-auth-root-secret-that-is-long-enough" };
  const first = createInventoryQrToken(UNIT_ID, options);
  const second = createInventoryQrToken(UNIT_ID, options);
  assert.notEqual(first, second);
  assert.equal(readInventoryQrToken(first, options), UNIT_ID);
  assert.equal(readInventoryQrToken(second, options), UNIT_ID);
  assert.throws(
    () => createInventoryQrToken(UNIT_ID, { signingKey: "" }),
    (error) => error.code === "inventory_qr_not_configured",
  );
});
