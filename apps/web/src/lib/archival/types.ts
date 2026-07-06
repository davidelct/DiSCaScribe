/**
 * Backend-neutral storage interface for consultation archival.
 *
 * The two-phase archival orchestration (see ./archive.ts) is written against
 * this interface, so the same per-consult layout can be pushed to Box (folders)
 * or Cloudflare R2 (object-key prefixes) — or any future backend — without the
 * orchestration knowing which. Each backend supplies a small adapter:
 *   - Box:  ./box-adapter.ts  (wraps the existing BoxClient)
 *   - R2:   ./r2/client.ts    (S3 PutObject / ListObjectsV2 over aws4fetch)
 */

export interface StorageFileRef {
  /** Backend id: a Box file id, or the full R2 object key. */
  id: string
  name: string
  size?: number
}

export interface StorageClient {
  /**
   * A human/dashboard URL for the per-consult container, used only for audit
   * logging and the route response — never for programmatic access.
   */
  containerUrl(containerId: string): string

  /**
   * Ensure the per-consult container exists and return its id. For Box this
   * creates (or reuses) a subfolder and returns its numeric id; for R2 there is
   * nothing to create, so it simply returns the key prefix.
   */
  ensureContainer(name: string): Promise<string>

  /** Files already present in the container, keyed by filename. */
  listFiles(containerId: string): Promise<Map<string, StorageFileRef>>

  /**
   * Create or overwrite a file in the container. `existingId` lets Box write a
   * new version of a known file; R2 overwrites by key and ignores it.
   */
  uploadFile(
    containerId: string,
    name: string,
    data: Buffer,
    contentType: string,
    existingId?: string,
  ): Promise<StorageFileRef>
}
