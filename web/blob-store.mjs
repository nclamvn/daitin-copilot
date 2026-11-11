import { get, put, head, BlobPreconditionFailedError } from '@vercel/blob';
import { inspectSnapshot, snapshotPath, maxSnapshotBytes, SnapshotError } from './snapshot-runtime.mjs';

export async function conditionalETag(readETag, strongMetadata) {
  if (typeof readETag !== 'string' || !readETag) throw new SnapshotError('Kho pilot chưa có dấu kiểm phiên lưu.');
  if (!readETag.startsWith('W/')) return readETag;
  // Large JSON responses can be gzip-transformed and carry a weak HTTP ETag.
  // Never strip W/ blindly: bind the read body to unchanged origin metadata.
  const metadata = await strongMetadata();
  if (!metadata.etag || metadata.etag.startsWith('W/') || metadata.etag !== readETag.slice(2)) {
    throw new SnapshotError('Kho pilot vừa thay đổi trong khi đọc. Mở lại trước khi lưu.', 409);
  }
  return metadata.etag;
}

export function createBlobStore(pathname = process.env.DAI_TIN_BLOB_PATH ?? snapshotPath) {
  if (!/^pilot\/[a-zA-Z0-9_-]+\.json$/.test(pathname)) throw new Error('Đường dẫn kho pilot chưa hợp lệ.');
  return {
    async read() {
      const result = await get(pathname, { access: 'private', useCache: false });
      if (!result) return null;
      const state = JSON.parse(await new Response(result.stream).text());
      inspectSnapshot(state);
      const etag = await conditionalETag(result.blob.etag, () => head(pathname));
      return { state, etag };
    },
    async write(state, etag) {
      const body = JSON.stringify(state);
      if (Buffer.byteLength(body) > maxSnapshotBytes) throw new SnapshotError('Kho pilot vượt dung lượng cho phép.', 413);
      const result = await put(pathname, body, { access: 'private', addRandomSuffix: false,
        contentType: 'application/json', allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      return { etag: result.etag };
    },
    isConflict: error => error instanceof BlobPreconditionFailedError
  };
}
