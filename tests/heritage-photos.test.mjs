import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { heritagePhotographs } from "../src/referenceSites.js";
test("bundled real photographs retain original JPEG bytes and public-domain provenance", async () => {
  const manifest=JSON.parse(await readFile(new URL("../public/heritage/sources.json",import.meta.url),"utf8"));
  for(const photo of heritagePhotographs){
    const source=manifest.records.find(item=>item.id===photo.id); assert.ok(source);assert.equal(source.license,"CC0 1.0");assert.equal(source.credit,photo.credit);assert.equal(source.sourceUrl,photo.sourceUrl);
    const bytes=await readFile(new URL("../public"+photo.url,import.meta.url));
    assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(bytes.length,photo.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),source.sha256);
  }
});
