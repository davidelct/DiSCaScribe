"use client"

export async function warmupMicrophonePermission(): Promise<boolean> {
  if (typeof navigator === "undefined") return false
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch (error) {
    console.warn("Microphone permission request failed", error)
    return false
  }
}
