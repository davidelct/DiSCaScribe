/**
 * Adapts the existing BoxClient to the backend-neutral StorageClient interface,
 * so the shared two-phase orchestration can target Box unchanged. The parent
 * folder id (BOX_FOLDER_ID) is bound here; per-consult subfolders live under it.
 */

import { BoxClient } from "@/lib/box"
import type { BoxConfig } from "@/lib/box"
import type { StorageClient, StorageFileRef } from "./types"

export class BoxStorageClient implements StorageClient {
  private readonly client: BoxClient

  constructor(
    config: BoxConfig,
    private readonly parentFolderId: string,
  ) {
    this.client = BoxClient.fromConfig(config)
  }

  containerUrl(containerId: string): string {
    return `https://app.box.com/folder/${containerId}`
  }

  ensureContainer(name: string): Promise<string> {
    return this.client.ensureSubfolder(this.parentFolderId, name)
  }

  listFiles(containerId: string): Promise<Map<string, StorageFileRef>> {
    return this.client.listFolderFiles(containerId)
  }

  uploadFile(
    containerId: string,
    name: string,
    data: Buffer,
    contentType: string,
    existingId?: string,
  ): Promise<StorageFileRef> {
    return this.client.uploadFile(containerId, name, data, contentType, existingId)
  }
}
