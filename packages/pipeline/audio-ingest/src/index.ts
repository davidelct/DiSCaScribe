export { useAudioRecorder } from "./capture/use-audio-recorder"
export type { RecordedSegment } from "./capture/use-audio-recorder"
export { compressAudioFileToMp3 } from "./capture/compress-audio"
export type { CompressedAudio } from "./capture/compress-audio"
export { toAudioIngestError } from "./errors"
export {
  requestSystemAudioStream,
  warmupMicrophonePermission,
  warmupSystemAudioPermission,
  getPrimaryDesktopSource,
} from "./devices/system-audio"
