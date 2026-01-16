import { ErrorBoundary as SolidErrorBoundary, type Component, type JSX } from "solid-js";
import { logger } from "../lib/logger";

interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
  return (
    <div class="flex min-h-[400px] items-center justify-center p-8">
      <div class="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center shadow-lg">
        <div class="mb-4 text-4xl">⚠️</div>
        <h2 class="mb-2 text-lg font-bold text-rose-800">
          エラーが発生しました
        </h2>
        <p class="mb-4 text-sm text-rose-700">
          予期しないエラーが発生しました。問題が解決しない場合は、ページを再読み込みしてください。
        </p>
        <details class="mb-4 text-left">
          <summary class="cursor-pointer text-xs text-rose-600 hover:text-rose-800">
            詳細を表示
          </summary>
          <pre class="mt-2 overflow-auto rounded bg-rose-100 p-2 text-xs text-rose-900">
            {props.error.message}
          </pre>
        </details>
        <div class="flex justify-center gap-2">
          <button
            onClick={props.reset}
            class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            再試行
          </button>
          <button
            onClick={() => window.location.reload()}
            class="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            ページを再読み込み
          </button>
        </div>
      </div>
    </div>
  );
};

interface ErrorBoundaryProps {
  children: JSX.Element;
  fallback?: Component<ErrorFallbackProps>;
}

/**
 * Application Error Boundary component.
 * Catches uncaught errors and displays a user-friendly error message.
 */
const ErrorBoundary: Component<ErrorBoundaryProps> = (props) => {
  const handleError = (error: Error, reset: () => void) => {
    // Log the error
    logger.error("Uncaught error in ErrorBoundary", "ErrorBoundary", error);

    // Render fallback UI
    const FallbackComponent = props.fallback ?? ErrorFallback;
    return <FallbackComponent error={error} reset={reset} />;
  };

  return (
    <SolidErrorBoundary fallback={(error, reset) => handleError(error, reset)}>
      {props.children}
    </SolidErrorBoundary>
  );
};

export default ErrorBoundary;
