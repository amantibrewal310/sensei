export interface VoiceLayer {
  speak(text: string): Promise<void>
  onUserUtterance(cb: (text: string) => void): void
  interrupt(): void
  close(): void
}
