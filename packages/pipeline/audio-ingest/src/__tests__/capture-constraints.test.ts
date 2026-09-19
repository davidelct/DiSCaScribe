import assert from "node:assert/strict"
import test from "node:test"
import { buildMicrophoneConstraints } from "../capture/capture-constraints.js"

test("browser processing keeps the filters every earlier recording had", () => {
  assert.deepEqual(buildMicrophoneConstraints("browser"), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  })
})

test("raw turns every filter off and keeps mono", () => {
  assert.deepEqual(buildMicrophoneConstraints("raw"), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  })
})

test("a chosen device is required exactly, in either mode", () => {
  assert.deepEqual(buildMicrophoneConstraints("raw", "mic-42").deviceId, { exact: "mic-42" })
  assert.equal("deviceId" in buildMicrophoneConstraints("raw", ""), false)
})
