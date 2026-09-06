/** Internal image attachment byte policy (no model-facing options). */
/** Total decoded byte budget across one read response. */
export declare const MAX_INLINE_IMAGE_TOTAL_BYTES: number;
/** Per-image decoded byte budget. */
export declare const MAX_INLINE_IMAGE_SINGLE_BYTES: number;
export declare const SUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string>;
export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
/** Map a file extension to a supported raster media type, or undefined when unsupported. */
export declare function mediaTypeForExtension(ext: string): SupportedImageMediaType | undefined;
/** True when the file extension names a supported raster image format. */
export declare function isSupportedImageExtension(ext: string): boolean;
