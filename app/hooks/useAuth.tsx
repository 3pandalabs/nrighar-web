import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  type AuthUser,
} from "../lib/api";

type Role = AuthUser["role"];

type AuthContextValue = {
  user: AuthUser | null;
  role: Role | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "invalid_credentials":
        return "Incorrect email or password.";
      case "email_taken":
        return "An account with this email already exists.";
      default:
        return err.code.replace(/_/g, " ");
    }
  }
  return "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // role now comes back directly on the user object from /auth/me or the
  // signup/login response - no separate profiles lookup, and no more
  // "no profile row yet -> assume owner" fallback (the API creates the
  // profile atomically inside the signup transaction).
  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .finally(() => setIsLoading(false));
  }, []);

  async function signIn(email: string, password: string) {
    try {
      setUser(await apiLogin(email, password));
      return { error: null };
    } catch (err) {
      return { error: friendlyError(err) };
    }
  }

  async function signUp(email: string, password: string) {
    try {
      setUser(await apiSignup(email, password));
      return { error: null };
    } catch (err) {
      return { error: friendlyError(err) };
    }
  }

  async function signOut() {
    await apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, role: user?.role ?? null, isLoading, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
