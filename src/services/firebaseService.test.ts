/// <reference path="../vite-env.d.ts" />
import assert from 'node:assert/strict';
import test from 'node:test';
import FirebaseService from './firebaseService.ts';

const createService = (): FirebaseService => new FirebaseService();

test('isInitialized() returns false on a fresh instance', () => {
  const service = createService();
  assert.equal(service.isInitialized(), false);
});

test('getCurrentUser() returns null when Firebase has not been initialized', async () => {
  const service = createService();
  const user = await service.getCurrentUser();
  assert.equal(user, null);
});

test('addPatient() throws "Firebase not initialized" when db is null', async () => {
  const service = createService();
  await assert.rejects(
    () => service.addPatient({
      name: 'Alice',
      age: 30,
      gender: 'F',
      records: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as never),
    (err: unknown) => err instanceof Error && /not initialized/i.test(err.message)
  );
});

test('updateRecordAnnotations() throws "Firebase not initialized" when db is null', async () => {
  const service = createService();
  await assert.rejects(
    () => service.updateRecordAnnotations('rec-1', []),
    (err: unknown) => err instanceof Error && /not initialized/i.test(err.message)
  );
});

test('signIn() throws "Firebase not initialized" when auth is null', async () => {
  const service = createService();
  await assert.rejects(
    () => service.signIn('a@b.c', 'pw'),
    (err: unknown) => err instanceof Error && /not initialized/i.test(err.message)
  );
});
