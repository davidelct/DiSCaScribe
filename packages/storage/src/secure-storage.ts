const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()
const KEY_ENV = (process.env.NEXT_PUBLIC_SECURE_STORAGE_KEY ?? "").trim()
const CURRENT_VERSION = "v2"
const LEGACY_VERSION = "v1"
const PREFIX_BASE = "enc"
const WEB_FALLBACK_KEY_STORAGE = "openscribe_encryption_key_web"

let keyPromise: Promise<CryptoKey> | null = null

/**
 * Get or generate the AES-GCM encryption key for this device.
 * Priority order:
 * 1. NEXT_PUBLIC_SECURE_STORAGE_KEY env var (set by `pnpm run setup` / deployment)
 * 2. A per-browser key generated and persisted in localStorage (dev fallback)
 */
async function getOrGenerateDeviceKey(): Promise<string> {
  // Environment-provided key (primary path).
  if (KEY_ENV) {
    if (base64ToBytes(KEY_ENV).byteLength !== 32) {
      throw new Error("NEXT_PUBLIC_SECURE_STORAGE_KEY must be a base64 encoded 256-bit key.")
    }
    return KEY_ENV
  }

  // Browser fallback for dev mode when env key is not configured.
  if (typeof window !== "undefined") {
    const storedKey = window.localStorage.getItem(WEB_FALLBACK_KEY_STORAGE)
    if (storedKey && base64ToBytes(storedKey).byteLength === 32) {
      return storedKey
    }

    const bytes = getCrypto().getRandomValues(new Uint8Array(32))
    const generatedKey = bytesToBase64(bytes)
    window.localStorage.setItem(WEB_FALLBACK_KEY_STORAGE, generatedKey)
    return generatedKey
  }

  throw new Error("NEXT_PUBLIC_SECURE_STORAGE_KEY must be configured.")
}

function getCrypto(): Crypto {
  const cryptoRef = (typeof globalThis !== "undefined" ? (globalThis as unknown as { crypto?: Crypto }).crypto : undefined) ?? null
  if (!cryptoRef || !cryptoRef.subtle) {
    throw new Error("Web Crypto API is not available in this environment.")
  }
  return cryptoRef
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof window === "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"))
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof window === "undefined") {
    return Buffer.from(bytes).toString("base64")
  }
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

async function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const keyBase64 = await getOrGenerateDeviceKey()
      const keyBytes = base64ToBytes(keyBase64)
      if (keyBytes.byteLength !== 32) {
        throw new Error("Encryption key must be a base64 encoded 256-bit key.")
      }
      return getCrypto().subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
    })().catch((error) => {
      keyPromise = null
      throw error
    })
  }
  return keyPromise
}

function parsePayload(value: string) {
  const parts = value.split(".")
  if (parts.length !== 4) return null
  if (parts[0] !== PREFIX_BASE) return null
  
  const version = parts[1]
  // Support both v1 and v2
  if (version !== CURRENT_VERSION && version !== LEGACY_VERSION) return null
  
  return { 
    version,
    iv: base64ToBytes(parts[2]), 
    data: base64ToBytes(parts[3]) 
  }
}

function formatPayload(iv: Uint8Array, ciphertext: Uint8Array, version: string = CURRENT_VERSION): string {
  return `${PREFIX_BASE}.${version}.${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`
}

export async function saveSecureItem<T>(key: string, value: T): Promise<void> {
  if (typeof window === "undefined") return
  const cryptoRef = getCrypto()
  const iv = cryptoRef.getRandomValues(new Uint8Array(12))
  const data = ENCODER.encode(JSON.stringify(value))
  const cryptoKey = await getKey()
  const encrypted = await cryptoRef.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data)
  window.localStorage.setItem(key, formatPayload(iv, new Uint8Array(encrypted), CURRENT_VERSION))
}

export async function loadSecureItem<T>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(key)
  if (!stored) return null
  
  const payload = parsePayload(stored)
  if (!payload) {
    // Try to parse as unencrypted JSON (legacy data)
    try {
      const parsed = JSON.parse(stored) as T
      // Auto-migrate to encrypted format
      try {
        await saveSecureItem(key, parsed)
      } catch {
        // Ignore migration failures but still return the readable value
      }
      return parsed
    } catch {
      // Invalid data, remove it
      window.localStorage.removeItem(key)
      return null
    }
  }
  
  // Decrypt with current key (works for both v1 and v2 if using same key)
  const cryptoKey = await getKey()
  const decrypted = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: payload.iv.buffer as ArrayBuffer },
    cryptoKey,
    payload.data.buffer as ArrayBuffer
  )
  
  try {
    const parsed = JSON.parse(DECODER.decode(decrypted)) as T
    
    // Auto-migrate v1 to v2 format
    if (payload.version === LEGACY_VERSION) {
      try {
        await saveSecureItem(key, parsed)
      } catch {
        // Migration failed but data is still readable
      }
    }
    
    return parsed
  } catch {
    // Decryption succeeded but JSON parsing failed
    window.localStorage.removeItem(key)
    return null
  }
}
