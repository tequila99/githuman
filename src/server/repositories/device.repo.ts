import type { DatabaseSync } from 'node:sqlite'
import type { Device, DeviceState } from '../../shared/devices/types.ts'

interface DeviceRow {
  id: string
  name: string
  secret_hash: string
  state: DeviceState
  code: string
  host: string
  address: string
  created_at: string
  expires_at: string
  last_seen_at: string
}

/**
 * A device with the hash of its secret and its pairing code. The hash never
 * leaves the server. The code goes only to the device that asked (ADR 0080).
 */
export interface DeviceRecord extends Device {
  secretHash: string
  code: string
}

function rowToRecord(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    secretHash: row.secret_hash,
    state: row.state,
    code: row.code,
    host: row.host,
    address: row.address,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at
  }
}

/** Reads the server id, or stores the one from `create` on first use. */
export function ensureServerId(db: DatabaseSync, create: () => string): string {
  const row = db.prepare('SELECT id FROM server_identity LIMIT 1').get() as
    | { id: string }
    | undefined
  if (row) return row.id
  const id = create()
  db.prepare('INSERT INTO server_identity (id) VALUES (?)').run(id)
  return id
}

export function insertDevice(db: DatabaseSync, device: DeviceRecord): void {
  db.prepare(
    `INSERT INTO devices (id, name, secret_hash, state, code, host, address, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    device.id,
    device.name,
    device.secretHash,
    device.state,
    device.code,
    device.host,
    device.address,
    device.createdAt,
    device.expiresAt,
    device.lastSeenAt
  )
}

export function findDeviceById(
  db: DatabaseSync,
  id: string
): DeviceRecord | undefined {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as
    | DeviceRow
    | undefined
  return row ? rowToRecord(row) : undefined
}

export function findDeviceBySecretHash(
  db: DatabaseSync,
  secretHash: string
): DeviceRecord | undefined {
  const row = db
    .prepare('SELECT * FROM devices WHERE secret_hash = ?')
    .get(secretHash) as DeviceRow | undefined
  return row ? rowToRecord(row) : undefined
}

export function listDevices(db: DatabaseSync): DeviceRecord[] {
  const rows = db
    .prepare('SELECT * FROM devices ORDER BY created_at')
    .all() as unknown as DeviceRow[]
  return rows.map(rowToRecord)
}

export function countPendingDevices(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM devices WHERE state = 'pending'")
    .get() as { count: number }
  return row.count
}

/** Ids of pending requests from one client address. */
export function pendingDeviceIdsByAddress(
  db: DatabaseSync,
  address: string
): string[] {
  const rows = db
    .prepare("SELECT id FROM devices WHERE state = 'pending' AND address = ?")
    .all(address) as Array<{ id: string }>
  return rows.map(row => row.id)
}

/** Ids of records whose time is over. ISO times in UTC compare as text. */
export function expiredDeviceIds(
  db: DatabaseSync,
  nowIso: string,
  state?: DeviceState
): string[] {
  const sql =
    state === undefined
      ? 'SELECT id FROM devices WHERE expires_at <= ?'
      : 'SELECT id FROM devices WHERE expires_at <= ? AND state = ?'
  const params = state === undefined ? [nowIso] : [nowIso, state]
  const rows = db.prepare(sql).all(...params) as Array<{ id: string }>
  return rows.map(row => row.id)
}

export function updateDevice(
  db: DatabaseSync,
  id: string,
  fields: Partial<
    Pick<
      DeviceRecord,
      'name' | 'state' | 'address' | 'expiresAt' | 'lastSeenAt'
    >
  >
): void {
  const columns: Record<string, string | undefined> = {
    name: fields.name,
    state: fields.state,
    address: fields.address,
    expires_at: fields.expiresAt,
    last_seen_at: fields.lastSeenAt
  }
  const entries = Object.entries(columns).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
  if (entries.length === 0) return
  db.prepare(
    `UPDATE devices SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`
  ).run(...entries.map(([, value]) => value), id)
}

export function deleteDevice(db: DatabaseSync, id: string): boolean {
  return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0
}
