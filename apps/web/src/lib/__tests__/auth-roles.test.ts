import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { roleForPassword, sessionRole, sessionToken, gateEnabled, isValidSession } from "../auth"

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.DEMO_PASSWORD = "main-pass"
  process.env.DEMO_PASSWORD_BYOK = "tester-pass"
})

afterEach(() => {
  process.env.DEMO_PASSWORD = ORIGINAL_ENV.DEMO_PASSWORD
  process.env.DEMO_PASSWORD_BYOK = ORIGINAL_ENV.DEMO_PASSWORD_BYOK
})

test("roleForPassword maps each password to its role", () => {
  assert.equal(roleForPassword("main-pass"), "full")
  assert.equal(roleForPassword("tester-pass"), "byok")
  assert.equal(roleForPassword("wrong"), null)
  assert.equal(roleForPassword(""), null)
})

test("sessionRole derives the role from the cookie token", async () => {
  assert.equal(await sessionRole(await sessionToken("main-pass")), "full")
  assert.equal(await sessionRole(await sessionToken("tester-pass")), "byok")
  assert.equal(await sessionRole(await sessionToken("wrong")), null)
  assert.equal(await sessionRole(undefined), null)
})

test("isValidSession accepts both roles' tokens", async () => {
  assert.equal(await isValidSession(await sessionToken("main-pass")), true)
  assert.equal(await isValidSession(await sessionToken("tester-pass")), true)
  assert.equal(await isValidSession("garbage"), false)
})

test("byok password alone does not enable the gate", () => {
  delete process.env.DEMO_PASSWORD
  assert.equal(gateEnabled(), false)
})

test("gate off means every session is full-role", async () => {
  delete process.env.DEMO_PASSWORD
  delete process.env.DEMO_PASSWORD_BYOK
  assert.equal(await sessionRole(undefined), "full")
  assert.equal(await sessionRole("anything"), "full")
})
