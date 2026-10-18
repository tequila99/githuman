/** Browser URL for an IP address and port: IPv6 needs brackets. */
export function addressUrl(address: string, port: number): string {
  return `http://${address.includes(':') ? `[${address}]` : address}:${port}`
}
