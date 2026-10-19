/** Slice by UTF-16 units without leaving a dangling high surrogate. */
export function safeStringSlice(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  let end = maxLen
  const code = str.charCodeAt(end - 1)
  if (code >= 0xD800 && code <= 0xDBFF) {
    end--
  }
  return str.slice(0, end)
}

/** Cut at a paragraph (late enough) or line boundary when one exists. */
export function truncateAtCleanBoundary(
  fullText: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (fullText.length <= maxChars) {
    return { text: fullText, truncated: false }
  }
  if (maxChars <= 0) {
    return { text: '', truncated: true }
  }

  const boundedSlice = safeStringSlice(fullText, maxChars)
  const paragraphIndex = boundedSlice.lastIndexOf('\n\n')
  const lineIndex = boundedSlice.lastIndexOf('\n')

  let cutIndex = -1
  if (paragraphIndex !== -1 && paragraphIndex >= Math.floor(maxChars * 0.7)) {
    cutIndex = paragraphIndex + 2
  } else if (lineIndex !== -1) {
    cutIndex = lineIndex + 1
  }

  if (cutIndex > 0) {
    const text = boundedSlice.slice(0, cutIndex)
    return { text, truncated: true }
  }

  const text = boundedSlice
  return { text, truncated: true }
}
