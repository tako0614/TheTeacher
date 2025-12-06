const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          prompt: (callback?: (notification: GooglePrompt) => void) => void;
        };
      };
    };
  }
}

interface GooglePrompt {
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
  getNotDisplayedReason?: () => string | null;
  getSkippedReason?: () => string | null;
}

let scriptPromise: Promise<void> | null = null;

const loadGoogleScript = () => {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google Sign-In is only available in the browser"));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")), {
        once: true,
      });
      if (existing.dataset.ready === "true") resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      script.dataset.ready = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
};

export const getGoogleIdToken = async (): Promise<string> => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("VITE_GOOGLE_CLIENT_ID が設定されていません");
  }

  await loadGoogleScript();

  if (!window.google?.accounts?.id) {
    throw new Error("Google Identity Servicesの初期化に失敗しました");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    try {
      window.google.accounts.id!.initialize({
        client_id: clientId,
        callback: (response: { credential?: string }) => {
          if (settled) return;
          if (response.credential) {
            settled = true;
            resolve(response.credential);
          } else {
            fail("Googleログインに失敗しました");
          }
        },
        ux_mode: "popup",
      });

      window.google.accounts.id!.prompt((notification?: GooglePrompt) => {
        if (!notification) return;
        if (notification.isDismissedMoment?.()) {
          fail("Googleログインがキャンセルされました");
        }
        if (notification.isNotDisplayed?.()) {
          const reason =
            notification.getNotDisplayedReason?.() ??
            notification.getSkippedReason?.() ??
            "Googleログインが表示できませんでした";
          fail(reason);
        }
      });

      setTimeout(() => fail("Googleログインがタイムアウトしました"), 20_000);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Googleログイン初期化に失敗しました");
    }
  });
};
