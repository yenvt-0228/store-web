export interface ImageFormat {
  mimeType: string;
  extension: string;
}

const FORMATS: {
  format: ImageFormat;
  matches: (buffer: Buffer) => boolean;
}[] = [
  {
    format: { mimeType: 'image/jpeg', extension: 'jpg' },
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    format: { mimeType: 'image/png', extension: 'png' },
    matches: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    format: { mimeType: 'image/webp', extension: 'webp' },
    matches: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    format: { mimeType: 'image/gif', extension: 'gif' },
    matches: (b) =>
      ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
  },
];

const HEADER_LENGTH = 12;

export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length < HEADER_LENGTH) return null;

  return FORMATS.find(({ matches }) => matches(buffer))?.format ?? null;
}

export const SUPPORTED_IMAGE_TYPES = FORMATS.map(
  ({ format }) => format.mimeType,
).join(', ');
