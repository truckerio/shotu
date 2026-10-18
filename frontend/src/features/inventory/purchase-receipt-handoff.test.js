import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePurchaseReceiptHandoff, createPurchaseReceiptHandoff, findPurchaseReceiptHandoffOrder } from './purchase-receipt-handoff.js';

test('receipt handoff waits for the requested shop and order, then stays consumed across refreshes', () => {
  const handoff = createPurchaseReceiptHandoff('po-chino', 'chino', 'PO-CHINO', 'request-1');
  const orders = [{ id: 'po-chino' }];

  assert.equal(handoff.poNumber, 'PO-CHINO');
  assert.equal(findPurchaseReceiptHandoffOrder(handoff, 'arizona', orders, ''), null);
  assert.equal(findPurchaseReceiptHandoffOrder(handoff, 'chino', [], ''), null);
  assert.equal(findPurchaseReceiptHandoffOrder(handoff, 'chino', orders, ''), orders[0]);
  assert.equal(findPurchaseReceiptHandoffOrder(handoff, 'chino', orders, 'request-1'), null);
  assert.equal(consumePurchaseReceiptHandoff(handoff, 'request-1'), null);
});

test('a newer request survives stale consumption and can reopen the same order', () => {
  const previous = createPurchaseReceiptHandoff('po-chino', 'chino', 'PO-CHINO', 'request-1');
  const next = createPurchaseReceiptHandoff('po-chino', 'chino', 'PO-CHINO', 'request-2');
  const orders = [{ id: 'po-chino' }];

  assert.equal(consumePurchaseReceiptHandoff(next, previous.key), next);
  assert.equal(findPurchaseReceiptHandoffOrder(next, 'chino', orders, previous.key), orders[0]);
});
