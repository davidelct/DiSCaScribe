import { test } from "node:test"
import assert from "node:assert/strict"
import { getArchivalConfig } from "../config"
import { BoxStorageClient } from "../box-adapter"

const BASE: Record<string, string | undefined> = {
  BOX_ENABLED: "true",
  BOX_FOLDER_ID: "111",
  BOX_FOLDER_ID_BYOK: "222",
  BOX_DEVELOPER_TOKEN: "tok",
}

function parentFolderOf(env: Record<string, string | undefined>, role: "full" | "byok"): string {
  const result = getArchivalConfig(role, env)
  assert.equal(result.enabled, true)
  if (!result.enabled) throw new Error("unreachable")
  return (result.client as BoxStorageClient).parentFolderId
}

test("full sessions archive to the main folder", () => {
  assert.equal(parentFolderOf(BASE, "full"), "111")
})

test("byok sessions archive to the BYOK folder", () => {
  assert.equal(parentFolderOf(BASE, "byok"), "222")
})

test("byok falls back to the main folder when BOX_FOLDER_ID_BYOK is unset", () => {
  assert.equal(parentFolderOf({ ...BASE, BOX_FOLDER_ID_BYOK: undefined }, "byok"), "111")
})

test("disabled when Box is unconfigured, regardless of role", () => {
  const result = getArchivalConfig("byok", { BOX_FOLDER_ID_BYOK: "222" })
  assert.equal(result.enabled, false)
})
