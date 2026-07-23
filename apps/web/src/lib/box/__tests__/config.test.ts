import { test } from "node:test"
import assert from "node:assert/strict"
import { getBoxConfig, isBoxArchivingEnabled } from "../config"

const BASE: Record<string, string | undefined> = {
  BOX_FOLDER_ID: "123456789",
  BOX_CLIENT_ID: "cid",
  BOX_CLIENT_SECRET: "secret",
  BOX_SUBJECT_ID: "ent-1",
}

test("disabled when BOX_ENABLED is not set", () => {
  const result = getBoxConfig({ ...BASE })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /BOX_ENABLED/)
})

test("disabled when BOX_ENABLED is false", () => {
  assert.equal(getBoxConfig({ ...BASE, BOX_ENABLED: "false" }).enabled, false)
})

test("accepts truthy BOX_ENABLED variants", () => {
  for (const v of ["true", "1", "yes", "on", "TRUE"]) {
    assert.equal(getBoxConfig({ ...BASE, BOX_ENABLED: v }).enabled, true, `BOX_ENABLED=${v}`)
  }
})

test("disabled when folder id missing", () => {
  const result = getBoxConfig({ ...BASE, BOX_ENABLED: "true", BOX_FOLDER_ID: "" })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /BOX_FOLDER_ID/)
})

test("CCG auth resolved with enterprise subject by default", () => {
  const result = getBoxConfig({ ...BASE, BOX_ENABLED: "true" })
  assert.equal(result.enabled, true)
  if (!result.enabled) return
  assert.equal(result.config.folderId, "123456789")
  assert.equal(result.config.auth.type, "ccg")
  if (result.config.auth.type !== "ccg") return
  assert.equal(result.config.auth.subjectType, "enterprise")
  assert.equal(result.config.auth.clientId, "cid")
})

test("BOX_SUBJECT_TYPE=user is honored", () => {
  const result = getBoxConfig({ ...BASE, BOX_ENABLED: "true", BOX_SUBJECT_TYPE: "user" })
  assert.equal(result.enabled, true)
  if (!result.enabled || result.config.auth.type !== "ccg") return assert.fail("expected ccg auth")
  assert.equal(result.config.auth.subjectType, "user")
})

test("developer token takes precedence over CCG", () => {
  const result = getBoxConfig({ ...BASE, BOX_ENABLED: "true", BOX_DEVELOPER_TOKEN: "tok" })
  assert.equal(result.enabled, true)
  if (!result.enabled) return
  assert.equal(result.config.auth.type, "token")
  if (result.config.auth.type !== "token") return
  assert.equal(result.config.auth.token, "tok")
})

test("disabled when CCG creds are incomplete and no token", () => {
  const result = getBoxConfig({
    BOX_ENABLED: "true",
    BOX_FOLDER_ID: "123",
    BOX_CLIENT_ID: "cid",
    // missing secret + subject
  })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /auth is incomplete/)
})

const JWT_FILE = JSON.stringify({
  boxAppSettings: {
    clientID: "jwt-cid",
    clientSecret: "jwt-secret",
    appAuth: { publicKeyID: "kid1", privateKey: "-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----", passphrase: "pp" },
  },
  enterpriseID: "679891",
})

test("JWT config resolved from raw JSON", () => {
  const result = getBoxConfig({ BOX_ENABLED: "true", BOX_FOLDER_ID: "123", BOX_JWT_CONFIG: JWT_FILE })
  assert.equal(result.enabled, true)
  if (!result.enabled || result.config.auth.type !== "jwt") return assert.fail("expected jwt auth")
  assert.equal(result.config.auth.clientId, "jwt-cid")
  assert.equal(result.config.auth.publicKeyId, "kid1")
  assert.equal(result.config.auth.subjectId, "679891")
  assert.equal(result.config.auth.subjectType, "enterprise")
})

test("JWT config resolved from base64", () => {
  const b64 = Buffer.from(JWT_FILE).toString("base64")
  const result = getBoxConfig({ BOX_ENABLED: "true", BOX_FOLDER_ID: "123", BOX_JWT_CONFIG: b64 })
  assert.equal(result.enabled, true)
  if (!result.enabled) return
  assert.equal(result.config.auth.type, "jwt")
})

test("JWT takes precedence over CCG, developer token over JWT", () => {
  const env = { ...BASE, BOX_ENABLED: "true", BOX_JWT_CONFIG: JWT_FILE }
  const jwtResult = getBoxConfig(env)
  assert.equal(jwtResult.enabled && jwtResult.config.auth.type, "jwt")
  const tokenResult = getBoxConfig({ ...env, BOX_DEVELOPER_TOKEN: "tok" })
  assert.equal(tokenResult.enabled && tokenResult.config.auth.type, "token")
})

test("BOX_SUBJECT_ID overrides the JWT file's enterpriseID", () => {
  const result = getBoxConfig({ BOX_ENABLED: "true", BOX_FOLDER_ID: "123", BOX_JWT_CONFIG: JWT_FILE, BOX_SUBJECT_ID: "42" })
  assert.equal(result.enabled, true)
  if (!result.enabled || result.config.auth.type !== "jwt") return assert.fail("expected jwt auth")
  assert.equal(result.config.auth.subjectId, "42")
})

test("malformed JWT config disables with a reason instead of falling back to CCG", () => {
  const result = getBoxConfig({ ...BASE, BOX_ENABLED: "true", BOX_JWT_CONFIG: "not-json-not-base64{{{" })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /BOX_JWT_CONFIG/)
})

test("JWT config missing fields disables with a reason", () => {
  const partial = JSON.stringify({ boxAppSettings: { clientID: "cid" }, enterpriseID: "1" })
  const result = getBoxConfig({ BOX_ENABLED: "true", BOX_FOLDER_ID: "123", BOX_JWT_CONFIG: partial })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /missing boxAppSettings/)
})

test("JWT with BOX_SUBJECT_TYPE=user requires explicit BOX_SUBJECT_ID", () => {
  const result = getBoxConfig({ BOX_ENABLED: "true", BOX_FOLDER_ID: "123", BOX_JWT_CONFIG: JWT_FILE, BOX_SUBJECT_TYPE: "user" })
  assert.equal(result.enabled, false)
  assert.match((result as { reason: string }).reason, /BOX_SUBJECT_ID/)
})

test("isBoxArchivingEnabled mirrors getBoxConfig", () => {
  assert.equal(isBoxArchivingEnabled({ ...BASE }), false)
  assert.equal(isBoxArchivingEnabled({ ...BASE, BOX_ENABLED: "true" }), true)
})
