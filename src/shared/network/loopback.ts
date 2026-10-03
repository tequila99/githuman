const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host.toLowerCase())
}
