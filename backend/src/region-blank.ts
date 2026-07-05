import { deflateSync } from "node:zlib";
import { comfy } from "./comfy.ts";

/**
 * A shared all-black mask that unfilled regional-prompt slots default to. An empty
 * `LoadImageMask` errors in ComfyUI, but a black mask masks nothing → the region is
 * a true no-op. Uploaded once (overwrite) to ComfyUI's input as `region_blank.png`.
 */
export const REGION_BLANK = "region_blank.png";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function blackPng(size = 64): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size); // filter byte 0 + RGB(0,0,0) rows — all zero
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let ensured = false;
/** Ensure the shared blank region mask exists in ComfyUI's input dir. Returns true
 *  once done (idempotent); false if ComfyUI wasn't reachable yet (caller retries). */
export async function ensureRegionBlank(): Promise<boolean> {
  if (ensured) return true;
  try {
    await comfy.uploadImage(REGION_BLANK, blackPng(64), "image/png");
    ensured = true;
    return true;
  } catch {
    return false; // ComfyUI not reachable yet
  }
}
