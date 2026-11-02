export function piFailureReason(message: unknown): string {
  if (typeof message !== 'string') return 'Pi model request failed.'
  if (/api.?key|unauthori[sz]ed|authenticat|\b40[13]\b/i.test(message)) {
    return 'Pi model authorization failed. Check the installed pi configuration.'
  }
  if (/no model|model.*not found|model.*not available/i.test(message)) {
    return 'Pi has no usable configured model. Check the installed pi configuration.'
  }
  if (/fetch|connect|ECONN|ENOTFOUND|network/i.test(message)) {
    return 'Pi model connection failed. Check the installed pi endpoint.'
  }
  if (/rate.?limit|quota|\b429\b/i.test(message)) {
    return 'Pi model provider limit was reached.'
  }
  return 'Pi model request failed. Check the installed pi configuration.'
}
