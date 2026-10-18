import { isIPv4, isIPv6 } from 'node:net'

// An IPv6 client owns a whole /64 and can take any address inside it.
const IPV6_PREFIX_GROUPS = 4
const IPV4_MAPPED_PREFIX = '::ffff:'

/** Expands an IPv6 address into 8 groups. The address must be valid. */
function ipv6Groups(address: string): string[] {
  const [head = '', tail] = address.split('::')
  const headGroups = head === '' ? [] : head.split(':')
  if (tail === undefined) return headGroups
  const tailGroups = tail === '' ? [] : tail.split(':')
  const gap = 8 - headGroups.length - tailGroups.length
  return [...headGroups, ...Array<string>(gap).fill('0'), ...tailGroups]
}

/**
 * Key that limits pairing requests of one client. An IPv6 address maps to
 * its /64 prefix, an IPv4-mapped address to the IPv4 address. Any other
 * text stays as it is.
 */
export function addressKey(address: string): string {
  const plain = address.split('%')[0] ?? address
  if (plain.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped = plain.slice(IPV4_MAPPED_PREFIX.length)
    if (isIPv4(mapped)) return mapped
  }
  if (!isIPv6(plain)) return address
  const groups = ipv6Groups(plain.toLowerCase())
    .slice(0, IPV6_PREFIX_GROUPS)
    .map(group => parseInt(group, 16).toString(16))
  return `${groups.join(':')}::/64`
}
