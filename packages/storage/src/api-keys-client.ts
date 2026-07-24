/**
 * Bring-your-own-key (BYOK) provider keys, client side.
 *
 * Stored via secure-storage (AES-GCM-encrypted localStorage), so the keys live
 * only in this browser. They are attached to transcription/note requests and
 * used server-side for the single provider call — never persisted or logged on
 * the server. Required for BYOK-password sessions; optional otherwise (a
 * supplied key takes precedence over the server's env key).
 */

import { saveSecureItem, loadSecureItem } from "./secure-storage"

const BYOK_KEYS_STORAGE_KEY = "disca_byok_api_keys"

export interface ByokApiKeys {
  deepgramApiKey?: string
  anthropicApiKey?: string
}

export async function loadByokApiKeys(): Promise<ByokApiKeys> {
  if (typeof window === "undefined") return {}
  try {
    return (await loadSecureItem<ByokApiKeys>(BYOK_KEYS_STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

export async function saveByokApiKeys(keys: ByokApiKeys): Promise<void> {
  await saveSecureItem(BYOK_KEYS_STORAGE_KEY, {
    deepgramApiKey: keys.deepgramApiKey?.trim() || undefined,
    anthropicApiKey: keys.anthropicApiKey?.trim() || undefined,
  })
}
