import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import api, { formatApiError, formatIDR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState("checking"); // checking | paid | expired | error
  const [message, setMessage] = useState("Memeriksa status pembayaran...");
  const attemptsRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      setMessage("Session ID tidak ditemukan.");
      return;
    }
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attemptsRef.current += 1;
      if (attemptsRef.current > 12) {
        setStatus("error");
        setMessage("Timeout. Cek riwayat transaksi.");
        return;
      }
      try {
        const { data } = await api.get(`/payments/checkout/status/${sessionId}`);
        if (data.payment_status === "paid") {
          setStatus("paid");
          setMessage("Pembayaran berhasil! Premium telah diaktifkan.");
          await refresh();
          return;
        }
        if (data.status === "expired") {
          setStatus("expired");
          setMessage("Sesi pembayaran kadaluarsa.");
          return;
        }
        timerRef.current = setTimeout(poll, 2500);
      } catch (e) {
        setStatus("error");
        setMessage(formatApiError(e));
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sessionId, refresh]);

  return (
    <div className="app-shell">
      <div className="px-6 py-16 fade-in flex flex-col items-center text-center">
        {status === "checking" && <Loader2 size={48} className="animate-spin mb-4" color="#F08C3F" />}
        {status === "paid" && <CheckCircle size={64} color="#7BA98A" className="mb-4" />}
        {(status === "error" || status === "expired") && <XCircle size={64} color="#DC4B4B" className="mb-4" />}
        <h1 className="text-2xl font-bold mb-2" style={{fontFamily:'Manrope'}} data-testid="payment-status-title">
          {status === "paid" ? "Pembayaran Berhasil" : status === "checking" ? "Memproses..." : "Gagal / Kadaluarsa"}
        </h1>
        <p className="text-stone-600 mb-2" data-testid="payment-status-message">{message}</p>
        {status === "paid" && <p className="text-sm text-stone-500 mb-4">Nominal: {formatIDR(49000)}</p>}
        <button
          data-testid="back-to-dashboard-btn"
          onClick={() => navigate("/app")}
          className="btn-primary mt-6"
        >
          Kembali ke Dashboard
        </button>
      </div>
    </div>
  );
}

export function PaymentCancelPage() {
  return (
    <div className="app-shell">
      <div className="px-6 py-16 fade-in flex flex-col items-center text-center">
        <XCircle size={64} color="#DC4B4B" className="mb-4" />
        <h1 className="text-2xl font-bold mb-2" style={{fontFamily:'Manrope'}}>Pembayaran Dibatalkan</h1>
        <p className="text-stone-600 mb-6">Anda dapat mencoba lagi kapan saja.</p>
        <Link data-testid="back-to-dashboard-link" to="/" className="btn-primary">Kembali ke Dashboard</Link>
      </div>
    </div>
  );
}
