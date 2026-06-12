import { useEffect, useState } from "react";
import { PartyPopper, X } from "lucide-react";

const SEEN_KEY = "famly_welcome_seen";

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true);

export function WelcomeBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() && !localStorage.getItem(SEEN_KEY)) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setShow(false);
  };

  return (
    <div className="mx-6 mb-3" data-testid="welcome-banner">
      <div
        className="rounded-2xl p-4 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #F08C3F 0%, #E8B341 100%)" }}
      >
        <button
          data-testid="welcome-banner-close"
          onClick={dismiss}
          className="absolute top-2 right-2 p-1 rounded-lg hover:bg-white/20"
          aria-label="Tutup"
        >
          <X size={16} color="#fff" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <PartyPopper size={22} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-bold" style={{ fontFamily: "Manrope" }}>
              Selamat datang di app Famly! 🎉
            </div>
            <div className="text-sm text-white/90 mt-0.5">
              Aktifkan notifikasi di bawah supaya tidak ketinggalan pengingat tugas
              & keuangan keluarga.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
