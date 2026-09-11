import { crc32, deflateSync } from 'node:zlib'

/** A real deterministic PNG, including chunk checksums and a complete image stream. */
export function testPng(width = 800, height = 1000, totalBytes?: number): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const output = Buffer.alloc(data.length + 12)
    output.writeUInt32BE(data.length)
    output.write(type, 4, 'ascii')
    data.copy(output, 8)
    output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length)
    return output
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // grayscale, one sample per pixel
  const pixels = Buffer.alloc((width + 1) * height, 255)
  for (let row = 0; row < height; row++) pixels[row * (width + 1)] = 0
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  if (totalBytes === undefined) return png
  const padded = Buffer.alloc(totalBytes)
  png.copy(padded)
  return padded
}
