import { machineAddresses } from './lan-addresses.ts'
import { parseHost } from './request-origin.ts'

// DHCP can change an address; a short cache keeps the lookup cheap per request.
const ADDRESS_CACHE_MS = 5000

/**
 * `Host` values that a LAN request may use (ADR 0079): addresses of this
 * machine and the exact names from `--allowed-host`. A page of a rebound
 * hostile domain sends its own name, so it cannot reach the API or start
 * a pairing request.
 */
export class AllowedHosts {
  private readonly names: ReadonlySet<string>
  private readonly addresses: () => string[]
  private readonly now: () => number
  private cached: { at: number; hosts: Set<string> } | undefined

  constructor(
    names: readonly string[] = [],
    addresses: () => string[] = machineAddresses,
    now: () => number = Date.now
  ) {
    this.names = new Set(names.map(name => name.toLowerCase()))
    this.addresses = addresses
    this.now = now
  }

  allows(host: string | undefined): boolean {
    const hostname = parseHost(host)?.hostname
    if (hostname === undefined) return false
    const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    return this.names.has(bare) || this.machineHosts().has(bare)
  }

  private machineHosts(): Set<string> {
    const now = this.now()
    if (!this.cached || now - this.cached.at >= ADDRESS_CACHE_MS) {
      this.cached = {
        at: now,
        hosts: new Set(this.addresses().map(address => address.toLowerCase()))
      }
    }
    return this.cached.hosts
  }
}
