import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";

export default function AuthPage({ mode = "login" }) {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const u = isLogin
        ? await login(email, password)
        : await register(email, password, name);
      if (u.role === "admin") navigate("/admin");
      else navigate("/app");
    } catch (e2) {
      setErr(formatApiError(e2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="pt-10 px-6 pb-10 fade-in">
        <div className="flex flex-col items-center mb-8">
          <img src="/brand/famly-logo.png" alt="Famly - Harmonis, Seru, dan Tumbuh Bersama" className="w-56 h-56 object-contain -my-6" data-testid="brand-logo" />
          <div className="brand-divider mt-1" />
        </div>

        <h2 className="text-2xl font-bold leading-tight mb-2" style={{fontFamily:'Manrope'}}>
          {isLogin ? "Selamat datang kembali" : "Buat akun Famly"}
        </h2>
        <p className="text-stone-600 mb-6 text-sm">
          {isLogin
            ? "Kelola keluarga, keuangan, dan tugas dalam satu tempat."
            : "Atur keuangan dan tugas keluarga bersama-sama."}
        </p>

        <form onSubmit={submit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="text-sm text-stone-600 mb-1 block">Nama</label>
              <input
                data-testid="auth-name-input"
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama Anda"
                required
              />
            </div>
          )}
          <div>
            <label className="text-sm text-stone-600 mb-1 block">Email</label>
            <input
              data-testid="auth-email-input"
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anda@email.com"
              required
            />
          </div>
          <div>
            <label className="text-sm text-stone-600 mb-1 block">Password</label>
            <input
              data-testid="auth-password-input"
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 karakter"
              required
              minLength={6}
            />
          </div>

          {err && (
            <div data-testid="auth-error" className="text-sm rounded-xl p-3 bg-red-50 text-red-700 border border-red-100">
              {err}
            </div>
          )}

          <button
            data-testid="auth-submit-btn"
            disabled={loading}
            className="btn-primary w-full mt-2"
            type="submit"
          >
            {loading ? "Memproses..." : isLogin ? "Masuk" : "Daftar"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-stone-600">
          {isLogin ? (
            <>
              Belum punya akun?{" "}
              <Link data-testid="auth-switch-register" to="/register" className="font-semibold" style={{color:'#F08C3F'}}>Daftar</Link>
            </>
          ) : (
            <>
              Sudah punya akun?{" "}
              <Link data-testid="auth-switch-login" to="/login" className="font-semibold" style={{color:'#F08C3F'}}>Masuk</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
