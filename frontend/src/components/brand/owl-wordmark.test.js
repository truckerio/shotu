import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OwlWordmark.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./owl-wordmark.css", import.meta.url), "utf8");
const profileStyles = readFileSync(new URL("../account/profile-menu.css", import.meta.url), "utf8");

test("shared Owl wordmark keeps a capital O and lowercase suffix", () => {
  assert.match(component, /function OwlProfileMark/);
  assert.match(component, /<OwlProfileMark className="owl-wordmark-mark"/);
  assert.match(component, />wl<\/span>/);
  assert.match(styles, /\.owl-wordmark\s*\{[^}]*color:\s*#000;/s);
});

test("shared Owl profile mark contains the approved open ring, head, and shoulders", () => {
  assert.match(component, /className="owl-profile-mark-ring"/);
  assert.match(component, /A13 13 0 1 1/);
  assert.match(component, /className="owl-profile-mark-head" cx="16" cy="19" r="4"/);
  assert.match(component, /className="owl-profile-mark-shoulders"/);
  assert.match(styles, /\.owl-profile-mark-ring\s*\{[^}]*stroke-width:\s*4\.25;/s);
  assert.match(styles, /\.owl-profile-mark-shoulders,[\s\S]*\.owl-profile-mark-head\s*\{[^}]*fill:\s*#1570ef;/s);
});

test("shared Owl wordmark keeps its capital mark larger than its suffix", () => {
  assert.match(styles, /\.owl-wordmark-mark\s*\{[^}]*height:\s*1\.34em;[^}]*width:\s*1\.34em;/s);
  assert.match(styles, /\.owl-wordmark-suffix\s*\{[^}]*font-family:\s*Arial, Helvetica, sans-serif;[^}]*font-size:\s*1em;[^}]*transform:\s*translateY\(0\.16em\) scaleX\(1\.2\);/s);
});

test("workspace header wordmark stays subordinate to the mobile primary action", () => {
  assert.match(profileStyles, /\.profile-menu-brand\s+\.owl-wordmark\s*\{[^}]*font-size:\s*29px;[^}]*transform:\s*translateY\(3px\);/s);
  assert.match(profileStyles, /\.profile-menu-brand-mark\s*>\s*\.owl-profile-mark\s*\{[^}]*height:\s*40px;[^}]*width:\s*40px;/s);
});
