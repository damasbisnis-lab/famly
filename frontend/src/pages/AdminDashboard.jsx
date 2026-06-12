import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, formatIDR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Users, TrendingUp, DollarSign, ShieldOff, LogOut, Crown,
  ArrowDownCircle, Ban, CheckCircle2, RefreshCw, Receipt, Share2, MessageCircle, Settings, XCircle
} from "lucide-react";

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-r-xl p-6 shadow-sm border-l-4" style={{borderColor: accent}}>
      <div className="flex items-center gap-2 mb-2 text-stone-500">
        <Icon size={16} /> <span className="text-xs uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-3xl font-bold" style={{fontFamily:'Manrope'}} data-testid={`stat-${label.replace(/\s/g,'-').toLowerCase()}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    premium: { cls: "bg-green-100 text-green-800", label: "Premium Aktif" },
    free: { cls: "bg-stone-100 text-stone-700", label: "Gratis" },
    suspended: { cls: "bg-red-100 text-red-800", label: "Suspended" },
  };
  const m = map[status] || map.free;
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [subs, setSubs] = useState([]);
  const [txns, setTxns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [upgradeReqs, setUpgradeReqs] = useState([]);
  const [settings, setSettings] = useState({admin_whatsapp: "", bank_info: ""});
  const [proofView, setProofView] = useState(null); // {code, image}
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("subscribers");

  const load = async () => {
    setLoading(true);
    try {
      const [s, sub, t, a, ur, st] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/subscribers"),
        api.get("/admin/transactions"),
        api.get("/admin/analytics"),
        api.get("/admin/upgrade-requests"),
        api.get("/admin/settings"),
      ]);
      setStats(s.data);
      setSubs(sub.data.subscribers);
      setTxns(t.data.transactions);
      setAnalytics(a.data);
      setUpgradeReqs(ur.data.requests);
      setSettings({admin_whatsapp: st.data.admin_whatsapp || "", bank_info: st.data.bank_info || ""});
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doAction = async (path, msg, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr(""); setInfo("");
    try {
      await api.post(path);
      setInfo(msg);
      setTimeout(()=>setInfo(""), 2500);
      await load();
    } catch (e) {
      setErr(formatApiError(e));
    }
  };

  const deleteUser = async (s) => {
    if (!window.confirm(`PERMANEN: hapus user "${s.name}" (${s.email})? Semua data (family, tugas, transaksi) ikut terhapus. Lanjutkan?`)) return;
    setErr(""); setInfo("");
    try {
      await api.delete(`/admin/users/${s.id}`);
      setInfo(`${s.name} dihapus permanen`);
      setTimeout(()=>setInfo(""), 2500);
      await load();
    } catch (e) { setErr(formatApiError(e)); }
  };

  if (!user) return null;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="flex items-center gap-3 mb-10">
          <img src="/brand/famly-logo.png" alt="Famly" className="brand-logo-sm" style={{filter:'drop-shadow(0 2px 8px rgba(0,0,0,0.3))'}} />
          <div>
            <div className="text-white font-bold" style={{fontFamily:'Manrope'}}>Famly Admin</div>
            <div className="text-xs" style={{color:'#A89F8B'}}>{user.email}</div>
          </div>
        </div>
        <nav className="space-y-1 text-sm">
          <button
            data-testid="admin-tab-subscribers"
            onClick={()=>setTab("subscribers")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='subscribers' ? 'bg-stone-800 text-white border-l-4' : 'hover:bg-stone-800/50'}`}
            style={tab==='subscribers' ? {borderLeftColor:'#F08C3F'} : {}}>
            Subscribers
          </button>
          <button
            data-testid="admin-tab-transactions"
            onClick={()=>setTab("transactions")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='transactions' ? 'bg-stone-800 text-white border-l-4' : 'hover:bg-stone-800/50'}`}
            style={tab==='transactions' ? {borderLeftColor:'#F08C3F'} : {}}>
            Transaksi
          </button>
          <button
            data-testid="admin-tab-requests"
            onClick={()=>setTab("requests")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='requests' ? 'bg-stone-800 text-white border-l-4' : 'hover:bg-stone-800/50'}`}
            style={tab==='requests' ? {borderLeftColor:'#F08C3F'} : {}}>
            Permintaan Upgrade ({upgradeReqs.filter(r=>r.status==='pending').length})
          </button>
          <button
            data-testid="admin-tab-settings"
            onClick={()=>setTab("settings")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='settings' ? 'bg-stone-800 text-white border-l-4' : 'hover:bg-stone-800/50'}`}
            style={tab==='settings' ? {borderLeftColor:'#F08C3F'} : {}}>
            Pengaturan
          </button>
          <button
            data-testid="admin-tab-account"
            onClick={()=>setTab("account")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='account' ? 'bg-stone-800 text-white border-l-4' : 'hover:bg-stone-800/50'}`}
            style={tab==='account' ? {borderLeftColor:'#F08C3F'} : {}}>
            Akun Admin
          </button>
        </nav>
        <button
          data-testid="admin-logout-btn"
          onClick={()=>{ logout(); navigate("/login"); }}
          className="mt-10 w-full text-left text-sm hover:text-white flex items-center gap-2 px-3 py-2"
          style={{color:'#A89F8B'}}
        >
          <LogOut size={14}/> Keluar
        </button>
      </aside>

      <main className="admin-content fade-in">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold" style={{fontFamily:'Manrope'}}>Super Admin Dashboard</h1>
            <p className="text-stone-500 text-sm">Pantau pelanggan, MRR, dan aksi manual.</p>
          </div>
          <button data-testid="admin-refresh-btn" onClick={load} className="btn-ghost flex items-center gap-2" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin':''}/> Refresh
          </button>
        </div>

        {info && <div className="mb-4 text-sm rounded-xl p-3 bg-green-50 text-green-700 border border-green-100">{info}</div>}
        {err && <div className="mb-4 text-sm rounded-xl p-3 bg-red-50 text-red-700 border border-red-100" data-testid="admin-error">{err}</div>}

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            <StatCard icon={Users} label="Total User" value={stats.total_users} accent="#7BA98A" />
            <StatCard icon={TrendingUp} label="Active Subscribers" value={stats.active_subscribers} accent="#F08C3F" />
            <StatCard icon={DollarSign} label="MRR" value={formatIDR(stats.mrr_idr)} accent="#E8B341" />
            <StatCard icon={ShieldOff} label="Suspended" value={stats.suspended_users} accent="#DC4B4B" />
            <StatCard icon={Share2} label="Share Clicks" value={analytics?.share_clicks ?? 0} accent="#2F7A7D" />
          </div>
        )}

        {analytics && analytics.events.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-stone-200 font-bold flex items-center gap-2" style={{fontFamily:'Manrope'}}>
              <Share2 size={16}/> Viral Loop Analytics
            </div>
            <table className="w-full text-sm" data-testid="analytics-table">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Event</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-left">Last Triggered</th>
                </tr>
              </thead>
              <tbody>
                {analytics.events.map((e) => (
                  <tr key={e.event} className="border-t border-stone-100" data-testid={`analytics-row-${e.event}`}>
                    <td className="px-4 py-3 font-mono text-xs">{e.event}</td>
                    <td className="px-4 py-3 text-right font-bold">{e.count}</td>
                    <td className="px-4 py-3 text-xs text-stone-500">{e.last ? new Date(e.last).toLocaleString('id-ID') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "subscribers" && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 font-bold" style={{fontFamily:'Manrope'}}>Daftar Subscriber ({subs.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="subscribers-table">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Nama</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Premium s/d</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id} className="border-t border-stone-100" data-testid={`subscriber-row-${s.email}`}>
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="px-4 py-3 text-stone-600">{s.email}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-stone-500 text-xs">
                        {s.premium_until ? new Date(s.premium_until).toLocaleDateString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {!s.premium_active && !s.suspended && (
                            <button
                              data-testid={`upgrade-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/upgrade`, `${s.name} di-upgrade ke Premium`)}
                              className="px-2.5 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1"
                              style={{background:'#F08C3F'}}
                            ><Crown size={12}/> Upgrade</button>
                          )}
                          {s.premium_active && (
                            <button
                              data-testid={`downgrade-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/downgrade`, `${s.name} diturunkan ke Free`, `Turunkan ${s.name} ke Free? Premium akan dicabut.`)}
                              className="px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-semibold hover:bg-stone-200 flex items-center gap-1"
                            ><ArrowDownCircle size={12}/> Downgrade</button>
                          )}
                          {!s.suspended ? (
                            <button
                              data-testid={`suspend-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/suspend`, `${s.name} disuspend`, `Suspend ${s.name}? Premium akan dicabut & akun dibatasi.`)}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 flex items-center gap-1"
                            ><Ban size={12}/> Suspend</button>
                          ) : (
                            <button
                              data-testid={`unsuspend-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/unsuspend`, `${s.name} di-unsuspend`)}
                              className="px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 flex items-center gap-1"
                            ><CheckCircle2 size={12}/> Aktifkan</button>
                          )}
                          <button
                            data-testid={`delete-btn-${s.email}`}
                            onClick={()=>deleteUser(s)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 flex items-center gap-1"
                          ><XCircle size={12}/> Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {subs.length === 0 && (
                    <tr><td colSpan="5" className="px-4 py-8 text-center text-stone-500">Belum ada subscriber.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "requests" && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 font-bold flex items-center gap-2" style={{fontFamily:'Manrope'}}>
              <MessageCircle size={16}/> Permintaan Upgrade via WhatsApp ({upgradeReqs.length})
            </div>
            <table className="w-full text-sm" data-testid="upgrade-requests-table">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Kode</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Tanggal</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {upgradeReqs.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100" data-testid={`request-row-${r.code}`}>
                    <td className="px-4 py-3 font-mono font-bold">{r.code}</td>
                    <td className="px-4 py-3"><div className="font-medium">{r.user_name}</div><div className="text-xs text-stone-500">{r.user_email}</div></td>
                    <td className="px-4 py-3 text-xs text-stone-500">{new Date(r.created_at).toLocaleString('id-ID')}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.status==='approved'?'bg-green-100 text-green-800':r.status==='rejected'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end items-center">
                      <button
                        data-testid={`view-proof-${r.code}`}
                        onClick={async ()=>{
                          try {
                            const { data } = await api.get(`/admin/upgrade-requests/${r.id}/proof`);
                            setProofView({ code: data.code, image: data.proof_image });
                          } catch (e) { setErr(formatApiError(e)); }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-semibold hover:bg-stone-200"
                      >Lihat Bukti</button>
                      {r.status === 'pending' && (
                        <>
                          <button
                            data-testid={`approve-req-${r.code}`}
                            onClick={()=>doAction(`/admin/upgrade-requests/${r.id}/approve`, `Request ${r.code} disetujui & user di-upgrade ke Premium`)}
                            className="px-2.5 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1" style={{background:'#7BA98A'}}
                          ><CheckCircle2 size={12}/> Setujui</button>
                          <button
                            data-testid={`reject-req-${r.code}`}
                            onClick={()=>doAction(`/admin/upgrade-requests/${r.id}/reject`, `Request ${r.code} ditolak`)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold flex items-center gap-1"
                          ><XCircle size={12}/> Tolak</button>
                        </>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
                {upgradeReqs.length === 0 && (
                  <tr><td colSpan="5" className="px-4 py-8 text-center text-stone-500">Belum ada permintaan upgrade.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "account" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 max-w-2xl space-y-6">
            <div>
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Profil Saya</h3>
              <form data-testid="admin-me-form" onSubmit={async (e)=>{
                e.preventDefault();
                const name = e.target.elements.name.value.trim();
                const pw = e.target.elements.pw.value;
                if (pw && !window.confirm("Ganti password admin? Sesi lain tetap aktif sampai logout.")) return;
                if (!pw && name === user.name) { setErr("Tidak ada perubahan"); return; }
                try {
                  await api.put("/admin/me", { name, new_password: pw || null });
                  setInfo("Profil diperbarui");
                  setTimeout(()=>setInfo(""), 2500);
                  e.target.elements.pw.value = "";
                  await load();
                } catch (e2) { setErr(formatApiError(e2)); }
              }} className="space-y-3">
                <div>
                  <label className="text-sm font-semibold block mb-1">Nama</label>
                  <input data-testid="admin-me-name" name="name" className="input-field" defaultValue={user.name} required />
                </div>
                <div>
                  <label className="text-sm font-semibold block mb-1">Password Baru</label>
                  <input data-testid="admin-me-pw" name="pw" type="password" className="input-field" placeholder="Kosongkan jika tidak diubah" />
                </div>
                <button data-testid="admin-me-save" className="btn-primary" type="submit">Simpan</button>
              </form>
            </div>
            <hr/>
            <div>
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Tambah Admin Baru</h3>
              <form data-testid="new-admin-form" onSubmit={async (e)=>{
                e.preventDefault();
                const f = e.target.elements;
                if (!window.confirm(`Buat admin baru: ${f.email.value}? Akan punya akses penuh.`)) return;
                try {
                  await api.post("/admin/admins", { email: f.email.value, name: f.name.value, password: f.pw.value });
                  setInfo("Admin baru ditambahkan");
                  setTimeout(()=>setInfo(""), 2500);
                  e.target.reset();
                  await load();
                } catch (e2) { setErr(formatApiError(e2)); }
              }} className="space-y-3">
                <input data-testid="new-admin-email" name="email" type="email" className="input-field" placeholder="email@famly.id" required />
                <input data-testid="new-admin-name" name="name" className="input-field" placeholder="Nama admin" required />
                <input data-testid="new-admin-pw" name="pw" type="password" minLength={6} className="input-field" placeholder="Password (min 6 karakter)" required />
                <button data-testid="new-admin-submit" className="btn-secondary" type="submit">Tambah Admin</button>
              </form>
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 max-w-2xl">
            <div className="flex items-center gap-2 mb-4 font-bold" style={{fontFamily:'Manrope'}}>
              <Settings size={18}/> Pengaturan Pembayaran Manual
            </div>
            <form
              data-testid="settings-form"
              onSubmit={async (e)=>{
                e.preventDefault();
                setErr(""); setInfo("");
                try {
                  await api.put("/admin/settings", settings);
                  setInfo("Pengaturan tersimpan");
                  setTimeout(()=>setInfo(""), 2500);
                  await load();
                } catch (e2) { setErr(formatApiError(e2)); }
              }}
              className="space-y-4"
            >
              <div>
                <label className="text-sm font-semibold block mb-1">Nomor WhatsApp Admin</label>
                <input data-testid="settings-wa-input" className="input-field" placeholder="08123456789 atau 628123456789"
                  value={settings.admin_whatsapp} onChange={(e)=>setSettings({...settings, admin_whatsapp:e.target.value})} required />
                <p className="text-xs text-stone-500 mt-1">Nomor ini akan muncul saat user klik upgrade Premium. Format apa saja, otomatis dinormalisasi ke 62xx.</p>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Info Rekening / Pembayaran (opsional)</label>
                <textarea data-testid="settings-bank-input" className="input-field" rows={3} placeholder="BCA 1234567890 a.n. Admin Famly"
                  value={settings.bank_info} onChange={(e)=>setSettings({...settings, bank_info:e.target.value})} />
              </div>
              <button data-testid="settings-save-btn" className="btn-primary" type="submit">Simpan Pengaturan</button>
            </form>
            {settings.admin_whatsapp && (
              <div className="mt-6 p-4 rounded-xl bg-stone-50 text-sm">
                <div className="font-semibold mb-1">Preview:</div>
                <div className="text-stone-600">WhatsApp aktif di nomor <span className="font-mono font-bold">+{settings.admin_whatsapp}</span></div>
              </div>
            )}
          </div>
        )}

        {tab === "transactions" && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 font-bold flex items-center gap-2" style={{fontFamily:'Manrope'}}>
              <Receipt size={16}/> Transaksi ({txns.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="transactions-table">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Tanggal</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Paket</th>
                    <th className="px-4 py-3 text-right">Jumlah</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-t border-stone-100">
                      <td className="px-4 py-3 text-xs text-stone-500">{new Date(t.created_at).toLocaleString('id-ID')}</td>
                      <td className="px-4 py-3">{t.user_email}</td>
                      <td className="px-4 py-3 text-xs text-stone-600">{t.package}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatIDR(t.amount)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.payment_status === 'paid' || t.payment_status === 'manual' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-700'}`}>{t.payment_status}</span></td>
                    </tr>
                  ))}
                  {txns.length === 0 && (
                    <tr><td colSpan="5" className="px-4 py-8 text-center text-stone-500">Belum ada transaksi.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {proofView && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={()=>setProofView(null)} data-testid="proof-modal">
          <div className="bg-white rounded-2xl p-4 max-w-2xl w-full" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold" style={{fontFamily:'Manrope'}}>Bukti Transfer - {proofView.code}</div>
              <button onClick={()=>setProofView(null)} className="text-stone-500 hover:text-stone-800">✕</button>
            </div>
            {proofView.image ? (
              <img src={proofView.image} alt="Bukti transfer" className="w-full rounded-lg" data-testid="proof-image" />
            ) : (
              <div className="text-center py-8 text-stone-500">User belum mengunggah bukti transfer.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
