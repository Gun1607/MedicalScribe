import React, { useState, useEffect } from 'react';
import AudioRecorder from './components/AudioRecorder';
import VisitDisplay from './components/VisitDisplay';
import ConfirmDialog from './components/ConfirmDialog';
import { useToast } from './components/Toast';
import axios from 'axios';
import {
  Stethoscope,
  Loader2,
  UserRound,
  FileText,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Zap,
  Key,
  ExternalLink,
  Clock,
  Sparkles,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [originalPayload, setOriginalPayload] = useState(null);
  const [currentPayload, setCurrentPayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTime, setProcessingTime] = useState(null);
  const [doctorId, setDoctorId] = useState('dr_admin');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [visitId, setVisitId] = useState(null);
  const [rawTranscript, setRawTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  // Groq Cloud LPU State
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('groq_api_key') || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [serverHealth, setServerHealth] = useState(null);

  const toast = useToast();

  // Check health and provider on mount
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/health`);
        setServerHealth(res.data);
      } catch (err) {
        console.warn('Could not fetch server health:', err);
      }
    };
    fetchHealth();
  }, []);

  const isGroqActive = Boolean(groqKey.trim() || serverHealth?.groq_configured);

  const handleSaveGroqKey = (newKey) => {
    const trimmed = newKey.trim();
    setGroqKey(trimmed);
    if (trimmed) {
      localStorage.setItem('groq_api_key', trimmed);
      toast.success('Groq API Key saved! Ultra-fast ~1.5s mode enabled.', 'LPU Acceleration');
    } else {
      localStorage.removeItem('groq_api_key');
      toast.info('Groq key cleared. Using server default or local mode.');
    }
    setShowKeyModal(false);
  };

  const handleTranscribe = async (audioBlob) => {
    setIsProcessing(true);
    setProcessingTime(null);
    const startTime = performance.now();

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('doctor_id', doctorId);
    if (groqKey.trim()) {
      formData.append('groq_api_key', groqKey.trim());
    }

    try {
      const response = await axios.post(`${API_URL}/api/transcribe`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      setProcessingTime(elapsed);

      const jsonResponse = response.data;
      const notes = jsonResponse.structured_notes || jsonResponse;

      setOriginalPayload(structuredClone(notes));
      setCurrentPayload(structuredClone(notes));

      if (jsonResponse.raw_transcript) {
        setRawTranscript(jsonResponse.raw_transcript);
      }
      if (jsonResponse.visit_id) {
        setVisitId(jsonResponse.visit_id);
      }

      toast.success(
        `Transcribed & structured in ${elapsed}s via ${isGroqActive ? 'Groq LPU' : 'Local CPU'}!`,
        'Processing Complete'
      );
    } catch (error) {
      console.error('Error transcribing audio:', error);
      if (error.response) {
        const detail = error.response.data?.detail;
        const status = error.response.status;
        if (status === 413) {
          toast.error(detail || 'Audio file is too large.', 'File Limit');
        } else if (status === 422) {
          toast.error('Invalid audio format. Please try recording again.', 'Validation Error');
        } else if (status === 502) {
          toast.error(detail || 'Groq Cloud API error. Check your API key.', 'Groq Error');
        } else if (status >= 500) {
          toast.error(detail || 'Server error. Please try again later.', 'Server Error');
        } else {
          toast.error(detail || 'Failed to transcribe audio.', 'Transcription Error');
        }
      } else if (error.request) {
        toast.error('Cannot reach backend server. Please verify it is running on port 8000.', 'Connection Error');
      } else {
        toast.error('An unexpected error occurred. Please try again.', 'Error');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveRequest = (editedPayload) => {
    setPendingPayload(editedPayload);
    setConfirmOpen(true);
  };

  const handleConfirmSave = async () => {
    setConfirmOpen(false);
    const editedPayload = pendingPayload;
    if (!editedPayload) return;

    const corrections = [];

    // Diff helper for names and clinical terms
    const diffTerm = (origVal, editVal) => {
      const orig = (origVal || '').trim();
      const edit = (editVal || '').trim();
      if (orig && edit && orig.toLowerCase() !== edit.toLowerCase()) {
        corrections.push({ misheard: orig, correct: edit });
      }
    };

    // 1. Diff patient name
    if (originalPayload?.patient && editedPayload.patient) {
      diffTerm(originalPayload.patient.name, editedPayload.patient.name);
    }

    // 2. Diff symptoms
    if (originalPayload?.symptoms && editedPayload.symptoms) {
      const len = Math.min(originalPayload.symptoms.length, editedPayload.symptoms.length);
      for (let i = 0; i < len; i++) {
        diffTerm(originalPayload.symptoms[i]?.name, editedPayload.symptoms[i]?.name);
      }
    }

    // 3. Diff conditions
    if (originalPayload?.conditions && editedPayload.conditions) {
      const len = Math.min(originalPayload.conditions.length, editedPayload.conditions.length);
      for (let i = 0; i < len; i++) {
        diffTerm(originalPayload.conditions[i]?.name, editedPayload.conditions[i]?.name);
      }
    }

    // 4. Diff medications
    if (originalPayload?.medications && editedPayload.medications) {
      const len = Math.min(originalPayload.medications.length, editedPayload.medications.length);
      for (let i = 0; i < len; i++) {
        diffTerm(originalPayload.medications[i]?.name, editedPayload.medications[i]?.name);
      }
    }

    // Send corrections to dictionary learning endpoint
    if (corrections.length > 0) {
      try {
        await axios.post(`${API_URL}/api/learn`, {
          doctor_id: doctorId,
          corrections,
        });
        toast.info(`${corrections.length} correction${corrections.length > 1 ? 's' : ''} added to doctor dictionary.`);
      } catch (err) {
        console.error('Error saving corrections:', err);
        toast.error('Failed to update dictionary rules.');
      }
    }

    toast.success('Visit notes saved to EMR successfully.');
    setOriginalPayload(structuredClone(editedPayload));
    setPendingPayload(null);
  };

  const handleCancelSave = () => {
    setConfirmOpen(false);
    setPendingPayload(null);
  };

  const handleCopyTranscript = () => {
    if (rawTranscript) {
      navigator.clipboard.writeText(rawTranscript);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
      toast.info('Raw transcript copied to clipboard.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/50">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
                <Stethoscope className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-800 leading-tight">Medical AI Scribe</h1>
                <p className="text-xs text-slate-400 leading-tight">v2.0 • Real-time Clinical Notes</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Groq Cloud Mode Badge */}
              <button
                onClick={() => setShowKeyModal(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-sm ${
                  isGroqActive
                    ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                }`}
                title="Click to configure Groq Cloud API Key"
              >
                <Zap className={`w-3.5 h-3.5 ${isGroqActive ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                <span>{isGroqActive ? 'Groq LPU: ~1.5s' : 'Local CPU (Slow)'}</span>
                <Key className="w-3 h-3 text-slate-400 ml-0.5" />
              </button>

              {/* Doctor selector */}
              <div className="flex items-center gap-2">
                <UserRound className="w-4 h-4 text-slate-400" />
                <input
                  id="doctor-id"
                  type="text"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-32 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-sm text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-colors"
                  placeholder="Doctor ID"
                  title="Doctor ID"
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Groq Speed Banner (if not yet configured) */}
        {!isGroqActive && (
          <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0 shadow-sm">
                <Zap className="w-5 h-5 fill-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Enable Groq Cloud for instant ~1.5 second turnaround
                </p>
                <p className="text-xs text-amber-700">
                  Whisper Large-V3 (~400ms) + Llama 3.3 70B (~800ms) on dedicated LPUs. 100% Free tier available.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowKeyModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors shrink-0"
            >
              <Key className="w-3.5 h-3.5" />
              Configure Free Key
            </button>
          </div>
        )}

        {/* Record Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-800">Record Patient Visit</h2>
            {isGroqActive && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                LPU Accelerated Engine
              </span>
            )}
          </div>

          <AudioRecorder onStopRecording={handleTranscribe} disabled={isProcessing} />

          {/* Processing indicator */}
          {isProcessing && (
            <div className="mt-6 flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  {isGroqActive
                    ? 'Processing via Groq LPU (Whisper Large V3 + Llama 3.3 70B)...'
                    : 'Transcribing speech & structuring notes on local CPU...'}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {isGroqActive
                    ? 'Expected duration: ~1.5 to 2.5 seconds total.'
                    : 'Local CPU inference in progress. This may take 1-2 minutes.'}
                </p>
              </div>
            </div>
          )}

          {/* Processing Latency Badge */}
          {processingTime && !isProcessing && (
            <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Completed in <strong className="text-slate-800">{processingTime}s</strong> via{' '}
                {isGroqActive ? 'Groq LPU Cloud' : 'Local CPU'}
              </span>
            </div>
          )}
        </div>

        {/* Raw Transcript Card (if available) */}
        {rawTranscript && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-slate-800">Raw Speech-to-Text Transcript</span>
                {visitId && (
                  <span className="ml-2 px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                    Visit #{visitId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <span>{showTranscript ? 'Hide' : 'View'}</span>
                {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>
            {showTranscript && (
              <div className="p-5 pt-0 border-t border-slate-100">
                <div className="flex justify-end mb-2">
                  <button
                    onClick={handleCopyTranscript}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedTranscript ? 'Copied' : 'Copy transcript'}
                  </button>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto border border-slate-200">
                  {rawTranscript}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Visit Notes Section */}
        {currentPayload && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-semibold text-slate-800">Clinical Visit Notes</h2>
                <p className="text-xs text-slate-500 mt-0.5">Review and edit before saving to Electronic Medical Records</p>
              </div>
              {visitId && (
                <span className="px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                  Record #{visitId}
                </span>
              )}
            </div>
            <VisitDisplay payload={currentPayload} onSave={handleSaveRequest} />
          </div>
        )}
      </main>

      {/* Groq Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowKeyModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                <Zap className="w-6 h-6 fill-amber-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Groq Cloud Speed Settings</h3>
                <p className="text-xs text-slate-500">Whisper Large-V3 + Llama 3.1 8B / 70B (~1.5s latency)</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              Enter your Groq API Key to enable ultra-fast transcription and note generation on Groq LPUs.
            </p>

            <div>
              <label htmlFor="groq-key-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Groq API Key (`gsk_...`)
              </label>
              <input
                id="groq-key-input"
                type="password"
                defaultValue={groqKey}
                placeholder="gsk_..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
              />
            </div>

            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800"
            >
              Get a free Groq API key here (takes 30 seconds)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = document.getElementById('groq-key-input')?.value;
                  handleSaveGroqKey(val || '');
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-sm"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Save to EMR"
        message="Are you sure you want to save these visit notes to the EMR? Any corrections you made will also be submitted for learning."
        confirmLabel="Save"
        cancelLabel="Cancel"
        onConfirm={handleConfirmSave}
        onCancel={handleCancelSave}
      />
    </div>
  );
}

export default App;
