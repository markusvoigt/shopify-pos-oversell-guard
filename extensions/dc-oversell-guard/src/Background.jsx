// @extension-target: pos.app.ready.data
import {CONFIG} from './config.js';
import {createGuard} from './guard.js';

export default function extension() {
  const guard = createGuard({
    shopify,
    config: CONFIG,
    fetchImpl: (url, init) => fetch(url, init),
  });

  // Register the interceptor first. The callback must return synchronously. It reads the cache only.
  shopify.intercept('cartvalidations', (event) => guard.intercept(event));

  // Fetch the warehouse figure when the cart changes, so the cache is ready before checkout.
  shopify.cart.current.subscribe((cart) => {
    void guard.refresh(cart);
  });
  void guard.refresh(shopify.cart.current.value);
}
