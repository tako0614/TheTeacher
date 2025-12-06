import { createEffect, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";

type MockModeState = {
  preferMock: boolean;
  lastFallbackAt?: string;
  lastFallbackLabel?: string;
  lastFallbackError?: string;
};

const STORAGE_KEY = "theteacher/mock-mode/prefer";

const readPreferMock = (): boolean => {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return raw === "true";
  } catch {
    return false;
  }
};

const persistPreferMock = (value: boolean) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
};

let state: MockModeState = {
  preferMock: readPreferMock(),
};

const listeners = new Set<(next: MockModeState) => void>();

const emit = () => {
  const snapshot = { ...state };
  listeners.forEach((listener) => listener(snapshot));
};

export const setPreferMock = (preferMock: boolean) => {
  state = { ...state, preferMock };
  persistPreferMock(preferMock);
  emit();
};

export const shouldPreferMock = () => state.preferMock;

export const recordMockFallback = (label: string, error?: unknown, reason?: string) => {
  const lastFallbackError =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
  state = {
    ...state,
    lastFallbackAt: new Date().toISOString(),
    lastFallbackLabel: reason ? `${label} (${reason})` : label,
    lastFallbackError: lastFallbackError ?? state.lastFallbackError,
  };
  emit();
};

export const getMockModeState = (): MockModeState => ({ ...state });

export const subscribeMockMode = (listener: (next: MockModeState) => void) => {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
};

export const useMockMode = () => {
  const [store, setStore] = createStore<MockModeState>(getMockModeState());
  const [timestamp, setTimestamp] = createSignal(0);

  createEffect(() => {
    const unsubscribe = subscribeMockMode((next) => {
      setStore(next);
      setTimestamp(Date.now());
    });
    onCleanup(unsubscribe);
  });

  return {
    state: store,
    lastUpdatedAt: timestamp,
    enableMock: () => setPreferMock(true),
    disableMock: () => setPreferMock(false),
    toggle: () => setPreferMock(!store.preferMock),
  };
};
