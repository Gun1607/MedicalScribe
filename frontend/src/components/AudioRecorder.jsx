import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, RotateCcw, HardDrive } from 'lucide-react';
import { useToast } from './Toast';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const AudioRecorder = ({ onStopRecording, disabled }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      setIsSupported(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setHasRecorded(true);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
      setElapsedSeconds(0);
      setAudioBlob(null);
      setHasRecorded(false);

      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Microphone access was denied. Please allow microphone access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        toast.error('No microphone found. Please connect a microphone and try again.');
      } else {
        toast.error('Failed to access microphone. Please check your audio settings.');
      }
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const handleSubmit = useCallback(() => {
    if (audioBlob) {
      onStopRecording(audioBlob);
    }
  }, [audioBlob, onStopRecording]);

  const handleReRecord = useCallback(() => {
    setAudioBlob(null);
    setHasRecorded(false);
    setElapsedSeconds(0);
    startRecording();
  }, [startRecording]);

  if (!isSupported) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
        Your browser does not support audio recording. Please use a modern browser such as Chrome, Firefox, or Edge.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        {!isRecording && !hasRecorded && (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Mic className="w-5 h-5" />
            Start Recording
          </button>
        )}

        {isRecording && (
          <>
            <button
              onClick={stopRecording}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors shadow-sm"
            >
              <Square className="w-4 h-4" />
              Stop Recording
            </button>

            {/* Recording indicator with timer */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-red-600 font-medium text-sm">Recording</span>
              </div>
              <span className="font-mono text-lg text-slate-700 tabular-nums">
                {formatTime(elapsedSeconds)}
              </span>
            </div>

            {/* Waveform animation */}
            <div className="flex items-center gap-0.5 h-8" aria-hidden="true">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-red-500 rounded-full animate-waveform"
                  style={{
                    animationDelay: `${i * 0.15}s`,
                    height: '100%',
                  }}
                />
              ))}
            </div>
          </>
        )}

        {hasRecorded && !isRecording && (
          <>
            <button
              onClick={handleSubmit}
              disabled={disabled}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Mic className="w-5 h-5" />
              Submit Recording
            </button>
            <button
              onClick={handleReRecord}
              disabled={disabled}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
              Re-record
            </button>
          </>
        )}
      </div>

      {/* Recording info after stopping */}
      {hasRecorded && audioBlob && !isRecording && (
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="w-4 h-4" />
            {formatBytes(audioBlob.size)}
          </span>
          <span>Duration: {formatTime(elapsedSeconds)}</span>
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;
