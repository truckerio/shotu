function serial(prefix, number, digits) { return `${prefix}${String(number).padStart(digits, "0")}`; }

export async function reserveInspectionSerial(client, companyId) {
  await client.query("insert into inspection_serial_counters(company_id) values($1) on conflict(company_id) do nothing", [companyId]);
  const result = await client.query("select * from inspection_serial_counters where company_id=$1 for update", [companyId]);
  const row = result.rows[0];
  const value = serial(row.prefix, Number(row.next_number), Number(row.digits));
  await client.query("update inspection_serial_counters set next_number=next_number+1,updated_at=now() where company_id=$1", [companyId]);
  return value;
}

export const inspectionSerialInternals = { serial };
