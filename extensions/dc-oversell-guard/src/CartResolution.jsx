// @extension-target: pos.cart.validations.resolution.render
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {signal} from '@preact/signals';
import {BUILD} from './build.js';
import {CONFIG} from './config.js';
import {STORAGE_KEY} from './stockCache.js';
import {REMOVE, TAKE_NOW, applyDecisions, debugLines, linesNeedingAction} from './resolutionModel.js';

const lines = signal([]);
const decisions = signal({});
const saveFailed = signal(false);
const debug = signal([]);

// The event carries the cart, not the finding. Work out the lines again with the shared rule.
async function load({cart}) {
  /** @type {any} */
  let snapshot;
  try {
    snapshot = await shopify.storage.get(STORAGE_KEY);
  } catch {
    snapshot = undefined;
  }
  const now = Date.now();
  lines.value = linesNeedingAction({cart, snapshot, now, config: CONFIG});
  debug.value = CONFIG.debug ? debugLines({cart, snapshot, now, config: CONFIG, screenBuild: BUILD}) : [];
}

// POS waits for this handler and then validates the cart again.
async function save() {
  saveFailed.value = false;
  try {
    const removed = await applyDecisions({
      cartApi: shopify.cart,
      lines: lines.value,
      decisions: decisions.value,
      config: CONFIG,
    });
    if (removed.length > 0) {
      shopify.toast.show(shopify.i18n.translate('removed', {count: removed.length}));
    }
  } catch {
    saveFailed.value = true;
    shopify.toast.show(shopify.i18n.translate('saveFailed'));
  }
}

export default async () => {
  await shopify.resolution.onSave(save);
  await load(shopify.resolution.event.value);
  shopify.resolution.event.subscribe((event) => {
    void load(event);
  });
  render(<Extension />, document.body);
};

function Extension() {
  const {i18n} = shopify;

  if (lines.value.length === 0) {
    return (
      <s-scroll-box padding="base">
        <s-stack direction="block" gap="base">
          <s-heading>{i18n.translate('heading')}</s-heading>
          <s-text>{i18n.translate('nothingToDo')}</s-text>
          <Diagnostics />
        </s-stack>
      </s-scroll-box>
    );
  }

  return (
    <s-scroll-box padding="base">
      <s-stack direction="block" gap="large">
        <s-heading>{i18n.translate('heading')}</s-heading>
        <s-text>{i18n.translate('instructions')}</s-text>
        {saveFailed.value ? <s-banner tone="critical" heading={i18n.translate('saveFailed')} /> : undefined}
        {lines.value.map((line) => (
          <s-section key={line.uuid} heading={line.title ?? line.sku ?? i18n.translate('untitledItem')}>
            <LineAction line={line} />
          </s-section>
        ))}
        <s-text color="subdued">{i18n.translate('footnote')}</s-text>
        <Diagnostics />
      </s-stack>
    </s-scroll-box>
  );
}

function LineAction({line}) {
  const {i18n} = shopify;

  // The store cannot hand the item over and the warehouse cannot ship it. There is no choice.
  if (line.mustRemove) {
    return (
      <s-stack direction="block" gap="base">
        <s-badge tone="critical">
          {i18n.translate('mustRemove', {available: line.available, local: line.localAvailable, needed: line.needed})}
        </s-badge>
        <s-text>{i18n.translate('mustRemoveNotice')}</s-text>
      </s-stack>
    );
  }

  const unknown = line.state === 'unknown';
  return (
    <s-stack direction="block" gap="base">
      <s-badge tone={unknown ? 'warning' : 'critical'}>
        {unknown ? i18n.translate('unknown') : i18n.translate('short', {available: line.available, needed: line.needed})}
      </s-badge>
      <s-text>
        {line.localAvailable !== undefined
          ? i18n.translate('unknownStore', {local: line.localAvailable, needed: line.needed})
          : i18n.translate('storeUnknown')}
      </s-text>
      {unknown || line.localAvailable === undefined ? <s-text>{i18n.translate('unknownHint')}</s-text> : undefined}
      {unknown && CONFIG.debug && line.reason ? (
        <s-text color="subdued">{i18n.translate('details', {reason: line.reason})}</s-text>
      ) : undefined}
      <s-choice-list
        values={decisions.value[line.uuid] ? [decisions.value[line.uuid]] : []}
        onChange={(event) => {
          const [choice] = event.currentTarget.values ?? [];
          decisions.value = {...decisions.value, [line.uuid]: choice};
        }}
      >
        {line.canTakeNow ? <s-choice value={TAKE_NOW}>{i18n.translate('choiceTakeNow')}</s-choice> : undefined}
        <s-choice value={REMOVE}>{i18n.translate('choiceRemove')}</s-choice>
      </s-choice-list>
    </s-stack>
  );
}

// Debug only: the figures that the app read and what it decided. Switch it off with `debug: false`.
function Diagnostics() {
  if (debug.value.length === 0) return undefined;
  return (
    <s-section heading={shopify.i18n.translate('diagnostics')}>
      <s-stack direction="block" gap="base">
        {debug.value.map((text) => (
          <s-text key={text} color="subdued">
            {text}
          </s-text>
        ))}
      </s-stack>
    </s-section>
  );
}
