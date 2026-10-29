import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

let toastIdCounter = 0;

const VARIANTS = {
  success: {
    bg: 'bg-emerald-50 border-emerald-400',
    text: 'text-emerald-800',
    icon: CheckCircle2,
    iconColor: 'text-emerald-500',
  },
  error: {
    bg: 'bg-red-50 border-red-400',
    text: 'text-red-800',
    icon: AlertCircle,
    iconColor: 'text-red-500',
  },
  info: {
    bg: 'bg-blue-50 border-blue-400',
    text: 'text-blue-800',
    icon: Info,
    iconColor: 'text-blue-500',
  },
};

function Toast({ toast, onDismiss }) {
  const variant = VARIANTS[toast.variant] || VARIANTS.info;
  const Icon = variant.icon;

  return (
    <div
      className={`flex items-start gap-3 w-80 border-l-4 rounded-lg shadow-lg p-4 ${variant.bg} animate-slide-in`}
      role="alert"
    >
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${variant.iconColor}`} />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className={`text-sm font-semibold ${variant.text}`}>{toast.title}</p>
        )}
        <p className={`text-sm ${variant.text} ${toast.title ? 'mt-0.5' : ''}`}>
          {toast.message}
        </p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className={`shrink-0 p-0.5 rounded hover:bg-black/5 transition-colors ${variant.text}`}
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ message, title, variant = 'info', duration = 4000 }) => {
      const id = ++toastIdCounter;
      const newToast = { id, message, title, variant };
      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const toast = useCallback(
    (message, variant = 'info') => addToast({ message, variant }),
    [addToast]
  );
  toast.success = (message, title) => addToast({ message, title, variant: 'success' });
  toast.error = (message, title) => addToast({ message, title, variant: 'error' });
  toast.info = (message, title) => addToast({ message, title, variant: 'info' });

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
