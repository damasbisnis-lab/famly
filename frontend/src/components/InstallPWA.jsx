import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true);

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.MSStream;

export function InstallPWA({ className = "" }) {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const ios = isIOS();

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Already installed → nothing to show
  if (installed) return null;
  // No actionable install path on this platform → hide
  if (!deferred && !ios) return null;

  const handleClick = async () => {
    if (deferred) {
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {
        /* ignore */
      }
      setDeferred(null);
    } else if (ios) {
      setShowIosHelp(true);
    }
  };

  return (
    <>
      <button
        data-testid="install-pwa-btn"
        onClick={handleClick}
        className={`flex items-center justify-center gap-2 rounded-2xl font-semibold text-white px-4 py-3 transition-transform active:scale-[0.98] ${className}`}
        style={{ background: "#F08C3F" }}
      >
        <Download size={18} />
        Install Aplikasi Famly
      </button>

      {showIosHelp && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center px-4"
          onClick={() => setShowIosHelp(false)}
          data-testid="ios-install-modal"
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <img src="/brand/icon-192.png" alt="" className="w-9 h-9 rounded-xl" />
                <h3 className="font-bold text-lg" style={{ fontFamily: "Manrope" }}>
                  Install di iPhone/iPad
                </h3>
              </div>
              <button
                data-testid="ios-install-close"
                onClick={() => setShowIosHelp(false)}
                className="p-1 rounded-lg hover:bg-stone-100"
              >
                <X size={18} />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-stone-700">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span className="flex items-center gap-1 flex-wrap">
                  Ketuk tombol <b>Bagikan</b>
                  <Share size={15} className="inline" style={{ color: "#0A84FF" }} />
                  di bilah bawah Safari.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span className="flex items-center gap-1 flex-wrap">
                  Pilih <b>Tambahkan ke Layar Utama</b>
                  <Plus size={15} className="inline" />
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <span>Ketuk <b>Tambah</b> di kanan atas. Selesai! 🎉</span>
              </li>
            </ol>
            <p className="text-xs text-stone-500 mt-4">
              Catatan: fitur install hanya tersedia di browser <b>Safari</b> pada iOS.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
