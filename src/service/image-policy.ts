/** Internal image attachment byte policy (no model-facing options). */
/** Total decoded byte budget across one read response. */
export const MAX_INLINE_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
/** Per-image decoded byte budget. */
export const MAX_INLINE_IMAGE_SINGLE_BYTES = 8 * 1024 * 1024;

export const SUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Map a file extension to a supported raster media type, or undefined when unsupported. */
export function mediaTypeForExtension(ext: string): SupportedImageMediaType | undefined {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.png':
      return 'image/png';
    default:
      return undefined;
  }
}

/** True when the file extension names a supported raster image format. */
export function isSupportedImageExtension(ext: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext.toLowerCase());
}
