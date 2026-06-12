import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=anon
  const [bootstrapped, setBootstrapped] = useState(false);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("famly_token");
    if (!token) {
      setUser(false);
      setBootstrapped(true);
      return null;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setBootstrapped(true);
      return data.user;
    } catch {
      localStorage.removeItem("famly_token");
      setUser(false);
      setBootstrapped(true);
      return null;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("famly_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const register = async (email, password, name) => {
    const { data } = await api.post("/auth/register", { email, password, name });
    localStorage.setItem("famly_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("famly_token");
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, bootstrapped, login, register, logout, refresh, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
