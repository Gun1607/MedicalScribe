import React, { useState } from 'react';
import AudioRecorder from './components/AudioRecorder';
import VisitDisplay from './components/VisitDisplay';
import ConfirmDialog from './components/ConfirmDialog';
import { useToast } from './components/Toast';
import axios from 'axios';
import { Stethoscope, Loader2, UserRound, FileText, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [originalPayload, setOriginalPayload] = useState(null);
  const [currentPayload, setCurrentPayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [doctorId, setDoctorId] = useState('dr_admin');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [visitId, setVisitId] = useState(null);
  const [rawTranscript, setRawTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const toast = useToast();

  const handleTranscribe = async (audioBlob) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('doctor_id', doctorId);

    try {
      const response = await axios.post(`${API_URL}/api/transcribe`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

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

      toast.success('Audio transcribed and visit notes generated successfully.');
    } catch (error) {
      console.error('Error transcribing audio:', error);
      if (error.response) {
        const detail = error.response.data?.detail;
        const status = error.response.status;
        if (status === 413) {
          toast.error(detail || 'Audio file is too large.', 'File Limit');
        } else if (status === 422) {
          toast.error('Invalid audio format. Please try recording again.', 'Validation Error');
        } else if (status >= 500) {
          toast.error(detail || 'Server error. Please try again later.', 'Server Error');
        } else {
          toast.error(detail || 'Failed to transcribe audio.', 'Transcription Error');
        }
      } else if (error.request) {
        toast.error('Cannot reach the backend server. Please verify it is running on port 8000.', 'Connection Error');
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
                <p className="text-xs text-slate-400 leading-tight">v2.0</p>
              </div>
            </div>

            {/* Doctor selector */}
            <div className="flex items-center gap-2">
              <UserRound className="w-4 h-4 text-slate-400" />
              <label htmlFor="doctor-id" className="text-sm font-medium text-slate-600 hidden sm:block">
                Doctor ID:
              </label>
              <input
                id="doctor-id"
                type="text"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="w-36 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-colors"
                placeholder="Doctor ID"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Record Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Record Visit</h2>
          <AudioRecorder onStopRecording={handleTranscribe} disabled={isProcessing} />

          {/* Processing indicator */}
          {isProcessing && (
            <div className="mt-6 flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <p className="text-sm font-medium text-blue-800">Processing audio...</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Transcribing speech and generating structured visit notes. This may take a moment.
                </p>
              </div>
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
                <span className="font-semibold text-slate-800">Raw Whisper Transcript</span>
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
