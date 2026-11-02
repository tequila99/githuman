import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { setImmediate } from 'node:timers/promises'
import {
  withTransaction,
  withSavepoint
} from '../../../src/server/db/transaction.ts'
import { AsyncTransactionError } from '../../../src/server/errors/database.ts'
import { isSqliteBusyError } from '../../../src/server/db/sqlite-error.ts'

function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE values_table(value INTEGER)')
  t.after(() => db.close())
  return {
    db,
    insert: (value: number) =>
      db.prepare('INSERT INTO values_table VALUES(?)').run(value),
    values: () =>
      db
        .prepare('SELECT value FROM values_table ORDER BY value')
        .all()
        .map(row => row.value)
  }
}

for (const mode of ['deferred', 'immediate'] as const) {
  test(`${mode} commits a synchronous result and rolls back on callback failure`, t => {
    const { db, insert, values } = setup(t)
    const result: number = withTransaction(
      db,
      () => {
        insert(1)
        return 42
      },
      { mode }
    )
    assert.equal(result, 42)
    assert.deepEqual(values(), [1])
    const failure = new Error('write failed')
    assert.throws(
      () =>
        withTransaction(
          db,
          () => {
            insert(2)
            throw failure
          },
          { mode }
        ),
      error => error === failure
    )
    assert.deepEqual(values(), [1])
    assert.equal(db.isTransaction, false)
  })
}

test('failed nested BEGIN does not roll back the outer transaction', t => {
  const { db, insert, values } = setup(t)
  withTransaction(db, () => {
    insert(1)
    assert.throws(() => withTransaction(db, () => insert(2)), /transaction/)
    assert.equal(db.isTransaction, true)
    insert(3)
  })
  assert.deepEqual(values(), [1, 3])
})

test('savepoints isolate inner rollback and remain part of the outer transaction', t => {
  const { db, insert, values } = setup(t)
  const failure = new Error('inner failure')
  withTransaction(db, () => {
    insert(1)
    assert.throws(
      () =>
        withSavepoint(db, () => {
          insert(2)
          withSavepoint(db, () => insert(3))
          throw failure
        }),
      error => error === failure
    )
    withSavepoint(db, () => insert(4))
  })
  assert.deepEqual(values(), [1, 4])
  assert.throws(
    () =>
      withTransaction(db, () => {
        withSavepoint(db, () => insert(5))
        throw failure
      }),
    error => error === failure
  )
  assert.deepEqual(values(), [1, 4])
  assert.equal(
    withSavepoint(db, () => {
      insert(6)
      return 'saved'
    }),
    'saved'
  )
  assert.deepEqual(values(), [1, 4, 6])
})

test('failed commit rolls back all writes', t => {
  const { db } = setup(t)
  db.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)'
  )
  assert.throws(
    () => withTransaction(db, () => db.exec('INSERT INTO child VALUES(99)')),
    /FOREIGN KEY/
  )
  assert.deepEqual(db.prepare('SELECT * FROM child').all(), [])
  assert.equal(db.isTransaction, false)
})

test('rollback failure preserves the initial error as cause and both errors', t => {
  const { db } = setup(t)
  const failure = new Error('initial failure')
  assert.throws(
    () =>
      withTransaction(db, () => {
        db.exec('ROLLBACK')
        throw failure
      }),
    error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, failure)
      assert.equal(error.errors[0], failure)
      assert.equal(error.errors.length, 2)
      return true
    }
  )
})

test('Promise callbacks are forbidden by types and rejected before commit at runtime', t => {
  const { db, insert, values } = setup(t)
  assert.throws(() => {
    // @ts-expect-error Async callbacks must not compile.
    withTransaction(db, () => {
      insert(1)
      return Promise.resolve(1)
    })
  }, AsyncTransactionError)
  assert.throws(() => {
    // @ts-expect-error Savepoints have the same synchronous contract.
    withSavepoint(db, () => {
      insert(2)
      return Promise.resolve(2)
    })
  }, AsyncTransactionError)
  assert.deepEqual(values(), [])
  assert.equal(db.isTransaction, false)
})

test('runtime guard also rejects thenables passed through an unknown return type', t => {
  const { db, insert, values } = setup(t)
  const callback = (): unknown => {
    insert(1)
    // oxlint-disable-next-line unicorn/no-thenable -- Exercise rejection of a thenable supplied by an untyped caller.
    return { then() {} }
  }
  assert.throws(() => withTransaction(db, callback), AsyncTransactionError)
  assert.deepEqual(values(), [])
})

test('busy detection includes extended SQLite codes but not unrelated errors', () => {
  for (const errcode of [5, 6, 261, 517, 262]) {
    assert.equal(
      isSqliteBusyError(Object.assign(new Error('locked'), { errcode })),
      true
    )
  }
  for (const error of [
    null,
    {},
    new Error('database is locked'),
    Object.assign(new Error(), { errcode: 19 }),
    Object.assign(new Error(), { errcode: '5' })
  ]) {
    assert.equal(isSqliteBusyError(error), false)
  }
})

test('rejected Promise callbacks roll back without an unhandled rejection', async t => {
  const { db, insert, values } = setup(t)
  const failure = new Error('async failure')
  assert.throws(() => {
    // @ts-expect-error Verify runtime protection for an untyped caller.
    withTransaction(db, () => {
      insert(1)
      return Promise.reject(failure)
    })
  }, AsyncTransactionError)
  assert.throws(() => {
    // @ts-expect-error Verify the same protection for savepoints.
    withSavepoint(db, () => {
      insert(2)
      return Promise.reject(failure)
    })
  }, AsyncTransactionError)
  await setImmediate()
  assert.deepEqual(values(), [])
  assert.equal(db.isTransaction, false)
})

test('union return types cannot hide a Promise from the synchronous contract', t => {
  const { db, insert, values } = setup(t)
  const callback = (): number | Promise<number> => {
    insert(1)
    return Promise.resolve(1)
  }
  assert.throws(() => {
    // @ts-expect-error A union containing a Promise must also be rejected.
    withTransaction(db, callback)
  }, AsyncTransactionError)
  assert.deepEqual(values(), [])
})
