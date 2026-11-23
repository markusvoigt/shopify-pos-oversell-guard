// Logic of the resolution screen. It uses no POS API directly, so it runs in Node tests.
import {classifyLines, linesToCheck} from './rule.js';

export const TAKE_NOW = 'take_now';
export const REMOVE = 'remove';

/** The lines to show. Uses the same rule and the same figures as the interceptor. */
export function linesNeedingAction({cart, snapshot, now, config}) {
  const entries = snapshot?.entries ?? {};
  const local = snapshot?.local;
  const flagged = classifyLines({
    cart,
    getStock: (variantId) => entries[variantId],
    getLocal: local ? (variantId) => local[variantId] : undefined,
    now,
    config,
  });
  // For a line without a figure, say why: the stock lookup failed, or the warehouse lookup failed.
  return flagged.map((line) =>
    line.state === 'unknown' ? {...line, reason: line.reason ?? snapshot?.warehouse?.error} : line,
  );
}

/**
 * Writes the result to the cart and returns the lines that it removed.
 * A line with mustRemove is always removed. For the other lines the choice of the staff member applies.
 * A line without a choice stays blocked.
 * @param {object} args
 * @param {{addLineItemProperties: (uuid: string, properties: Record<string, string>) => Promise<void>, removeLineItem: (uuid: string) => Promise<void>}} args.cartApi
 * @param {{uuid: string, mustRemove?: boolean, canTakeNow?: boolean}[]} args.lines
 * @param {Record<string, string | undefined>} args.decisions
 * @param {{declarationKey: string, takeNowValue: string}} args.config
 */
export async function applyDecisions({cartApi, lines, decisions, config}) {
  const removed = [];
  for (const line of lines) {
    const decision = line.mustRemove ? REMOVE : decisions[line.uuid];
    if (decision === REMOVE) {
      await cartApi.removeLineItem(line.uuid);
      removed.push(line);
    } else if (decision === TAKE_NOW && line.canTakeNow !== false) {
      await cartApi.addLineItemProperties(line.uuid, {[config.declarationKey]: config.takeNowValue});
    }
  }
  return removed;
}

/**
 * Plain-text lines for the debug panel of the screen: the figures that the app read and what it decided.
 * @returns {string[]}
 */
export function debugLines({cart, snapshot, now, config, screenBuild}) {
  const lines = [`Build: screen ${screenBuild}, background ${snapshot?.build ?? '?'}`];

  const warehouse = snapshot?.warehouse;
  if (config.stockSource === 'mock') {
    lines.push('Stock source: mock (fixed numbers)');
  } else if (warehouse?.ids) {
    lines.push(`Warehouse locations: ${warehouse.ids.join(', ') || 'none'}`);
  } else {
    lines.push(`Warehouse locations: not known${warehouse?.error ? `. ${warehouse.error}` : ''}`);
  }

  const blocked = new Map(linesNeedingAction({cart, snapshot, now, config}).map((line) => [line.uuid, line]));
  for (const line of linesToCheck(cart, config)) {
    const variantId = String(line.variantId);
    const pos = snapshot?.local?.[variantId];
    const entry = snapshot?.entries?.[variantId];
    const store =
      pos?.status === 'ok'
        ? pos.tracked
          ? String(pos.available)
          : 'not tracked'
        : entry?.status === 'ok' && typeof entry.localAvailable === 'number'
          ? `${entry.localAvailable} (from the stock answer)`
          : 'no figure';
    const warehouseFigure =
      entry?.status === 'ok' ? String(entry.available) : `no figure${entry?.reason ? ` (${entry.reason})` : ''}`;
    const hit = blocked.get(line.uuid);
    const result = hit ? (hit.mustRemove ? 'blocked, must be removed' : `blocked (${hit.state})`) : 'not blocked';
    lines.push(
      `${line.sku ?? line.title ?? variantId} x${line.quantity}: store ${store}, warehouse ${warehouseFigure} -> ${result}`,
    );
  }
  return lines;
}
