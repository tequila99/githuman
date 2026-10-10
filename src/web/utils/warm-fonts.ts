// Weights of the code font that the interface uses (app.scss imports these faces).
const CODE_FONT_WEIGHTS = [400, 500, 600]

// Sample text for the font load: it selects the Latin and Cyrillic subsets.
const SAMPLE_TEXT = 'Aa Яя 0'

/**
 * Loads the faces of the code font before the first use. A face that loads
 * late changes the layout of all code text: the first click on a file
 * caused a frame of about 65 ms (#79).
 */
export function warmCodeFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono')
    .trim()
  if (!family) return
  for (const weight of CODE_FONT_WEIGHTS) {
    // A failed load only means the fallback font: nothing to do.
    document.fonts.load(`${weight} 14px ${family}`, SAMPLE_TEXT).catch(() => {})
  }
}
