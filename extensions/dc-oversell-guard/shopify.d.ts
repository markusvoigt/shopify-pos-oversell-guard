import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Background.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.app.ready.data').Api &
    import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/CartResolution.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/config.js' {
  const shopify:
    | (import('@shopify/ui-extensions/pos.app.ready.data').Api &
        import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal)
    | import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/guard.js' {
  const shopify: import('@shopify/ui-extensions/pos.app.ready.data').Api &
    import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/stockCache.js' {
  const shopify:
    | (import('@shopify/ui-extensions/pos.app.ready.data').Api &
        import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal)
    | import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/stockClient.js' {
  const shopify: import('@shopify/ui-extensions/pos.app.ready.data').Api &
    import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/build.js' {
  const shopify:
    | (import('@shopify/ui-extensions/pos.app.ready.data').Api &
        import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal)
    | import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/rule.js' {
  const shopify:
    | (import('@shopify/ui-extensions/pos.app.ready.data').Api &
        import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal)
    | import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/stock.js' {
  const shopify: import('@shopify/ui-extensions/pos.app.ready.data').Api &
    import('@shopify/ui-extensions/pos.app.ready.data').ShopifyGlobal;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/resolutionModel.js' {
  const shopify: import('@shopify/ui-extensions/pos.cart.validations.resolution.render').Api;
  const globalThis: { shopify: typeof shopify };
}
