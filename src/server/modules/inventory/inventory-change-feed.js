import { getPool } from '../../db/pool.js';

const CHANNEL = 'inventory_stock_changed';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One dedicated LISTEN connection per server process, shared by its SSE clients.
// A failed connection ends every stream so the browser can use its fallback.
export function createInventoryChangeFeed({ pool = getPool() } = {}) {
  const subscribers = new Set();
  let client = null;
  let opening = null;
  let generation = 0;

  function release() {
    const current = client;
    client = null;
    if (!current) return;
    current.removeListener('notification', onNotification);
    current.removeListener('error', onFailure);
    current.removeListener('end', onFailure);
    current.release(true);
  }

  function onFailure(error) {
    generation += 1;
    release();
    for (const subscriber of [...subscribers]) {
      subscribers.delete(subscriber);
      subscriber.onFailure(error || new Error('Inventory notification connection ended'));
    }
  }

  function onNotification(message) {
    if (message.channel !== CHANNEL || !UUID.test(message.payload || '')) return;
    for (const subscriber of subscribers) {
      if (subscriber.companyIds.has(message.payload.toLowerCase())) {
        subscriber.onChange();
      }
    }
  }

  async function ensureListening() {
    if (client) return;
    if (!opening) {
      const startedAt = generation;
      opening = (async () => {
        const connected = await pool.connect();
        try {
          connected.on('notification', onNotification);
          connected.on('error', onFailure);
          connected.on('end', onFailure);
          await connected.query(`LISTEN ${CHANNEL}`);
          if (startedAt !== generation) {
            throw new Error('Inventory notification connection was closed');
          }
          client = connected;
        } catch (error) {
          if (client !== connected) {
            connected.removeListener('notification', onNotification);
            connected.removeListener('error', onFailure);
            connected.removeListener('end', onFailure);
            connected.release(true);
          }
          throw error;
        }
      })().finally(() => { opening = null; });
    }
    await opening;
  }

  async function subscribe(companyIds, onChange, onFailureCallback) {
    await ensureListening();
    const subscriber = {
      companyIds: new Set(companyIds.map((id) => id.toLowerCase())),
      onChange,
      onFailure: onFailureCallback,
    };
    subscribers.add(subscriber);
    return () => {
      if (!subscribers.delete(subscriber)) return;
      if (subscribers.size === 0) {
        generation += 1;
        release();
      }
    };
  }

  function close() {
    onFailure(new Error('Inventory notification feed closed'));
  }

  return { subscribe, close };
}

let sharedFeed;
export function getInventoryChangeFeed() {
  if (!sharedFeed) sharedFeed = createInventoryChangeFeed();
  return sharedFeed;
}

export function closeInventoryChangeFeed() {
  sharedFeed?.close();
  sharedFeed = null;
}
