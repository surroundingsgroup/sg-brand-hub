"use client";

// Voice to text in the browser, for the meeting notes box.
//
// Uses the browser's built-in speech recognition (Chrome, Edge and Safari;
// not Firefox). In Chrome the audio is transcribed by Google's speech
// service, the same as Chrome's own voice typing. Recognition runs in
// continuous mode and restarts itself when the browser ends a session
// (Chrome stops after a pause or a few minutes), so a whole meeting can be
// captured. A separate microphone stream feeds a level meter for the pill.

import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationMode = "dictate" | "meeting";

export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState<DictationMode | null>(null);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0); // 0..1 microphone level
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const wantOn = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const audio = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);

  useEffect(() => setSupported(Boolean(getRecognitionCtor())), []);

  const stopMeter = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close().catch(() => {});
    audio.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel((prev) => prev * 0.6 + Math.min(1, rms * 4) * 0.4);
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch {
      // No meter is fine; recognition asks for the mic on its own.
    }
  }, []);

  const stop = useCallback(() => {
    wantOn.current = false;
    recRef.current?.stop();
    recRef.current = null;
    stopMeter();
    setActive(null);
    setInterim("");
    setStartedAt(null);
  }, [stopMeter]);

  const start = useCallback(
    (mode: DictationMode) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        setError("Voice typing needs Chrome, Edge or Safari.");
        return;
      }
      setError(null);
      wantOn.current = true;

      const begin = () => {
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (e) => {
          let live = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            const text = r[0]?.transcript ?? "";
            if (r.isFinal) {
              const clean = text.trim();
              if (clean) onFinalRef.current(clean.charAt(0).toUpperCase() + clean.slice(1));
            } else live += text;
          }
          setInterim(live.trim());
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setError("Microphone access is blocked. Allow it in the address bar, then try again.");
            wantOn.current = false;
          } else if (e.error !== "no-speech" && e.error !== "aborted") {
            setError(`Voice typing stopped (${e.error}).`);
          }
        };
        // The browser ends sessions on its own (pauses, time limits); keep going until stopped.
        rec.onend = () => {
          if (wantOn.current) {
            try {
              begin();
            } catch {
              /* start can throw if a session is still closing; the next end retries */
            }
          } else {
            setInterim("");
          }
        };
        recRef.current = rec;
        rec.start();
      };

      begin();
      void startMeter();
      setActive(mode);
      setStartedAt(Date.now());
    },
    [startMeter]
  );

  useEffect(() => stop, [stop]);

  return { supported, active, interim, level, startedAt, error, start, stop, clearError: () => setError(null) };
}
