export function copyWindow(element: HTMLElement): HTMLElement {
  const copy = element.cloneNode(true)
  if (!(copy instanceof HTMLElement)) throw new Error('Invalid window snapshot')
  copy.inert = true
  copy.setAttribute('aria-hidden', 'true')
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute('id')
  }
  const sources = element.querySelectorAll('canvas')
  const canvases = copy.querySelectorAll('canvas')
  sources.forEach((canvas, index) => {
    const destination = canvases[index]
    if (!destination || !canvas.width || !canvas.height) return
    destination.getContext('2d')?.drawImage(canvas, 0, 0)
  })
  return copy
}
export function captureScroll(element: HTMLElement) {
  const positions = [
    element,
    ...element.querySelectorAll<HTMLElement>('*')
  ].map(node => ({ top: node.scrollTop, left: node.scrollLeft }))
  return (copy: HTMLElement) => {
    const targets = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
    positions.forEach((position, index) => {
      const target = targets[index]
      if (target) {
        target.scrollTop = position.top
        target.scrollLeft = position.left
      }
    })
  }
}
