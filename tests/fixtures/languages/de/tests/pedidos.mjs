import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrar } from '../src/index.js';

test('registra um pedido', () => {
  assert.equal(registrar({ nome: 'a' }).registrado, true);
});
