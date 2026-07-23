/**
 * Storage interface for consultation archival.
 *
 * The two-phase archival orchestration (see ./archive.ts) is written against
 * this interface rather than a concrete client, keeping the per-consult layout
 * independent of the backend. Box is the sole implementation
 * (./box-adapter.ts, wrapping BoxClient).
 */

export interface StorageFileRef {
  /** Backend id (a Box file id). */
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
   * creates (or reuses) a subfolder and returns its numeric id.
   */
  ensureContainer(name: string): Promise<string>

  /** Files already present in the container, keyed by filename. */
  listFiles(containerId: string): Promise<Map<string, StorageFileRef>>

  /**
   * Create or overwrite a file in the container. `existingId` lets Box write a
   * new version of a known file instead of creating a duplicate.
   */
  uploadFile(
    containerId: string,
    name: string,
    data: Buffer,
    contentType: string,
    existingId?: string,
  ): Promise<StorageFileRef>
}
