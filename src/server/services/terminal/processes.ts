import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TerminalRunning } from '../../../shared/terminal/types.ts'

// Give processes time to react to SIGHUP before SIGKILL.
const TERMINATE_GRACE_MS = 200
// A slow `ps` must not block the caller. The caller treats a timeout as unknown.
const PS_TIMEOUT_MS = 2000
// Bound the memory for the `ps` output on a host with many processes.
const PS_MAX_BUFFER_BYTES = 4 * 1024 * 1024
// PID 1 is init. PID 0 and -1 make kill() reach many processes. Never signal them.
const INIT_PID = 1

// Share the Node callback adapter without starting a shell.
const execute = promisify(execFile)

export interface ProcessRow {
  pid: number
  parent: number
  group: number
}

export async function processes(): Promise<ProcessRow[]> {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,pgid='], {
    timeout: PS_TIMEOUT_MS,
    maxBuffer: PS_MAX_BUFFER_BYTES
  })
  return stdout
    .trim()
    .split('\n')
    .map(line => {
      const [pid, parent, group] = line.trim().split(/\s+/).map(Number)
      return { pid, parent, group }
    })
    .filter(
      row =>
        Number.isInteger(row.pid) &&
        Number.isInteger(row.parent) &&
        Number.isInteger(row.group) &&
        row.pid > 0
    )
}

// Returns the process and its descendants, each parent before its children.
// One pass over a parent-to-children map keeps the cost linear.
export function descendants(rows: ProcessRow[], pid: number): ProcessRow[] {
  const byPid = new Map<number, ProcessRow>()
  const children = new Map<number, number[]>()
  for (const row of rows) {
    byPid.set(row.pid, row)
    const siblings = children.get(row.parent)
    if (siblings) {
      siblings.push(row.pid)
    } else {
      children.set(row.parent, [row.pid])
    }
  }
  // The queue grows while the loop reads it: this is a breadth-first walk.
  const order = [pid]
  const seen = new Set(order)
  for (const id of order) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      order.push(child)
    }
  }
  return order.flatMap(id => byPid.get(id) ?? [])
}

export async function processActivity(pid: number): Promise<TerminalRunning> {
  try {
    const rows = await processes()
    if (!rows.some(row => row.pid === pid)) return 'unknown'
    return descendants(rows, pid).some(row => row.pid !== pid)
      ? 'running'
      : 'idle'
  } catch {
    return 'unknown'
  }
}

export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  // PID 0 and -1 would reach the server's own group or every process of the user.
  if (!Number.isInteger(pid) || Math.abs(pid) <= INIT_PID) return
  try {
    process.kill(pid, signal)
  } catch {
    /* The process may have exited before the signal. */
  }
}

export async function terminateProcesses(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= INIT_PID) return
  // One snapshot keeps the targets and the group owners consistent.
  let all: ProcessRow[] = []
  try {
    all = await processes()
  } catch {
    /* The backend still terminates its shell. */
  }
  const targets = descendants(all, pid)
  const ids = new Set(targets.map(row => row.pid))
  // Only signal groups that are wholly owned by this shell tree.
  const groups = [
    ...new Set(targets.map(row => row.group).filter(group => group > INIT_PID))
  ].filter(group =>
    all.filter(row => row.group === group).every(row => ids.has(row.pid))
  )
  // oxlint-disable-next-line unicorn/no-array-reverse -- the type-aware checker lacks toReversed in this module
  const childrenFirst = targets.slice().reverse()
  const signalAll = (signal: NodeJS.Signals) => {
    // A group also reaches a child that started after the snapshot.
    for (const group of groups) signalProcess(-group, signal)
    for (const row of childrenFirst) signalProcess(row.pid, signal)
    signalProcess(pid, signal)
  }
  signalAll('SIGHUP')
  await new Promise<void>(resolve => setTimeout(resolve, TERMINATE_GRACE_MS))
  // A PID can be reused in the grace time. The risk is accepted: PIDs wrap slowly.
  signalAll('SIGKILL')
}
