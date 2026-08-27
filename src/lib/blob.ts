// Server-side Vercel Blob helper. The upload store is PRIVATE, so bytes are read back with the
// store's read-write token (from BLOB_READ_WRITE_TOKEN in the environment), never a public URL.
import { get } from '@vercel/blob';

/** Download a (private) blob's bytes server-side. Throws if the blob is missing. */
export async function fetchBlobBytes(url: string): Promise<Uint8Array> {
  const res = await get(url, { access: 'private' }); // token resolved from BLOB_READ_WRITE_TOKEN
  if (!res) throw new Error(`blob not found: ${url}`);
  const buf = await new Response(res.stream).arrayBuffer();
  return new Uint8Array(buf);
}
