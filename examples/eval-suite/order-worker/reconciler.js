"use strict";

function startReconciler({ store, intervalMs = 50, dispatchPayout }) {
  const timer = setInterval(async () => {
    const pending = store.getPendingPayouts();
    for (const payout of pending) {
      const txRef = await dispatchPayout(payout);
      store.markPayoutSent(payout.id, txRef);
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { startReconciler };
