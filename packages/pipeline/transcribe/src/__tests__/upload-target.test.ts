import assert from "node:assert/strict"
import test from "node:test"
import {
  DIRECT_UPLOAD_LIMIT_BYTES,
  HOSTED_REQUEST_BODY_LIMIT_BYTES,
  compressionTargetBytes,
  isVercelBlobUrl,
  resolveUploadCapability,
} from "../upload-target.js"

test("on Vercel without a Blob store the browser must fit the 4.5 MB request limit", () => {
  const capability = resolveUploadCapability({ VERCEL: "1" })
  assert.deepEqual(capability, { blob: false, directMaxBytes: HOSTED_REQUEST_BODY_LIMIT_BYTES })
  // The compression budget is the 3.8 MB the compressor always used.
  const target = compressionTargetBytes(capability)
  assert(target > 3.7 * 1024 * 1024 && target < 3.9 * 1024 * 1024, `unexpected target ${target}`)
})

test("a Blob store lifts the size budget entirely", () => {
  const capability = resolveUploadCapability({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })
  assert.equal(capability.blob, true)
  assert.equal(compressionTargetBytes(capability), Number.POSITIVE_INFINITY)
})

test("off Vercel only the route's own cap applies", () => {
  const capability = resolveUploadCapability({})
  assert.deepEqual(capability, { blob: false, directMaxBytes: DIRECT_UPLOAD_LIMIT_BYTES })
  assert(compressionTargetBytes(capability) > 80 * 1024 * 1024)
})

test("a blank token does not count as a Blob store", () => {
  assert.equal(resolveUploadCapability({ BLOB_READ_WRITE_TOKEN: "   " }).blob, false)
})

test("only URLs the Blob SDK could have issued are accepted as staged audio", () => {
  assert.equal(isVercelBlobUrl("https://abc123xyz.private.blob.vercel-storage.com/recordings/s1-full-Qw3.mp3"), true)
  assert.equal(isVercelBlobUrl("https://store.public.blob.vercel-storage.com/a.wav"), true)
  // Anything the server would otherwise fetch on the browser's say-so.
  assert.equal(isVercelBlobUrl("https://evil.example.com/private.blob.vercel-storage.com/a.mp3"), false)
  assert.equal(isVercelBlobUrl("https://private.blob.vercel-storage.com.evil.example/a.mp3"), false)
  assert.equal(isVercelBlobUrl("http://abc.private.blob.vercel-storage.com/a.mp3"), false)
  assert.equal(isVercelBlobUrl("https://169.254.169.254/latest/meta-data"), false)
  assert.equal(isVercelBlobUrl("not a url"), false)
})
