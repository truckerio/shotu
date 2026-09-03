import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inspection PDF bytes survive app redeploy while legacy archives remain compatible",async()=>{
  const sql=await readFile(new URL("../../db/migrations/110_inspection_pdf_bytes.sql",import.meta.url),"utf8");
  assert.match(sql,/add column pdf_bytes bytea/);
  assert.match(sql,/storage_key='db:inline-pdf'/);
  assert.match(sql,/octet_length\(pdf_bytes\)=pdf_byte_size/);
  assert.match(sql,/pdf_byte_size between 5 and 10485760/);
  assert.match(sql,/storage_key<>'db:inline-pdf' and pdf_bytes is null/);
});
