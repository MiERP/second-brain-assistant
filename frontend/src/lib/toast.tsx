"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast Portal/Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none select-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ duration: 0.2 }}
              className={`flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-md pointer-events-auto w-full text-xs font-medium leading-relaxed bg-background/95 ${
                t.type === "success"
                  ? "border-success/30 text-success"
                  : t.type === "error"
                  ? "border-danger/30 text-danger"
                  : t.type === "warning"
                  ? "border-warning/30 text-warning"
                  : "border-border text-foreground"
              }`}
            >
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5">
                {t.type === "success" ? (
                  <CheckCircle className="h-4 w-4 text-success" />
                ) : t.type === "error" ? (
                  <AlertCircle className="h-4 w-4 text-danger" />
                ) : t.type === "warning" ? (
                  <AlertCircle className="h-4 w-4 text-warning" />
                ) : (
                  <Info className="h-4 w-4 text-primary" />
                )}
              </div>

              {/* Message */}
              <div className="flex-1 text-[11px] text-foreground/90">{t.message}</div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="flex-shrink-0 hover:opacity-75 transition-opacity cursor-pointer p-0.5 rounded-full hover:bg-muted/40"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
