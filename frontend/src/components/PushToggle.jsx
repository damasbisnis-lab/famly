import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Bell, BellOff, Send, Clock, Save } from "lucide-react";

const TZ_LABELS = {
  WIB: "WIB (Jakarta, Sumatra, Jawa)",
  WITA: "WITA (Bali, Sulawesi, Kalimantan)",
  WIT: "WIT (Maluku, Papua)",
};

function detectDeviceTz() {
  try {
    const offsetH = -new Date().getTimezoneOffset() / 60;
    if (offsetH === 8) return "WITA";
    if (offsetH === 9) return "WIT";
    return "WIB";
  } catch {
    return "WIB";
  }
}

const LEAD_OPTIONS = [
  { value: 0, label: "Tepat waktu" },
  { value: 5, label: "5 menit sebelum" },
  { value: 15, label: "15 menit sebelum" },
  { value: 30, label: "30 menit sebelum" },
  { value: 60, label: "1 jam sebelum" },
  { value: 120, label: "2 jam sebelum" },
];

const DEFAULT_PREFS = {
  task_reminder_enabled: true,
  task_summary_time: "08:00",
  task_lead_minutes: 30,
  finance_reminder_enabled: true,
  finance_reminder_time: "20:00",
  tz_label: "WIB",
};

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
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          api.get("/push/status"),
          api.get("/push/preferences"),
        ]);
        setSubscribed(s.data.subscribed);
        const loaded = { ...DEFAULT_PREFS, ...(p.data.preferences || {}) };
        const deviceTz = detectDeviceTz();
        loaded.tz_label = deviceTz;
        setPrefs(loaded);
        // Auto-sync device timezone to backend if it differs from saved value
        if (p.data.preferences && p.data.preferences.tz_label !== deviceTz) {
          api.put("/push/preferences", { tz_label: deviceTz }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    })();
  }, [supported]);

  const flash = (m) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };

  const setPref = (k, v) => setPrefs((p) => ({ ...p, [k]: v }));

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
        tz_label: prefs.tz_label,
      });
      setSubscribed(true);
      flash("Notifikasi aktif! Mengirim notifikasi tes...");
      try {
        await api.post("/push/test");
      } catch {
        /* best-effort */
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

  const savePrefs = async () => {
    setErr("");
    setSaving(true);
    try {
      const { data } = await api.put("/push/preferences", {
        task_reminder_enabled: prefs.task_reminder_enabled,
        task_summary_time: prefs.task_summary_time,
        task_lead_minutes: Number(prefs.task_lead_minutes),
        finance_reminder_enabled: prefs.finance_reminder_enabled,
        finance_reminder_time: prefs.finance_reminder_time,
        tz_label: prefs.tz_label,
      });
      if (data.preferences) setPrefs({ ...DEFAULT_PREFS, ...data.preferences });
      // keep subscription tz in sync
      if (subscribed) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) {
          const json = sub.toJSON();
          await api.post("/push/subscribe", {
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            tz_label: prefs.tz_label,
          });
        }
      }
      flash("Pengaturan pengingat disimpan.");
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setSaving(false);
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
              Reminder tugas & keuangan, atur waktunya sendiri
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

      {/* Reminder settings */}
      <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
        <div className="text-xs text-stone-500" data-testid="push-tz-auto">
          Zona waktu: <b className="text-stone-700">{TZ_LABELS[prefs.tz_label] || prefs.tz_label}</b>
          <span className="text-stone-400"> · otomatis dari perangkat</span>
        </div>

        {/* Task reminders */}
        <div className="rounded-xl border border-stone-100 p-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-semibold text-stone-700 flex items-center gap-1">
              <Clock size={14} /> Pengingat Tugas
            </span>
            <input
              data-testid="task-reminder-toggle"
              type="checkbox"
              checked={prefs.task_reminder_enabled}
              onChange={(e) => setPref("task_reminder_enabled", e.target.checked)}
              className="w-4 h-4 accent-[#2F7A7D]"
            />
          </label>
          {prefs.task_reminder_enabled && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-stone-600">Ringkasan harian jam</span>
                <input
                  data-testid="task-summary-time-input"
                  type="time"
                  value={prefs.task_summary_time}
                  onChange={(e) => setPref("task_summary_time", e.target.value)}
                  className="input-field !py-1.5 !w-32 text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-stone-600">Tugas berwaktu, ingatkan</span>
                <select
                  data-testid="task-lead-select"
                  value={prefs.task_lead_minutes}
                  onChange={(e) => setPref("task_lead_minutes", Number(e.target.value))}
                  className="input-field !py-1.5 !w-40 text-sm"
                >
                  {LEAD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Finance reminder */}
        <div className="rounded-xl border border-stone-100 p-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-semibold text-stone-700 flex items-center gap-1">
              <Clock size={14} /> Pengingat Keuangan
            </span>
            <input
              data-testid="finance-reminder-toggle"
              type="checkbox"
              checked={prefs.finance_reminder_enabled}
              onChange={(e) => setPref("finance_reminder_enabled", e.target.checked)}
              className="w-4 h-4 accent-[#2F7A7D]"
            />
          </label>
          {prefs.finance_reminder_enabled && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-stone-600">Ingatkan catat keuangan jam</span>
              <input
                data-testid="finance-time-input"
                type="time"
                value={prefs.finance_reminder_time}
                onChange={(e) => setPref("finance_reminder_time", e.target.value)}
                className="input-field !py-1.5 !w-32 text-sm"
              />
            </div>
          )}
        </div>

        <button
          data-testid="push-save-prefs-btn"
          onClick={savePrefs}
          disabled={saving}
          className="w-full py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "#2F7A7D" }}
        >
          <Save size={14} /> {saving ? "Menyimpan..." : "Simpan Pengaturan"}
        </button>

        {subscribed && (
          <button
            data-testid="push-test-btn"
            onClick={sendTest}
            className="w-full py-2 rounded-xl text-xs font-semibold border border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "#2F7A7D", color: "#2F7A7D" }}
          >
            <Send size={12} /> Kirim Notifikasi Tes
          </button>
        )}
      </div>

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
