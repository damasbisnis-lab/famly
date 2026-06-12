import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, formatIDR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Users, Plus, Receipt, ListChecks, Crown, LogOut, Copy, Trash2, Check, Sparkles, ShieldAlert
} from "lucide-react";

function LimitBar({ label, used, max }) {
  if (max == null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-stone-600">{label}</span>
        <span className="badge badge-premium">Unlimited</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((used / max) * 100));
  const cls = pct >= 100 ? "progress-danger" : pct >= 80 ? "progress-warn" : "progress-safe";
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-stone-700">{label}</span>
        <span className="text-stone-500" data-testid={`limit-${label.replace(/\s/g,'-').toLowerCase()}-text`}>
          {used} / {max}
        </span>
      </div>
      <div className="progress-track"><div className={`progress-fill ${cls}`} style={{ width: pct + "%" }} /></div>
    </div>
  );
}

function UpgradeModal({ open, onClose, onUpgrade, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center px-4 fade-in" onClick={onClose}>
      <div
        className="bg-white rounded-3xl p-8 max-w-md w-full border border-[#E07A5F]/20 shadow-2xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="upgrade-modal"
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none"
             style={{backgroundImage:'url(https://images.unsplash.com/photo-1649083048770-82e8ffd80431?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjd8MHwxfHNlYXJjaHwyfHxjb3p5JTIwbW9kZXJuJTIwaG9tZSUyMGludGVyaW9yfGVufDB8fHx8MTc4MTI2OTY0NXww&ixlib=rb-4.1.0&q=85)',backgroundSize:'cover'}} />
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{background:'#E07A5F'}}>
            <Crown size={22} color="#fff" />
          </div>
          <h2 className="text-2xl font-bold mb-1" style={{fontFamily:'Manrope'}}>Famly Premium</h2>
          <p className="text-stone-600 mb-4">Buka semua batasan untuk keluarga Anda.</p>
          <div className="mb-6">
            <span className="text-4xl font-bold" style={{fontFamily:'Manrope'}}>{formatIDR(49000)}</span>
            <span className="text-stone-500"> / bulan</span>
          </div>
          <ul className="space-y-2 text-sm text-stone-700 mb-6">
            {["Anggota keluarga tanpa batas", "Pengeluaran tanpa batas per bulan", "Tugas aktif tanpa batas", "Prioritas dukungan"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check size={16} color="#81B29A" /> {f}
              </li>
            ))}
          </ul>
          <button
            data-testid="upgrade-confirm-btn"
            className="btn-primary w-full"
            disabled={loading}
            onClick={onUpgrade}
          >
            {loading ? "Mengarahkan ke Stripe..." : "Upgrade dengan Stripe"}
          </button>
          <button data-testid="upgrade-cancel-btn" className="btn-ghost w-full mt-2" onClick={onClose}>Nanti saja</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [familyData, setFamilyData] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState("expenses");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const [famName, setFamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [expAmt, setExpAmt] = useState("");
  const [expCat, setExpCat] = useState("");
  const [expDesc, setExpDesc] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  const loadAll = async () => {
    try {
      const [f, e, t] = await Promise.all([
        api.get("/families/me"),
        api.get("/expenses"),
        api.get("/tasks"),
      ]);
      setFamilyData(f.data);
      setExpenses(e.data.expenses || []);
      setTasks(t.data.tasks || []);
    } catch (e2) {
      setErr(formatApiError(e2));
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleErr = (e) => setErr(formatApiError(e));
  const handleInfo = (m) => { setInfo(m); setTimeout(()=>setInfo(""), 3000); };

  const createFamily = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/families", { name: famName });
      setFamName("");
      await refresh();
      await loadAll();
      handleInfo("Keluarga berhasil dibuat!");
    } catch (e2) { handleErr(e2); }
  };

  const joinFamily = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/families/join", { invite_code: joinCode });
      setJoinCode("");
      await refresh();
      await loadAll();
      handleInfo("Berhasil bergabung dengan keluarga!");
    } catch (e2) { handleErr(e2); }
  };

  const addExpense = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/expenses", {
        amount: parseFloat(expAmt),
        category: expCat,
        description: expDesc,
      });
      setExpAmt(""); setExpCat(""); setExpDesc("");
      await loadAll();
    } catch (e2) { handleErr(e2); }
  };

  const addTask = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/tasks", { title: taskTitle, description: "" });
      setTaskTitle("");
      await loadAll();
    } catch (e2) { handleErr(e2); }
  };

  const toggleTask = async (id) => {
    try { await api.patch(`/tasks/${id}/complete`); await loadAll(); }
    catch (e) { handleErr(e); }
  };

  const deleteTask = async (id) => {
    try { await api.delete(`/tasks/${id}`); await loadAll(); }
    catch (e) { handleErr(e); }
  };

  const initiateUpgrade = async () => {
    setUpgrading(true);
    setErr("");
    try {
      const origin_url = window.location.origin;
      const { data } = await api.post("/payments/checkout/session", { origin_url });
      window.location.href = data.url;
    } catch (e2) {
      handleErr(e2);
      setUpgrading(false);
    }
  };

  if (!user) return null;

  const isSuspended = user.suspended;
  const family = familyData?.family;
  const limits = familyData?.limits;
  const isPremium = familyData?.is_premium || user.is_premium;

  return (
    <div className="app-shell pb-20">
      {/* Header */}
      <header className="px-6 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'#E07A5F'}}>
            <Users size={18} color="#fff" />
          </div>
          <div>
            <div className="text-xs text-stone-500">Halo,</div>
            <div className="font-semibold leading-tight" data-testid="dashboard-user-name">{user.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPremium ? (
            <span className="badge badge-premium" data-testid="user-premium-badge"><Crown size={12} className="mr-1" /> Premium</span>
          ) : (
            <span className="badge badge-free" data-testid="user-free-badge">Gratis</span>
          )}
          <button data-testid="logout-btn" onClick={() => { logout(); navigate("/login"); }} className="p-2 rounded-xl hover:bg-stone-100">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {isSuspended && (
        <div className="mx-6 mb-4 rounded-2xl p-4 bg-red-50 border border-red-100 flex items-start gap-2 text-sm">
          <ShieldAlert size={18} color="#B91C1C" />
          <div>
            <div className="font-semibold text-red-800">Akun disuspend</div>
            <div className="text-red-700">Anda hanya dapat melihat data, tidak bisa menambah/mengubah.</div>
          </div>
        </div>
      )}

      {info && <div className="mx-6 mb-3 text-sm rounded-xl p-3 bg-green-50 text-green-700 border border-green-100">{info}</div>}
      {err && <div className="mx-6 mb-3 text-sm rounded-xl p-3 bg-red-50 text-red-700 border border-red-100" data-testid="dashboard-error">{err}</div>}

      {!family ? (
        <div className="px-6 space-y-4 fade-in">
          <div className="card-surface">
            <h2 className="text-xl font-bold mb-1" style={{fontFamily:'Manrope'}}>Buat keluarga</h2>
            <p className="text-sm text-stone-600 mb-3">Mulai kelola keluarga Anda.</p>
            <form onSubmit={createFamily} className="space-y-3">
              <input data-testid="create-family-input" className="input-field" placeholder="Nama keluarga (cth: Keluarga Sari)" value={famName} onChange={(e)=>setFamName(e.target.value)} required />
              <button data-testid="create-family-btn" className="btn-primary w-full" type="submit">Buat keluarga</button>
            </form>
          </div>

          <div className="card-surface">
            <h2 className="text-xl font-bold mb-1" style={{fontFamily:'Manrope'}}>Atau bergabung</h2>
            <p className="text-sm text-stone-600 mb-3">Masukkan kode undangan dari anggota keluarga.</p>
            <form onSubmit={joinFamily} className="space-y-3">
              <input data-testid="join-family-input" className="input-field uppercase" placeholder="KODE UNDANGAN" value={joinCode} onChange={(e)=>setJoinCode(e.target.value.toUpperCase())} required />
              <button data-testid="join-family-btn" className="btn-secondary w-full" type="submit">Gabung</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="px-6 space-y-4">
          {/* Family overview */}
          <div className="card-surface">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs uppercase tracking-widest text-stone-500">Keluarga</div>
                <div className="text-lg font-bold" style={{fontFamily:'Manrope'}} data-testid="family-name">{family.name}</div>
              </div>
              {!isPremium && (
                <button data-testid="open-upgrade-btn" className="btn-primary !py-2 !px-3 text-sm" onClick={()=>setShowUpgrade(true)}>
                  <Crown size={14} className="inline mr-1" /> Upgrade
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-600 mb-3">
              Kode:&nbsp;
              <span className="font-mono font-bold tracking-wider" data-testid="family-invite-code">{family.invite_code}</span>
              <button
                data-testid="copy-invite-btn"
                onClick={()=>{navigator.clipboard.writeText(family.invite_code); handleInfo("Kode disalin");}}
                className="p-1 rounded-md hover:bg-stone-100"><Copy size={12} /></button>
            </div>

            {limits && (
              <div className="space-y-3 mt-3">
                <LimitBar label="Anggota" used={limits.members.used} max={limits.members.max} />
                <LimitBar label="Pengeluaran bulan ini" used={limits.expenses_this_month.used} max={limits.expenses_this_month.max} />
                <LimitBar label="Tugas aktif" used={limits.active_tasks.used} max={limits.active_tasks.max} />
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {familyData?.members?.map((m) => (
                <span key={m.id} className="text-xs px-2 py-1 rounded-full bg-stone-100 text-stone-700" data-testid={`member-${m.email}`}>
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 bg-stone-100 p-1 rounded-2xl">
            <button data-testid="tab-expenses" onClick={()=>setTab("expenses")} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${tab==='expenses' ? 'bg-white shadow-sm':'text-stone-600'}`}>
              <Receipt size={14} className="inline mr-1"/> Pengeluaran
            </button>
            <button data-testid="tab-tasks" onClick={()=>setTab("tasks")} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${tab==='tasks' ? 'bg-white shadow-sm':'text-stone-600'}`}>
              <ListChecks size={14} className="inline mr-1"/> Tugas
            </button>
          </div>

          {tab === "expenses" && (
            <div className="card-surface fade-in">
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Tambah pengeluaran</h3>
              <form onSubmit={addExpense} className="space-y-2">
                <input data-testid="expense-amount-input" type="number" min="1" step="any" className="input-field" placeholder="Jumlah (Rp)" value={expAmt} onChange={(e)=>setExpAmt(e.target.value)} required />
                <input data-testid="expense-category-input" className="input-field" placeholder="Kategori (cth: Makanan)" value={expCat} onChange={(e)=>setExpCat(e.target.value)} required />
                <input data-testid="expense-desc-input" className="input-field" placeholder="Deskripsi (opsional)" value={expDesc} onChange={(e)=>setExpDesc(e.target.value)} />
                <button data-testid="expense-submit-btn" className="btn-primary w-full" type="submit"><Plus size={16} className="inline mr-1"/>Tambah</button>
              </form>

              <h3 className="font-bold mt-6 mb-2" style={{fontFamily:'Manrope'}}>Riwayat</h3>
              <div className="space-y-2" data-testid="expenses-list">
                {expenses.length === 0 && <div className="text-sm text-stone-500">Belum ada pengeluaran.</div>}
                {expenses.map((x) => (
                  <div key={x.id} className="flex items-start justify-between py-2 border-b border-stone-100 last:border-0">
                    <div>
                      <div className="font-semibold">{x.category}</div>
                      <div className="text-xs text-stone-500">{x.description || '—'} • {x.user_name}</div>
                    </div>
                    <div className="font-bold text-[#E07A5F]">{formatIDR(x.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "tasks" && (
            <div className="card-surface fade-in">
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Tambah tugas</h3>
              <form onSubmit={addTask} className="flex gap-2">
                <input data-testid="task-title-input" className="input-field flex-1" placeholder="Judul tugas" value={taskTitle} onChange={(e)=>setTaskTitle(e.target.value)} required />
                <button data-testid="task-submit-btn" className="btn-primary" type="submit"><Plus size={16}/></button>
              </form>

              <h3 className="font-bold mt-6 mb-2" style={{fontFamily:'Manrope'}}>Daftar tugas</h3>
              <div className="space-y-2" data-testid="tasks-list">
                {tasks.length === 0 && <div className="text-sm text-stone-500">Belum ada tugas.</div>}
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
                    <button
                      data-testid={`task-toggle-${t.id}`}
                      onClick={()=>toggleTask(t.id)}
                      className="flex items-center gap-2 text-left flex-1"
                    >
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${t.completed ? 'bg-[#81B29A] border-[#81B29A]' : 'border-stone-300'}`}>
                        {t.completed && <Check size={12} color="#fff" />}
                      </span>
                      <span className={t.completed ? 'line-through text-stone-400':'text-stone-800'}>{t.title}</span>
                    </button>
                    <button data-testid={`task-delete-${t.id}`} onClick={()=>deleteTask(t.id)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isPremium && (
            <button
              data-testid="floating-upgrade-btn"
              onClick={()=>setShowUpgrade(true)}
              className="w-full card-surface flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:'rgba(224,122,95,0.12)'}}>
                  <Sparkles size={18} color="#E07A5F" />
                </div>
                <div className="text-left">
                  <div className="font-bold" style={{fontFamily:'Manrope'}}>Upgrade ke Premium</div>
                  <div className="text-xs text-stone-500">{formatIDR(49000)} / bulan</div>
                </div>
              </div>
              <span className="text-[#E07A5F] font-semibold">→</span>
            </button>
          )}
        </div>
      )}

      <UpgradeModal open={showUpgrade} onClose={()=>setShowUpgrade(false)} onUpgrade={initiateUpgrade} loading={upgrading} />
    </div>
  );
}
