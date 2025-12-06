import type { AuthSessionResponse, UpdateUserProfileRequest, User, UserSession } from "@theteacher/shared";
import {
  createContext,
  createEffect,
  useContext,
  type ParentComponent,
} from "solid-js";
import { createStore } from "solid-js/store";

import { clearSessionToken, ensureSessionToken, readSessionToken } from "./auth";
import { getGoogleIdToken } from "./google-auth";
import { fetchAuthSession, issueSession, loginWithGoogle, updateUserProfile } from "./api-client";

type AuthStatus = "idle" | "loading" | "ready" | "error";

type AuthState = {
  status: AuthStatus;
  token: string | null;
  user: User | null;
  session: UserSession | null;
  error: string | null;
};

type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  signInWithGoogle: () => Promise<AuthSessionResponse>;
  rotateSession: (deviceName?: string) => Promise<AuthSessionResponse>;
  updateProfile: (input: UpdateUserProfileRequest) => Promise<User>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue>();

const defaultState: AuthState = {
  status: "idle",
  token: readSessionToken(),
  user: null,
  session: null,
  error: null,
};

export const createAuthStore = () => {
  const [state, setState] = createStore<AuthState>(defaultState);
  let triedInitialRefresh = false;

  const refresh = async () => {
    setState({ status: "loading", error: null });
    try {
      const token = await ensureSessionToken();
      setState({ token });
      const session = await fetchAuthSession();
      setState({
        status: "ready",
        user: session.user,
        session: session.session,
        error: null,
      });
    } catch (error) {
      setState({
        status: "idle",
        token: null,
        user: null,
        session: null,
        error: error instanceof Error ? error.message : "Failed to load session",
      });
    }
  };

  const signInWithGoogle: AuthContextValue["signInWithGoogle"] = async () => {
    setState({ status: "loading", error: null });
    try {
      const idToken = await getGoogleIdToken();
      const response = await loginWithGoogle(idToken);
      setState({
        status: "ready",
        token: response.token,
        user: response.user,
        session: response.session,
        error: null,
      });
      return response;
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to sign in",
      });
      throw error;
    }
  };

  const rotateSession: AuthContextValue["rotateSession"] = async (deviceName) => {
    setState({ status: "loading", error: null });
    try {
      const response = await issueSession(deviceName);
      setState({
        status: "ready",
        token: response.token,
        user: response.user,
        session: response.session,
        error: null,
      });
      return response;
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to issue session",
      });
      throw error;
    }
  };

  const updateProfileMutation: AuthContextValue["updateProfile"] = async (input) => {
    setState({ error: null });
    try {
      const sanitized: UpdateUserProfileRequest = {
        email: input.email?.trim() || undefined,
        displayName: input.displayName?.trim() || undefined,
      };
      const { user } = await updateUserProfile(sanitized);
      setState({ user });
      return user;
    } catch (error) {
      setState({
        error: error instanceof Error ? error.message : "Failed to update profile",
      });
      throw error;
    }
  };

  const signOut = () => {
    clearSessionToken();
    setState({
      status: "idle",
      token: null,
      user: null,
      session: null,
      error: null,
    });
  };

  createEffect(() => {
    if (state.status === "idle" && !triedInitialRefresh) {
      triedInitialRefresh = true;
      void refresh();
    }
  });

  return {
    state,
    refresh,
    signInWithGoogle,
    rotateSession,
    updateProfile: updateProfileMutation,
    signOut,
  };
};

export const AuthProvider: ParentComponent = (props) => {
  const store = createAuthStore();
  return <AuthContext.Provider value={store}>{props.children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
