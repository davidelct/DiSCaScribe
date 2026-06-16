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

test("isBoxArchivingEnabled mirrors getBoxConfig", () => {
  assert.equal(isBoxArchivingEnabled({ ...BASE }), false)
  assert.equal(isBoxArchivingEnabled({ ...BASE, BOX_ENABLED: "true" }), true)
})
