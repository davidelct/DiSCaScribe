import { test } from "node:test"
import assert from "node:assert/strict"
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { buildJwtAssertion } from "../client"
import type { BoxAuth } from "../config"

// A real encrypted PKCS#8 keypair, matching what the Box dev console generates.
const PASSPHRASE = "test-passphrase"
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: PASSPHRASE },
})

const AUTH: Extract<BoxAuth, { type: "jwt" }> = {
  type: "jwt",
  clientId: "cid",
  clientSecret: "secret",
  publicKeyId: "kid1",
  privateKey,
  passphrase: PASSPHRASE,
  subjectId: "679891",
  subjectType: "enterprise",
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>
}

test("assertion carries the claims Box requires", () => {
  const assertion = buildJwtAssertion(AUTH, 1_000_000)
  const [headerPart, claimsPart, signaturePart] = assertion.split(".")
  assert.ok(headerPart && claimsPart && signaturePart, "expected three JWT segments")

  const header = decodePart(headerPart)
  assert.equal(header.alg, "RS512")
  assert.equal(header.kid, "kid1")

  const claims = decodePart(claimsPart)
  assert.equal(claims.iss, "cid")
  assert.equal(claims.sub, "679891")
  assert.equal(claims.box_sub_type, "enterprise")
  assert.equal(claims.aud, "https://api.box.com/oauth2/token")
  assert.equal(claims.exp, 1_000_045)
  assert.match(String(claims.jti), /^[0-9a-f]{40}$/)
})

test("signature verifies against the public key (passphrase decryption works)", () => {
  const assertion = buildJwtAssertion(AUTH)
  const lastDot = assertion.lastIndexOf(".")
  const signingInput = assertion.slice(0, lastDot)
  const signature = Buffer.from(assertion.slice(lastDot + 1), "base64url")
  const ok = verify(
    "sha512",
    new Uint8Array(Buffer.from(signingInput)),
    createPublicKey(publicKey),
    new Uint8Array(signature),
  )
  assert.equal(ok, true)
})

test("each assertion gets a unique jti", () => {
  const a = buildJwtAssertion(AUTH, 1_000_000)
  const b = buildJwtAssertion(AUTH, 1_000_000)
  assert.notEqual(a, b)
})
