import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Check, Users, Receipt, ListChecks, Crown, ShieldCheck, Share2 } from "lucide-react";
import api, { formatIDR } from "@/lib/api";

function FeatureCard({ icon: Icon, title, desc, color, bg }) {
  return (
    <div className="card-surface fade-in">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3" style={{ background: bg }}>
        <Icon size={20} color={color} />
      </div>
      <div className="font-bold mb-1" style={{ fontFamily: "Manrope" }}>{title}</div>
      <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const goApp = user && user.role === "admin" ? "/admin" : "/app";
  const primaryLabel = user ? "Buka Dashboard" : "Daftar Gratis";
  const primaryHref = user ? goApp : "/register";

  return (
    <div className="app-shell pb-12">
      {/* Hero */}
      <section className="px-6 pt-10 pb-8 fade-in text-center">
        <img src="/brand/famly-logo.png" alt="Famly" className="w-48 h-48 mx-auto object-contain -my-4" />
        <div className="brand-divider mx-auto mt-1 mb-5" />
        <h1 className="text-3xl font-extrabold leading-tight mb-2" style={{ fontFamily: "Manrope" }}>
          Keuangan & tugas <span style={{ color: "#F08C3F" }}>keluarga</span>,
          <br />di satu tempat hangat.
        </h1>
        <p className="text-stone-600 text-sm mb-6 px-2">
          Catat pengeluaran bareng, bagi tugas rumah, dan jaga harmoni keluarga
          dari satu aplikasi sederhana untuk keluarga Indonesia.
        </p>
        <div className="flex flex-col gap-2">
          <Link to={primaryHref} data-testid="landing-cta-primary" className="btn-primary w-full text-center">
            {primaryLabel}
          </Link>
          {!user && (
            <Link to="/login" data-testid="landing-cta-login" className="btn-ghost w-full text-center">
              Saya sudah punya akun
            </Link>
          )}
        </div>
        <div className="mt-4 text-xs text-stone-500 flex items-center justify-center gap-1.5">
          <ShieldCheck size={14} color="#7BA98A" /> Gratis untuk keluarga kecil
        </div>
      </section>

      {/* Features */}
      <section className="px-6 space-y-3">
        <FeatureCard
          icon={Users}
          title="Keluarga dalam satu lingkaran"
          desc="Undang pasangan atau anggota keluarga lewat kode unik. Semua data tersinkron otomatis."
          color="#F08C3F" bg="rgba(240,140,63,0.14)"
        />
        <FeatureCard
          icon={Receipt}
          title="Catat pengeluaran bareng"
          desc="Tahu siapa belanja apa, kapan, berapa. Tanpa lagi tanya 'tadi habis berapa, Yah?'"
          color="#2F7A7D" bg="rgba(47,122,125,0.12)"
        />
        <FeatureCard
          icon={ListChecks}
          title="Bagi tugas rumah dengan adil"
          desc="Cuci piring, jemput anak, beli galon — semua tercatat dan saling tahu."
          color="#7BA98A" bg="rgba(123,169,138,0.16)"
        />
      </section>

      {/* Pricing teaser */}
      <section className="px-6 mt-8">
        <div className="card-surface relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-25"
               style={{ background: "radial-gradient(circle, #E8B341 0%, transparent 70%)" }} />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Crown size={18} color="#F08C3F" />
              <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: "#F08C3F" }}>Famly Premium</span>
            </div>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-3xl font-bold" style={{ fontFamily: "Manrope" }}>{formatIDR(49000)}</span>
              <span className="text-stone-500 text-sm">/ bulan</span>
            </div>
            <ul className="space-y-1.5 text-sm text-stone-700 mb-1">
              {["Anggota keluarga tanpa batas", "Pengeluaran tanpa batas", "Tugas aktif tanpa batas"].map((f) => (
                <li key={f} className="flex items-center gap-2"><Check size={14} color="#7BA98A" /> {f}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Share CTA - viral hook */}
      <section className="px-6 mt-6">
        <button
          data-testid="share-whatsapp-btn"
          onClick={() => {
            const url = window.location.origin;
            const text = encodeURIComponent(
              "Coba Famly — aplikasi untuk catat pengeluaran & bagi tugas keluarga. Gratis untuk keluarga kecil 🏠 " + url
            );
            // Fire-and-forget analytics; don't block share
            api.post("/track/event", {
              event: "share_clicked",
              metadata: {
                channel: "whatsapp",
                source: "landing_page",
                logged_in: !!user,
                user_id: user?.id || null,
              },
            }).catch(() => {});
            window.open(`https://wa.me/?text=${text}`, "_blank");
          }}
          className="w-full card-surface flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(123,169,138,0.18)" }}>
              <Share2 size={18} color="#5F8E70" />
            </div>
            <div className="text-left">
              <div className="font-bold" style={{ fontFamily: "Manrope" }}>Ajak keluarga via WhatsApp</div>
              <div className="text-xs text-stone-500">Bagikan link Famly ke grup keluarga</div>
            </div>
          </div>
          <span className="font-semibold" style={{ color: "#7BA98A" }}>→</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="text-center text-xs text-stone-500 mt-10 pb-4">
        Dibuat dengan ❤ untuk keluarga Indonesia.
      </footer>
    </div>
  );
}
