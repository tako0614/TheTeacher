import { For, type Component } from "solid-js";
import { useToast, type Toast } from "../lib/toast-store";

const ToastItem: Component<{ toast: Toast; onClose: () => void }> = (props) => {
  const bgColor = () => {
    switch (props.toast.type) {
      case "success":
        return "bg-green-50 border-green-200 text-green-800";
      case "error":
        return "bg-red-50 border-red-200 text-red-800";
      case "warning":
        return "bg-yellow-50 border-yellow-200 text-yellow-800";
      case "info":
      default:
        return "bg-blue-50 border-blue-200 text-blue-800";
    }
  };

  const icon = () => {
    switch (props.toast.type) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "warning":
        return "⚠";
      case "info":
      default:
        return "ℹ";
    }
  };

  return (
    <div
      class={`animate-slide-in-right flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${bgColor()}`}
      role="alert"
    >
      <span class="text-lg font-bold">{icon()}</span>
      <p class="flex-1 text-sm font-medium">{props.toast.message}</p>
      <button
        onClick={props.onClose}
        class="text-lg font-bold opacity-50 transition hover:opacity-100"
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
};

const ToastContainer: Component = () => {
  const { toasts, removeToast } = useToast();

  return (
    <div
      class="pointer-events-none fixed right-6 top-6 z-50 flex flex-col gap-3"
      style={{ "max-width": "400px" }}
    >
      <For each={toasts()}>
        {(toast) => (
          <div class="pointer-events-auto">
            <ToastItem toast={toast} onClose={() => removeToast(toast.id)} />
          </div>
        )}
      </For>
    </div>
  );
};

export default ToastContainer;
