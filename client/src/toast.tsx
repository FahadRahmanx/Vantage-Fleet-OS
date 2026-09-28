import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * useToast — the app's one consistent feedback channel for action
 * results (did the thing I just clicked work), as opposed to per-field
 * form-validation errors, which stay inline next to the field.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const TOAST_COLORS: Record<ToastType, { bg: string; border: string }> = {
  success: { bg: "var(--color-success-light)", border: "var(--color-success)" },
  error: { bg: "var(--color-error-light)", border: "var(--color-error)" },
  info: { bg: "var(--color-surface)", border: "var(--color-border)" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Errors stay up longer — worth actually reading, not just glimpsing.
    setTimeout(() => dismiss(id), type === "error" ? 6000 : 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column-reverse",
          gap: 8,
          zIndex: 1000,
          maxWidth: 360,
        }}
      >
        {toasts.map((t) => {
          const colors = TOAST_COLORS[t.type];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--color-text)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 14, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

const PENDING_TOAST_KEY = "pendingToast";

/**
 * queuePendingToast — for actions that do a hard page reload
 * (impersonation start/exit switch the auth token, so every piece of
 * role-gated state needs to re-derive from scratch) where an
 * in-memory toast can't survive the reload. Written just before the
 * reload; consumePendingToast picks it up once the new page mounts.
 */
export function queuePendingToast(message: string, type: ToastType = "success") {
  localStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({ message, type }));
}

export function consumePendingToast(): { message: string; type: ToastType } | null {
  const raw = localStorage.getItem(PENDING_TOAST_KEY);
  if (!raw) return null;
  localStorage.removeItem(PENDING_TOAST_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
