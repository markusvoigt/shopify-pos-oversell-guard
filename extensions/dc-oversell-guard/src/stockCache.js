// In-memory stock figures for the variants in the current cart.
// Entry: {status: 'loading', since} | {status: 'error', since, reason} | {status: 'ok', tracked, available, localAvailable?, fetchedAt}

/** Storage key that the background target writes and the resolution screen reads. */
export const STORAGE_KEY = 'dcGuardStock';

export function createStockCache({fetchStock, now, ttlMs, onChange}) {
  const entries = new Map();
  const inFlight = new Set();

  function fail(variantId, reason) {
    const previous = entries.get(variantId);
    // Keep an earlier figure. The rule ignores it when it is older than maxStaleMs.
    if (previous?.status === 'ok') return;
    // Keep the first `since`, so a retry does not restart the loading grace period.
    entries.set(variantId, {status: 'error', since: previous?.since ?? now(), reason});
  }

  /** Fetches figures that are missing, failed, or older than ttlMs. Never throws. */
  function ensure(items, dcLocationIds, posLocationId) {
    const wanted = new Map(
      items.map((item) => [String(item.variantId), {variantId: String(item.variantId), sku: item.sku}]),
    );
    for (const variantId of entries.keys()) {
      if (!wanted.has(variantId) && !inFlight.has(variantId)) entries.delete(variantId);
    }

    const due = [...wanted.values()].filter(({variantId}) => {
      if (inFlight.has(variantId)) return false;
      const entry = entries.get(variantId);
      return entry?.status !== 'ok' || now() - entry.fetchedAt > ttlMs;
    });
    if (!due.length) return Promise.resolve();

    for (const {variantId} of due) {
      inFlight.add(variantId);
      if (!entries.has(variantId)) entries.set(variantId, {status: 'loading', since: now()});
    }

    return Promise.resolve()
      .then(() => fetchStock(due, dcLocationIds, posLocationId))
      .then(
        (stock) => {
          for (const {variantId} of due) {
            const figure = stock?.[variantId];
            if (figure && Number.isFinite(Number(figure.available))) {
              entries.set(variantId, {
                status: 'ok',
                tracked: figure.tracked !== false,
                available: Number(figure.available),
                ...(typeof figure.localAvailable === 'number' ? {localAvailable: figure.localAvailable} : {}),
                fetchedAt: now(),
              });
            } else {
              fail(variantId, 'The answer has no figure for this item');
            }
          }
        },
        (error) => {
          for (const {variantId} of due) fail(variantId, String(error?.message ?? error));
        },
      )
      .then(() => {
        for (const {variantId} of due) inFlight.delete(variantId);
        onChange?.(snapshot());
      });
  }

  const get = (variantId) => entries.get(String(variantId));
  const snapshot = () => Object.fromEntries(entries);

  return {ensure, get, snapshot};
}
