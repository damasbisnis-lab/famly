export default function SplashScreen({ message = "Memuat..." }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(180deg, #FBF8F3 0%, #F5EFE2 100%)" }}
      data-testid="splash-screen"
    >
      <div className="relative splash-logo-wrap">
        <div className="splash-pulse" />
        <img
          src="/brand/famly-logo.png"
          alt="Famly"
          className="w-44 h-44 object-contain relative z-10 splash-float"
        />
      </div>
      <div className="brand-divider mt-4" />
      <div className="mt-6 flex items-center gap-2">
        <span className="splash-dot" style={{ background: "#F08C3F" }} />
        <span className="splash-dot" style={{ background: "#E8B341", animationDelay: "0.15s" }} />
        <span className="splash-dot" style={{ background: "#7BA98A", animationDelay: "0.3s" }} />
        <span className="splash-dot" style={{ background: "#2F7A7D", animationDelay: "0.45s" }} />
      </div>
      <p className="mt-4 text-sm" style={{ color: "#5A6260" }}>{message}</p>
    </div>
  );
}
