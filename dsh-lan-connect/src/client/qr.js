import qrcode from 'qrcode-generator';

/**
 * Encode one URL as a local QR data URL.
 *
 * qrcode-generator runs in this bundle and returns a GIF data URL; no external
 * image URL, HTML string, or network request is involved. Null means the input
 * was absent or encoding failed, and the card then renders text instead.
 * @param value - entry URL to encode.
 * @returns a data URL, or null on absent/invalid input or encoder failure.
 */
export function createQrDataUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    return code.createDataURL(4, 8);
  } catch {
    return null;
  }
}
