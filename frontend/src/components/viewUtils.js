// Shared response view utilities

export function toHexDump(str) {
  const bytes = new TextEncoder().encode(str)
  const lines = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16)
    const addr = offset.toString(16).padStart(8, '0')
    const hexParts = []
    const asciiParts = []
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        hexParts.push(chunk[i].toString(16).padStart(2, '0'))
        const ch = chunk[i]
        asciiParts.push(ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : '.')
      } else {
        hexParts.push('  ')
        asciiParts.push(' ')
      }
    }
    const hex = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ')
    lines.push(`${addr}  ${hex}  |${asciiParts.join('')}|`)
  }
  if (lines.length === 0) return '(empty)'
  return lines.join('\n')
}

export function extractBody(rawResponse) {
  if (!rawResponse) return { headers: '', body: '', contentType: '' }
  const sepCRLF = rawResponse.indexOf('\r\n\r\n')
  const sepLF = rawResponse.indexOf('\n\n')
  let sep = -1
  let headerEnd = -1
  if (sepCRLF !== -1 && (sepLF === -1 || sepCRLF < sepLF)) {
    sep = sepCRLF; headerEnd = sepCRLF + 4
  } else if (sepLF !== -1) {
    sep = sepLF; headerEnd = sepLF + 2
  }
  if (sep === -1) return { headers: rawResponse, body: '', contentType: '' }
  const headers = rawResponse.slice(0, sep)
  const body = rawResponse.slice(headerEnd)
  const ctMatch = headers.match(/content-type:\s*([^\r\n]+)/i)
  const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : ''
  return { headers, body, contentType }
}

export function isJsonLike(contentType, body) {
  return contentType.includes('json') || (body.trimStart().startsWith('{') || body.trimStart().startsWith('['))
}

export function formatJson(body) {
  try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body }
}
