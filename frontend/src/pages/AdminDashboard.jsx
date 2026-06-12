import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, formatIDR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Users, TrendingUp, DollarSign, ShieldOff, LogOut, Crown,
  ArrowDownCircle, Ban, CheckCircle2, RefreshCw, Receipt
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
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("subscribers");

  const load = async () => {
    setLoading(true);
    try {
      const [s, sub, t] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/subscribers"),
        api.get("/admin/transactions"),
      ]);
      setStats(s.data);
      setSubs(sub.data.subscribers);
      setTxns(t.data.transactions);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doAction = async (path, msg) => {
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

  if (!user) return null;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'#E07A5F'}}>
            <Crown size={18} color="#fff" />
          </div>
          <div>
            <div className="text-white font-bold" style={{fontFamily:'Manrope'}}>Famly Admin</div>
            <div className="text-xs text-stone-400">{user.email}</div>
          </div>
        </div>
        <nav className="space-y-1 text-sm">
          <button
            data-testid="admin-tab-subscribers"
            onClick={()=>setTab("subscribers")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='subscribers' ? 'bg-stone-800 text-white border-l-4 border-[#E07A5F]' : 'hover:bg-stone-800/50'}`}>
            Subscribers
          </button>
          <button
            data-testid="admin-tab-transactions"
            onClick={()=>setTab("transactions")}
            className={`w-full text-left px-3 py-2 rounded-lg ${tab==='transactions' ? 'bg-stone-800 text-white border-l-4 border-[#E07A5F]' : 'hover:bg-stone-800/50'}`}>
            Transaksi
          </button>
        </nav>
        <button
          data-testid="admin-logout-btn"
          onClick={()=>{ logout(); navigate("/login"); }}
          className="mt-10 w-full text-left text-sm text-stone-400 hover:text-white flex items-center gap-2 px-3 py-2"
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard icon={Users} label="Total User" value={stats.total_users} accent="#81B29A" />
            <StatCard icon={TrendingUp} label="Active Subscribers" value={stats.active_subscribers} accent="#E07A5F" />
            <StatCard icon={DollarSign} label="MRR" value={formatIDR(stats.mrr_idr)} accent="#F4A261" />
            <StatCard icon={ShieldOff} label="Suspended" value={stats.suspended_users} accent="#EF4444" />
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
                              className="px-2.5 py-1.5 rounded-lg bg-[#E07A5F] text-white text-xs font-semibold hover:bg-[#D3644B] flex items-center gap-1"
                            ><Crown size={12}/> Upgrade</button>
                          )}
                          {s.premium_active && (
                            <button
                              data-testid={`downgrade-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/downgrade`, `${s.name} diturunkan ke Free`)}
                              className="px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-semibold hover:bg-stone-200 flex items-center gap-1"
                            ><ArrowDownCircle size={12}/> Downgrade</button>
                          )}
                          {!s.suspended ? (
                            <button
                              data-testid={`suspend-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/suspend`, `${s.name} disuspend`)}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 flex items-center gap-1"
                            ><Ban size={12}/> Suspend</button>
                          ) : (
                            <button
                              data-testid={`unsuspend-btn-${s.email}`}
                              onClick={()=>doAction(`/admin/users/${s.id}/unsuspend`, `${s.name} di-unsuspend`)}
                              className="px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 flex items-center gap-1"
                            ><CheckCircle2 size={12}/> Aktifkan</button>
                          )}
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
    </div>
  );
}
