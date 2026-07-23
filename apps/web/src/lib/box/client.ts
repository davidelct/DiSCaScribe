/**
 * Minimal Box API client for archival uploads (server-side only).
 *
 * Supports all three auth modes (JWT server auth, Client Credentials Grant,
 * and a developer token),
 * ensures a per-consultation subfolder exists, and uploads files via Box's
 * simple endpoint (≤ 50 MB) or chunked upload sessions (larger). Uploads are
 * idempotent: when a file of the same name already exists it is written as a
 * new version, so re-archiving a consultation updates in place rather than
 * duplicating.
 *
 * Docs: https://developer.box.com/reference/
 */

import { createHash, createPrivateKey, randomBytes, sign as signPayload } from "node:crypto"
import type { BoxAuth, BoxConfig } from "./config"

const TOKEN_URL = "https://api.box.com/oauth2/token"
const API_BASE = "https://api.box.com/2.0"
const UPLOAD_BASE = "https://upload.box.com/api/2.0"

/** Box simple upload accepts up to 50 MB; anything larger must be chunked. */
const SIMPLE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

export interface BoxFileRef {
  id: string
  name: string
  size?: number
}

export class BoxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = "BoxApiError"
  }
}

interface BoxConflictResponse {
  context_info?: { conflicts?: { id?: string } | Array<{ id?: string }> }
}

function extractConflictId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as BoxConflictResponse
    const conflicts = parsed.context_info?.conflicts
    if (Array.isArray(conflicts)) return conflicts[0]?.id ?? null
    return conflicts?.id ?? null
  } catch {
    return null
  }
}

function sha1Base64(data: Buffer): string {
  return createHash("sha1").update(new Uint8Array(data)).digest("base64")
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

/**
 * Build the signed JWT assertion for Box server auth (RS512, per Box's SDKs).
 * The private key from the dev-console config JSON is an encrypted PKCS#8 PEM;
 * node:crypto decrypts it with the accompanying passphrase. Box caps `exp` at
 * 60 seconds out, so the assertion is minted fresh per token request.
 */
export function buildJwtAssertion(
  auth: Extract<BoxAuth, { type: "jwt" }>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "RS512", typ: "JWT", kid: auth.publicKeyId }
  const claims = {
    iss: auth.clientId,
    sub: auth.subjectId,
    box_sub_type: auth.subjectType,
    aud: TOKEN_URL,
    jti: randomBytes(20).toString("hex"),
    exp: nowSeconds + 45,
  }
  const signingInput = `${base64Url(header)}.${base64Url(claims)}`
  const key = createPrivateKey({ key: auth.privateKey, passphrase: auth.passphrase })
  const signature = signPayload("sha512", new Uint8Array(Buffer.from(signingInput)), key).toString("base64url")
  return `${signingInput}.${signature}`
}

export class BoxClient {
  private cachedToken: { value: string; expiresAt: number } | null = null

  constructor(private readonly auth: BoxAuth) {}

  static fromConfig(config: BoxConfig): BoxClient {
    return new BoxClient(config.auth)
  }

  private async getToken(): Promise<string> {
    if (this.auth.type === "token") return this.auth.token

    const now = Date.now()
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.value
    }

    const grant: Record<string, string> =
      this.auth.type === "jwt"
        ? {
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: buildJwtAssertion(this.auth),
            client_id: this.auth.clientId,
            client_secret: this.auth.clientSecret,
          }
        : {
            grant_type: "client_credentials",
            client_id: this.auth.clientId,
            client_secret: this.auth.clientSecret,
            box_subject_type: this.auth.subjectType,
            box_subject_id: this.auth.subjectId,
          }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(grant),
    })
    if (!res.ok) {
      throw new BoxApiError(`Box token request failed (${res.status})`, res.status, await res.text())
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number }
    const expiresInMs = (json.expires_in ?? 3600) * 1000
    this.cachedToken = { value: json.access_token, expiresAt: now + expiresInMs }
    return json.access_token
  }

  private async authHeader(): Promise<{ Authorization: string }> {
    return { Authorization: `Bearer ${await this.getToken()}` }
  }

  /** GET/POST a JSON API request with one retry on 429/5xx. */
  private async apiJson(
    url: string,
    init: RequestInit & { body?: string } = {},
    attempt = 1,
  ): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { ...(await this.authHeader()), "Content-Type": "application/json", ...init.headers },
    })
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await wait(300 * attempt)
      return this.apiJson(url, init, attempt + 1)
    }
    return res
  }

  /**
   * Return the ID of a subfolder named `name` under `parentId`, creating it if
   * absent. Reuses the existing folder on a name conflict (idempotent).
   */
  async ensureSubfolder(parentId: string, name: string): Promise<string> {
    const res = await this.apiJson(`${API_BASE}/folders`, {
      method: "POST",
      body: JSON.stringify({ name, parent: { id: parentId } }),
    })
    if (res.status === 201) {
      const json = (await res.json()) as { id: string }
      return json.id
    }
    if (res.status === 409) {
      const body = await res.text()
      const existingId = extractConflictId(body)
      if (existingId) return existingId
      throw new BoxApiError("Box folder name conflict without a resolvable id", 409, body)
    }
    throw new BoxApiError(`Box folder create failed (${res.status})`, res.status, await res.text())
  }

  /** List a folder's direct children as a name → file ref map (files only). */
  async listFolderFiles(folderId: string): Promise<Map<string, BoxFileRef>> {
    const res = await this.apiJson(
      `${API_BASE}/folders/${folderId}/items?fields=id,name,type,size&limit=1000`,
      { method: "GET" },
    )
    if (!res.ok) {
      throw new BoxApiError(`Box folder listing failed (${res.status})`, res.status, await res.text())
    }
    const json = (await res.json()) as { entries?: Array<{ id: string; name: string; type: string; size?: number }> }
    const map = new Map<string, BoxFileRef>()
    for (const entry of json.entries ?? []) {
      if (entry.type === "file") map.set(entry.name, { id: entry.id, name: entry.name, size: entry.size })
    }
    return map
  }

  /**
   * Upload a file into `folderId`, choosing simple vs chunked by size. When
   * `existingFileId` is provided the bytes are written as a new version of that
   * file; otherwise a new file is created.
   */
  async uploadFile(
    folderId: string,
    name: string,
    data: Buffer,
    contentType: string,
    existingFileId?: string,
  ): Promise<BoxFileRef> {
    if (data.byteLength > SIMPLE_UPLOAD_MAX_BYTES) {
      return this.chunkedUpload(folderId, name, data, existingFileId)
    }
    return this.simpleUpload(folderId, name, data, contentType, existingFileId)
  }

  private async simpleUpload(
    folderId: string,
    name: string,
    data: Buffer,
    contentType: string,
    existingFileId?: string,
  ): Promise<BoxFileRef> {
    const url = existingFileId
      ? `${UPLOAD_BASE}/files/${existingFileId}/content`
      : `${UPLOAD_BASE}/files/content`
    const attributes = existingFileId ? { name } : { name, parent: { id: folderId } }

    const form = new FormData()
    form.append("attributes", JSON.stringify(attributes))
    form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), name)

    const res = await fetch(url, {
      method: "POST",
      headers: await this.authHeader(),
      body: form,
    })

    // New-file conflict: a same-named file exists — retry as a new version.
    if (res.status === 409 && !existingFileId) {
      const conflictId = extractConflictId(await res.text())
      if (conflictId) return this.simpleUpload(folderId, name, data, contentType, conflictId)
    }
    if (!res.ok) {
      throw new BoxApiError(`Box upload failed for "${name}" (${res.status})`, res.status, await res.text())
    }
    const json = (await res.json()) as { entries: BoxFileRef[] }
    return json.entries[0]
  }

  private async chunkedUpload(
    folderId: string,
    name: string,
    data: Buffer,
    existingFileId?: string,
  ): Promise<BoxFileRef> {
    // 1. Create the upload session (new file or new version of an existing one).
    const sessionUrl = existingFileId
      ? `${UPLOAD_BASE}/files/${existingFileId}/upload_sessions`
      : `${UPLOAD_BASE}/files/upload_sessions`
    const sessionBody = existingFileId
      ? { file_size: data.byteLength, file_name: name }
      : { folder_id: folderId, file_size: data.byteLength, file_name: name }

    const sessionRes = await this.apiJson(sessionUrl, {
      method: "POST",
      body: JSON.stringify(sessionBody),
    })
    if (!sessionRes.ok) {
      // Same-named file exists — restart the session as a new version.
      if (sessionRes.status === 409 && !existingFileId) {
        const conflictId = extractConflictId(await sessionRes.text())
        if (conflictId) return this.chunkedUpload(folderId, name, data, conflictId)
      }
      throw new BoxApiError(
        `Box upload session create failed for "${name}" (${sessionRes.status})`,
        sessionRes.status,
        await sessionRes.text(),
      )
    }
    const session = (await sessionRes.json()) as {
      id: string
      part_size: number
      session_endpoints?: { upload_part?: string; commit?: string }
    }
    const partSize = session.part_size
    const uploadPartUrl = session.session_endpoints?.upload_part || `${UPLOAD_BASE}/files/upload_sessions/${session.id}`
    const commitUrl = session.session_endpoints?.commit || `${UPLOAD_BASE}/files/upload_sessions/${session.id}/commit`

    // 2. Upload each part with its Content-Range and SHA-1 digest.
    const parts: unknown[] = []
    for (let offset = 0; offset < data.byteLength; offset += partSize) {
      const end = Math.min(offset + partSize, data.byteLength)
      const chunk = data.subarray(offset, end)
      const partRes = await fetch(uploadPartUrl, {
        method: "PUT",
        headers: {
          ...(await this.authHeader()),
          "Content-Type": "application/octet-stream",
          Digest: `sha=${sha1Base64(chunk)}`,
          "Content-Range": `bytes ${offset}-${end - 1}/${data.byteLength}`,
        },
        body: new Uint8Array(chunk),
      })
      if (!partRes.ok) {
        throw new BoxApiError(
          `Box chunk upload failed for "${name}" at ${offset} (${partRes.status})`,
          partRes.status,
          await partRes.text(),
        )
      }
      const partJson = (await partRes.json()) as { part: unknown }
      parts.push(partJson.part)
    }

    // 3. Commit with the whole-file digest. 202 means Box is still assembling.
    const digest = `sha=${sha1Base64(data)}`
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const commitRes = await fetch(commitUrl, {
        method: "POST",
        headers: { ...(await this.authHeader()), "Content-Type": "application/json", Digest: digest },
        body: JSON.stringify({ parts }),
      })
      if (commitRes.status === 202) {
        const retryAfter = Number(commitRes.headers.get("retry-after") || "1")
        await wait(Math.max(1, retryAfter) * 1000)
        continue
      }
      if (!commitRes.ok) {
        throw new BoxApiError(
          `Box upload commit failed for "${name}" (${commitRes.status})`,
          commitRes.status,
          await commitRes.text(),
        )
      }
      const json = (await commitRes.json()) as { entries: BoxFileRef[] }
      return json.entries[0]
    }
    throw new BoxApiError(`Box upload commit did not finish for "${name}"`, 202)
  }
}
