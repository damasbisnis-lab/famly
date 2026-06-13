import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Gift, Copy, Share2, Check } from "lucide-react";

export function ReferralCard({ onInfo }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const res = await api.get("/referral/me");
      setData(res.data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

  const link = `${window.location.origin}/register?ref=${data.ref_code}`;
  const shareText = `Pakai Famly yuk buat atur keuangan & bagi tugas keluarga! 🏠 Daftar lewat link aku: ${link}`;

  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (onInfo) onInfo("Link referral disalin");
  };

  const share = () => {
    api.post("/track/event", { event: "referral_shared", metadata: { channel: "whatsapp" } }).catch(() => {});
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
  };

  return (
    <div className="card-surface relative overflow-hidden" data-testid="referral-card">
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-25 pointer-events-none"
        style={{ background: "radial-gradient(circle, #E8B341 0%, transparent 70%)" }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(240,140,63,0.14)" }}>
            <Gift size={16} color="#F08C3F" />
          </div>
          <div>
            <div className="font-bold text-sm" style={{ fontFamily: "Manrope" }}>
              Ajak Teman, Dapat Bonus
            </div>
            <div className="text-xs text-stone-500">
              Tiap teman yang upgrade Premium = <b style={{ color: "#F08C3F" }}>+1 bulan</b> gratis untukmu
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 my-3">
          <div className="rounded-xl p-2 text-center bg-stone-100">
            <div className="text-[10px] text-stone-600">Diajak</div>
            <div className="text-sm font-bold" data-testid="referral-invited">{data.total_invited}</div>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: "rgba(123,169,138,0.15)" }}>
            <div className="text-[10px] text-stone-600">Berhasil</div>
            <div className="text-sm font-bold" style={{ color: "#5F8E70" }} data-testid="referral-converted">{data.total_converted}</div>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: "rgba(240,140,63,0.12)" }}>
            <div className="text-[10px] text-stone-600">Bulan Gratis</div>
            <div className="text-sm font-bold" style={{ color: "#DD7728" }} data-testid="referral-months">{data.months_earned}</div>
          </div>
        </div>

        {/* Link */}
        <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 mb-2">
          <span className="text-xs text-stone-600 truncate flex-1" data-testid="referral-link">{link}</span>
          <button data-testid="referral-copy-btn" onClick={copy} className="p-1 rounded-md hover:bg-stone-200 shrink-0">
            {copied ? <Check size={14} color="#5F8E70" /> : <Copy size={14} />}
          </button>
        </div>

        <button
          data-testid="referral-share-btn"
          onClick={share}
          className="w-full py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: "#F08C3F" }}
        >
          <Share2 size={15} /> Bagikan via WhatsApp
        </button>
      </div>
    </div>
  );
}
