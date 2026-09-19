/**
 * Microphone constraints for consultation capture.
 *
 * The browser's echo cancellation, noise suppression and automatic gain are
 * tuned for one voice on a video call. In a consultation room with two
 * people and one laptop they can work against the far speaker: the gain
 * settles on the loud near voice and turns the quiet far one down, and the
 * suppressor can treat that far voice as noise. "raw" switches all three off
 * so the microphone is recorded as it hears the room; "browser" is the
 * processing every recording had before the option existed.
 */

export type MicrophoneProcessing = "browser" | "raw"

export function buildMicrophoneConstraints(
  processing: MicrophoneProcessing,
  deviceId?: string,
): MediaTrackConstraints {
  const processed = processing !== "raw"
  return {
    echoCancellation: processed,
    noiseSuppression: processed,
    autoGainControl: processed,
    channelCount: 1,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  }
}
