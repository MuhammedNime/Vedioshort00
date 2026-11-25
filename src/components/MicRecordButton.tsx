import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { SlideAudioClip } from '../types/quiz';

interface MicRecordButtonProps {
  label?: string;
  fileNameBase: string;
  disabled?: boolean;
  compact?: boolean;
  onRecorded: (clip: SlideAudioClip) => void;
  onError?: (msg: string) => void;
}

export const MicRecordButton: React.FC<MicRecordButtonProps> = ({
  label = 'تسجيل',
  fileNameBase,
  disabled = false,
  compact = false,
  onRecorded,
  onError,
}) => {
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>(0);
  const startPerfRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = () => {
    window.clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  };

  const startRecording = async () => {
    if (disabled || recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError?.('المتصفح أو الجهاز لا يدعم تسجيل المايكروفون هنا.');
      return;
    }

    try {
      const bridge = (window as unknown as { AndroidNativeBridge?: { requestAudioPermission?: () => boolean } })
        .AndroidNativeBridge;
      bridge?.requestAudioPermission?.();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const chosenMime = mimeCandidates.find(
        (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
      );

      const rec = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorderRef.current = rec;
      startPerfRef.current = performance.now();
      setElapsedSec(0);

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      rec.onstop = async () => {
        window.clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);

        const measuredFallback = Math.max(0.4, (performance.now() - startPerfRef.current) / 1000);
        const blob = new Blob(chunks, { type: rec.mimeType || chosenMime || 'audio/webm' });
        if (blob.size < 100) return;

        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });

        const decodedDur = await soundEngine.getAudioDuration(dataUrl);
        onRecorded({
          fileName: `${fileNameBase}.webm`,
          dataUrl,
          duration: decodedDur > 0.15 ? decodedDur : measuredFallback,
        });
      };

      rec.start(100);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((performance.now() - startPerfRef.current) / 1000);
      }, 150);
    } catch {
      onError?.('يرجى السماح بصلاحية المايكروفون لتسجيل الصوت.');
      setRecording(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (recording ? stopRecording() : void startRecording())}
      title={recording ? 'إيقاف التسجيل وحفظه' : 'تسجيل صوتك بالمايكروفون مباشرة'}
      className={`flex items-center gap-1 rounded-lg border transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
        recording
          ? 'bg-rose-600 text-white border-rose-400 animate-pulse px-2 py-1 text-[11px] font-bold'
          : compact
            ? 'p-1.5 bg-[var(--panel)] border-[var(--pline)] hover:border-rose-400 text-rose-400'
            : 'px-2 py-1 bg-[var(--surface)] border-[var(--pline)] hover:border-rose-400 text-rose-400 text-[11px] font-medium'
      }`}
    >
      {recording ? (
        <>
          <Square className="w-3 h-3 fill-current" />
          <span className="font-mono-nums">{elapsedSec.toFixed(1)}ث</span>
        </>
      ) : (
        <>
          <Mic className="w-3.5 h-3.5" />
          {!compact && <span>{label}</span>}
        </>
      )}
    </button>
  );
};
