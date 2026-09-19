import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_COMPRESSION_TARGET_BYTES, chooseBitrateKbps } from "../capture/compress-audio.js"

// The two trial consultations of 2026-09-15: 7 minutes went out at 64 kbps
// and diarized well, 25 minutes went out at 16 kbps and did not.
const SEVEN_MINUTES = 445
const TWENTY_FIVE_MINUTES = 1484

test("the default budget drives long recordings down to 16 kbps", () => {
  assert.equal(chooseBitrateKbps(SEVEN_MINUTES), 64)
  assert.equal(chooseBitrateKbps(TWENTY_FIVE_MINUTES), 16)
  assert.equal(chooseBitrateKbps(TWENTY_FIVE_MINUTES, DEFAULT_COMPRESSION_TARGET_BYTES), 16)
})

test("an unlimited target holds every recording at the 64 kbps cap", () => {
  assert.equal(chooseBitrateKbps(TWENTY_FIVE_MINUTES, Number.POSITIVE_INFINITY), 64)
  assert.equal(chooseBitrateKbps(4 * 3600, Number.POSITIVE_INFINITY), 64)
})

test("a larger finite target scales the bitrate with it", () => {
  // 100 MB on a self-hosted server: an hour still fits at the cap.
  assert.equal(chooseBitrateKbps(3600, 100 * 1024 * 1024), 64)
  // 25 minutes into 3.8 MB is 16 kbps; into twice that is 40 kbps.
  assert.equal(chooseBitrateKbps(TWENTY_FIVE_MINUTES, 2 * DEFAULT_COMPRESSION_TARGET_BYTES), 40)
})

test("unknown duration falls back to a middling bitrate", () => {
  assert.equal(chooseBitrateKbps(0), 32)
})
