export { parseWavHeader } from "./core/wav"
export type { WavInfo } from "./core/wav"
export { useSegmentUpload } from "./hooks/use-segment-upload"
export type { PendingSegment, UploadError } from "./hooks/use-segment-upload"

// Keyterm Prompting vocabulary (Nova-3).
export {
  DEFAULT_KEYTERMS,
  KEYTERM_TOKEN_BUDGET,
  KEYTERM_TOKEN_LIMIT,
  estimateKeytermTokens,
  formatKeyterms,
  parseKeyterms,
  resolveKeyterms,
  validateKeyterms,
  type KeytermValidation,
} from "./keyterms"

// Where a recording travels on its way to the transcriber, and how big it may be.
export {
  DIRECT_UPLOAD_LIMIT_BYTES,
  HOSTED_REQUEST_BODY_LIMIT_BYTES,
  compressionTargetBytes,
  isVercelBlobUrl,
  resolveUploadCapability,
  type UploadCapability,
} from "./upload-target"

// Word-level confidence, as offsets into the rendered transcript.
export {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  isLowConfidence,
  type TranscriptWordSpan,
} from "../../shared/src/transcript"

// Transcription provider (Deepgram only)
export {
  transcribeWavBuffer as transcribeWithDeepgram,
  transcribeWavBufferDetailed as transcribeWithDeepgramDetailed,
  transcriptFromDeepgramResponse,
  type DeepgramDetailedResult,
} from "./providers/deepgram-transcriber"
export {
  resolveTranscriptionProvider,
  transcribeWithResolvedProvider,
  transcribeWithResolvedProviderDetailed,
  type DetailedTranscription,
  type ResolvedTranscriptionProvider,
  type TranscriptionProvider,
  type TranscriptionRequestOptions,
} from "./providers/provider-resolver"
