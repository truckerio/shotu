import { getPool, query } from "../pool.js";

const DEFAULT_PREFIX = "WO-";
const DEFAULT_DIGITS = 6;

function serialValue(prefix, number, digits) {
  return `${prefix}${String(number).padStart(digits, "0")}`;
}

function publicSettings(row, companyId) {
  return {
    companyId,
    prefix: row?.prefix || DEFAULT_PREFIX,
    nextNumber: Number(row?.next_number || 1),
    digits: Number(row?.digits || DEFAULT_DIGITS),
  };
}

export async function getWorkorderSerialSettings(companyId) {
  const result = await query(
    `
      select company_id, prefix, next_number, digits
      from workorder_serial_counters
      where company_id = $1
      limit 1
    `,
    [companyId],
  );
  return publicSettings(result.rows[0], companyId);
}

async function reserveWithClient(client, { companyId, count }) {
  await client.query(
    `
      insert into workorder_serial_counters (company_id)
      values ($1)
      on conflict (company_id) do nothing
    `,
    [companyId],
  );
  const counter = await client.query(
    `
      select company_id, prefix, next_number, digits
      from workorder_serial_counters
      where company_id = $1
      for update
    `,
    [companyId],
  );
  const settings = publicSettings(counter.rows[0], companyId);
  const serials = [];
  let nextNumber = settings.nextNumber;

  while (serials.length < count) {
    const serial = serialValue(settings.prefix, nextNumber, settings.digits);
    const existing = await client.query(
      `
        select 1
        from operational_workorders
        where company_id = $1 and serial = $2
        limit 1
      `,
      [companyId, serial],
    );
    if (!existing.rows[0]) serials.push(serial);
    nextNumber += 1;
  }

  await client.query(
    `
      update workorder_serial_counters
      set next_number = $2,
          updated_at = now()
      where company_id = $1
    `,
    [companyId, nextNumber],
  );

  return { ...settings, serials, nextNumber };
}

export async function reserveWorkorderSerials({ companyId, count = 1 }, transactionClient = null) {
  const safeCount = Math.max(1, Math.min(Number.parseInt(count, 10) || 1, 250));
  if (transactionClient) {
    return reserveWithClient(transactionClient, { companyId, count: safeCount });
  }

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const reservation = await reserveWithClient(client, { companyId, count: safeCount });
    await client.query("commit");
    return reservation;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
