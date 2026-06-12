import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Bell, BellOff, Send } from "lucide-react";

const TZ_OPTIONS = [
  { value: "WIB", label: "WIB (Jakarta, Sumatra, Jawa)" },
  { value: "WITA", label: "WITA (Bali, Sulawesi, Kalimantan)" },
  { value: "WIT", label: "WIT (Maluku, Papua)" },
];

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const isSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export function PushToggle() {
  const [supported] = useState(isSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [tz, setTz] = useState("WIB");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const { data } = await api.get("/push/status");
        setSubscribed(data.subscribed);
        if (data.tz_label) setTz(data.tz_label);
      } catch {
        /* ignore */
      }
    })();
  }, [supported]);

  const flash = (m) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };

  const enable = async () => {
    setErr("");
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErr("Izin notifikasi ditolak. Aktifkan dari pengaturan browser.");
        setBusy(false);
        return;
      }
      const { data: vapid } = await api.get("/push/vapid-public-key");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.public_key),
        });
      }
      const json = sub.toJSON();
      await api.post("/push/subscribe", {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        tz_label: tz,
      });
      setSubscribed(true);
      flash("Notifikasi aktif! Mengirim notifikasi tes...");
      try {
        await api.post("/push/test");
      } catch {
        /* test best-effort */
      }
    } catch (e) {
      setErr(formatApiError(e) || "Gagal mengaktifkan notifikasi.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setErr("");
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      flash("Notifikasi dinonaktifkan.");
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const updateTz = async (newTz) => {
    setTz(newTz);
    if (!subscribed) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (!sub) return;
      const json = sub.toJSON();
      await api.post("/push/subscribe", {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        tz_label: newTz,
      });
      flash("Zona waktu diperbarui.");
    } catch (e) {
      setErr(formatApiError(e));
    }
  };

  const sendTest = async () => {
    setErr("");
    try {
      await api.post("/push/test");
      flash("Notifikasi tes dikirim.");
    } catch (e) {
      setErr(formatApiError(e));
    }
  };

  if (!supported) {
    return (
      <div className="card-surface" data-testid="push-unsupported">
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <BellOff size={16} /> Browser ini tidak mendukung notifikasi push.
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface" data-testid="push-toggle-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(47,122,125,0.12)" }}
          >
            <Bell size={16} color="#2F7A7D" />
          </div>
          <div>
            <div className="font-bold text-sm" style={{ fontFamily: "Manrope" }}>
              Notifikasi Pengingat
            </div>
            <div className="text-xs text-stone-500">
              Pengingat tugas (08.00) & keuangan (20.00)
            </div>
          </div>
        </div>
        {subscribed ? (
          <button
            data-testid="push-disable-btn"
            onClick={disable}
            disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            {busy ? "..." : "Matikan"}
          </button>
        ) : (
          <button
            data-testid="push-enable-btn"
            onClick={enable}
            disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white disabled:opacity-50"
            style={{ background: "#2F7A7D" }}
          >
            {busy ? "Mengaktifkan..." : "Aktifkan"}
          </button>
        )}
      </div>

      <div className="mt-2">
        <label className="text-xs text-stone-600 block mb-1">Zona waktu Anda</label>
        <select
          data-testid="push-tz-select"
          value={tz}
          onChange={(e) => updateTz(e.target.value)}
          className="input-field !py-2 text-sm"
        >
          {TZ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {subscribed && (
        <button
          data-testid="push-test-btn"
          onClick={sendTest}
          className="mt-3 w-full py-2 rounded-xl text-xs font-semibold border border-dashed flex items-center justify-center gap-2"
          style={{ borderColor: "#2F7A7D", color: "#2F7A7D" }}
        >
          <Send size={12} /> Kirim Notifikasi Tes
        </button>
      )}

      {msg && (
        <div className="mt-2 text-xs text-green-700" data-testid="push-message">
          {msg}
        </div>
      )}
      {err && (
        <div className="mt-2 text-xs text-red-600" data-testid="push-error">
          {err}
        </div>
      )}
    </div>
  );
}
