/**
 * Cloudflare R2 storage client (server-side only), implementing StorageClient
 * over R2's S3-compatible API.
 *
 * R2 has no folders: the per-consult "container" is just a key prefix, and
 * files are objects at `<prefix>/<name>`. PutObject overwrites by key, so the
 * version-on-conflict handling Box needs collapses to a plain upload here.
 *
 * Requests are SigV4-signed with aws4fetch (tiny, isomorphic — uses global
 * fetch + Web Crypto, both present on the Node runtime these routes run on).
 * R2's region is always "auto".
 *
 * Docs: https://developers.cloudflare.com/r2/api/s3/api/
 */

import { AwsClient } from "aws4fetch"
import type { StorageClient, StorageFileRef } from "../types"

export interface R2Options {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export class R2ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = "R2ApiError"
  }
}

/** Encode an object key for a URL path, preserving `/` as path separators. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/")
}

/** Decode the handful of XML entities S3 uses in <Key> values. */
function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

export class R2Client implements StorageClient {
  private readonly aws: AwsClient
  private readonly endpoint: string
  private readonly bucket: string

  constructor(opts: R2Options) {
    this.endpoint = `https://${opts.accountId}.r2.cloudflarestorage.com`
    this.bucket = opts.bucket
    this.aws = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      service: "s3",
      region: "auto",
    })
  }

  static fromOptions(opts: R2Options): R2Client {
    return new R2Client(opts)
  }

  /**
   * Informational only: the S3 path of the container. Not browser-accessible
   * (requires signed requests); used for audit logs and the route response.
   */
  containerUrl(containerId: string): string {
    return `${this.endpoint}/${this.bucket}/${encodeKeyPath(containerId)}/`
  }

  /** No-op for R2 — the prefix needs no creation. Returns it unchanged. */
  async ensureContainer(name: string): Promise<string> {
    return name
  }

  async listFiles(containerId: string): Promise<Map<string, StorageFileRef>> {
    const prefix = `${containerId}/`
    const url = `${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`
    const res = await this.aws.fetch(url, { method: "GET" })
    if (!res.ok) {
      throw new R2ApiError(`R2 list failed for "${prefix}" (${res.status})`, res.status, await res.text())
    }
    const xml = await res.text()
    const map = new Map<string, StorageFileRef>()
    // A per-consult container holds only a handful of files, well under the
    // 1000-key page size, so a single (untruncated) listing is complete.
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = block[1]
      const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(body)
      if (!keyMatch) continue
      const key = xmlUnescape(keyMatch[1])
      if (!key.startsWith(prefix)) continue
      const name = key.slice(prefix.length)
      // Skip any pseudo-directory placeholders and nested keys.
      if (!name || name.includes("/")) continue
      const sizeMatch = /<Size>(\d+)<\/Size>/.exec(body)
      map.set(name, { id: key, name, size: sizeMatch ? Number(sizeMatch[1]) : undefined })
    }
    return map
  }

  async uploadFile(
    containerId: string,
    name: string,
    data: Buffer,
    contentType: string,
    _existingId?: string,
  ): Promise<StorageFileRef> {
    const key = `${containerId}/${name}`
    const url = `${this.endpoint}/${this.bucket}/${encodeKeyPath(key)}`
    const res = await this.aws.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(data),
    })
    if (!res.ok) {
      throw new R2ApiError(`R2 upload failed for "${key}" (${res.status})`, res.status, await res.text())
    }
    return { id: key, name, size: data.byteLength }
  }
}
