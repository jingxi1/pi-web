"use client";

import { useRef, useState, useCallback } from "react";

/**
 * Client-side hook for reading agent replies aloud via the server-side
 * /api/tts proxy (which forwards to the local speechAZ service).
 *
 * Only one audio can play at a time across the whole app — a single shared
 * Audio element means starting a new TTS stops the previous one.
 */
const sharedAudio = typeof Audio !== "undefined" ? new Audio() : null;

export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(sharedAudio);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  const speak = useCallback(async (text: string, voice?: string) => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, voice: voice ?? "zh-CN-YunxiNeural" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `TTS failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Create an Audio from an object URL (new Audio(url) keeps autoplay
      // within this user-gesture call chain without needing a separate
      // AudioContext unlock).
      const element = new Audio(url);
      element.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      element.onerror = () => {
        setPlaying(false);
        setError("Failed to play TTS audio");
        URL.revokeObjectURL(url);
      };
      element.play().then(() => {
        setPlaying(true);
      }).catch((err) => {
        setPlaying(false);
        setError(err instanceof Error ? err.message : "Playback blocked");
        URL.revokeObjectURL(url);
      });

      audioRef.current = element;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPlaying(false);
    }
  }, []);

  return { speak, stop, playing, error };
}
