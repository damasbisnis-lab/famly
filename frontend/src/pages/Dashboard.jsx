import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, formatIDR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PushToggle } from "@/components/PushToggle";
import { InstallPWA } from "@/components/InstallPWA";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { ReferralCard } from "@/components/ReferralCard";
import {
  Plus, Receipt, ListChecks, Crown, LogOut, Copy, Trash2, Check, Sparkles, ShieldAlert
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

function UpgradeModal({ open, onClose, onUpgrade, loading, proofFile, setProofFile, settings }) {
  if (!open) return null;
  const price = settings?.premium_price ?? 49000;
  const showStrike = settings?.show_strikethrough && settings?.premium_original_price > price;
  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { alert("Maksimal 2MB"); return; }
    setProofFile(f);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center px-4 fade-in" onClick={onClose}>
      <div
        className="bg-white rounded-3xl p-8 max-w-md w-full border shadow-2xl relative overflow-hidden"
        style={{borderColor: 'rgba(240,140,63,0.25)'}}
        onClick={(e) => e.stopPropagation()}
        data-testid="upgrade-modal"
      >
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-25 pointer-events-none"
             style={{background:'radial-gradient(circle, #E8B341 0%, transparent 70%)'}} />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full opacity-20 pointer-events-none"
             style={{background:'radial-gradient(circle, #2F7A7D 0%, transparent 70%)'}} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <img src="/brand/famly-logo.png" alt="" className="w-12 h-12 object-contain" />
            <div>
              <div className="text-xs uppercase tracking-widest" style={{color:'#F08C3F'}}>Famly</div>
              <h2 className="text-2xl font-bold leading-none" style={{fontFamily:'Manrope'}}>Premium</h2>
            </div>
          </div>
          <p className="text-stone-600 mb-4 text-sm">Buka semua batasan untuk keluarga Anda.</p>
          <div className="mb-6 flex items-baseline gap-2 flex-wrap" data-testid="upgrade-price">
            {showStrike && (
              <span className="text-2xl text-stone-400 line-through" data-testid="upgrade-price-original">{formatIDR(settings.premium_original_price)}</span>
            )}
            <span className="text-4xl font-bold" style={{fontFamily:'Manrope'}}>{formatIDR(price)}</span>
            <span className="text-stone-500"> / bulan</span>
          </div>
          <ul className="space-y-2 text-sm text-stone-700 mb-6">
            {["Anggota keluarga tanpa batas", "Pengeluaran tanpa batas per bulan", "Tugas aktif tanpa batas", "Prioritas dukungan"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check size={16} color="#7BA98A" /> {f}
              </li>
            ))}
          </ul>
          <div className="mb-4 p-3 rounded-xl border border-stone-200 bg-stone-50">
            <label className="text-xs font-semibold text-stone-700 block mb-2">Bukti transfer (opsional, max 2MB)</label>
            <input
              data-testid="proof-file-input"
              type="file"
              accept="image/*"
              onChange={onFileChange}
              className="text-xs w-full"
            />
            {proofFile && <div className="text-xs text-green-700 mt-1">✓ {proofFile.name}</div>}
          </div>
          <button
            data-testid="upgrade-confirm-btn"
            className="btn-primary w-full"
            disabled={loading}
            onClick={onUpgrade}
          >
            {loading ? "Membuka WhatsApp..." : "Konfirmasi via WhatsApp Admin"}
          </button>
          <p className="text-xs text-center text-stone-500 mt-2">
            Anda akan diarahkan ke chat WhatsApp admin Famly untuk konfirmasi pembayaran manual.
          </p>
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
  const [proofFile, setProofFile] = useState(null);
  const [myReq, setMyReq] = useState(null);
  const [settings, setSettings] = useState(null);

  const [famName, setFamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [expAmt, setExpAmt] = useState("");
  const [expCat, setExpCat] = useState("");
  const [expDesc, setExpDesc] = useState("");
  const [expType, setExpType] = useState("expense");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskTime, setTaskTime] = useState("");
  const [taskRecurrence, setTaskRecurrence] = useState("none");
  const [taskView, setTaskView] = useState("list"); // 'list' | 'calendar'
  const [calMonth, setCalMonth] = useState(() => { const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()}; });
  const [calSelected, setCalSelected] = useState(null);

  const loadAll = async () => {
    try {
      const [f, e, t, mr] = await Promise.all([
        api.get("/families/me"),
        api.get("/expenses"),
        api.get("/tasks"),
        api.get("/payments/my-request").catch(()=>({data:{request:null}})),
      ]);
      setFamilyData(f.data);
      setExpenses(e.data.expenses || []);
      setTasks(t.data.tasks || []);
      setMyReq(mr.data.request);
      api.get("/settings/public").then(s=>setSettings(s.data)).catch(()=>{});
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
        type: expType,
      });
      setExpAmt(""); setExpCat(""); setExpDesc(""); setExpType("expense");
      await loadAll();
    } catch (e2) { handleErr(e2); }
  };

  const addTask = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/tasks", { title: taskTitle, description: "", assigned_to: taskAssignee || null, due_date: taskDue || null, due_time: (taskDue && taskTime) ? taskTime : null, recurrence: taskDue ? taskRecurrence : "none" });
      setTaskTitle(""); setTaskAssignee(""); setTaskDue(""); setTaskTime(""); setTaskRecurrence("none");
      await loadAll();
    } catch (e2) { handleErr(e2); }
  };

  const toggleTask = async (id) => {
    try {
      const { data } = await api.patch(`/tasks/${id}/complete`);
      if (data.rescheduled) {
        handleInfo(`Tugas berulang dijadwalkan ulang ke ${new Date(data.next_date).toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'})}`);
      }
      await loadAll();
    }
    catch (e) { handleErr(e); }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm("Hapus transaksi ini? Anda bisa menambahkannya kembali.")) return;
    try { await api.delete(`/expenses/${id}`); await loadAll(); }
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
      const { data } = await api.post("/payments/request-upgrade");
      // Upload proof if attached
      if (proofFile) {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(proofFile);
        });
        await api.post("/payments/upload-proof", { proof_image: b64 });
      }
      window.open(data.wa_url, "_blank");
      handleInfo("Permintaan dikirim. Lanjutkan chat WhatsApp untuk konfirmasi.");
      setShowUpgrade(false);
      setProofFile(null);
      await loadAll();
    } catch (e2) {
      handleErr(e2);
    } finally {
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
        <div className="flex items-center gap-3">
          <img src="/brand/famly-logo.png" alt="Famly" className="brand-logo-sm" />
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

      {myReq && myReq.status === "pending" && (
        <div className="mx-6 mb-3 rounded-2xl p-3 bg-yellow-50 border border-yellow-200 text-xs" data-testid="request-status-banner">
          ⏳ Permintaan upgrade <b>{myReq.code}</b> menunggu konfirmasi admin via WhatsApp.
        </div>
      )}
      {myReq && myReq.status === "approved" && !isPremium && (
        <div className="mx-6 mb-3 rounded-2xl p-3 bg-green-50 border border-green-200 text-xs" data-testid="request-status-banner">
          ✓ Permintaan <b>{myReq.code}</b> disetujui. Refresh untuk update status Premium.
        </div>
      )}
      {myReq && myReq.status === "rejected" && (
        <div className="mx-6 mb-3 rounded-2xl p-3 bg-red-50 border border-red-200 text-xs" data-testid="request-status-banner">
          ✕ Permintaan <b>{myReq.code}</b> ditolak. Hubungi admin untuk info lebih lanjut.
        </div>
      )}

      {info && <div className="mx-6 mb-3 text-sm rounded-xl p-3 bg-green-50 text-green-700 border border-green-100">{info}</div>}
      {err && <div className="mx-6 mb-3 text-sm rounded-xl p-3 bg-red-50 text-red-700 border border-red-100" data-testid="dashboard-error">{err}</div>}

      <div className="px-6 mb-3">
        <InstallPWA className="w-full" />
      </div>

      <WelcomeBanner />

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
            <button
              data-testid="invite-member-btn"
              onClick={()=>{
                const msg = encodeURIComponent(`Yuk gabung ke keluarga "${family.name}" di Famly! Kode undangan: ${family.invite_code}\nDaftar: ${window.location.origin}`);
                window.open(`https://wa.me/?text=${msg}`, "_blank");
              }}
              className="mt-3 w-full py-2 rounded-xl text-sm font-semibold border border-dashed flex items-center justify-center gap-2"
              style={{borderColor:'#7BA98A', color:'#5F8E70'}}
            >
              <Plus size={14}/> Ajak Anggota via WhatsApp
            </button>
          </div>

          {/* Referral program */}
          <ReferralCard onInfo={handleInfo} />

          {/* Tabs */}
          <div className="flex gap-2 bg-stone-100 p-1 rounded-2xl">
            <button data-testid="tab-expenses" onClick={()=>setTab("expenses")} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${tab==='expenses' ? 'bg-white shadow-sm':'text-stone-600'}`}>
              <Receipt size={14} className="inline mr-1"/> Keuangan
            </button>
            <button data-testid="tab-tasks" onClick={()=>setTab("tasks")} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${tab==='tasks' ? 'bg-white shadow-sm':'text-stone-600'}`}>
              <ListChecks size={14} className="inline mr-1"/> Tugas
            </button>
          </div>

          {tab === "expenses" && (
            <div className="card-surface fade-in">
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Tambah transaksi</h3>
              <form onSubmit={addExpense} className="space-y-2">
                <div className="flex gap-2">
                  <button type="button" data-testid="type-expense-btn" onClick={()=>setExpType("expense")} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${expType==='expense' ? 'bg-[#F08C3F] text-white border-[#F08C3F]':'border-stone-200 text-stone-600'}`}>Pengeluaran</button>
                  <button type="button" data-testid="type-income-btn" onClick={()=>setExpType("income")} className={`flex-1 py-2 rounded-xl text-sm font-semibold border ${expType==='income' ? 'bg-[#7BA98A] text-white border-[#7BA98A]':'border-stone-200 text-stone-600'}`}>Pemasukan</button>
                </div>
                <input data-testid="expense-amount-input" type="number" min="1" step="any" className="input-field" placeholder="Jumlah (Rp)" value={expAmt} onChange={(e)=>setExpAmt(e.target.value)} required />
                <input data-testid="expense-category-input" className="input-field" placeholder={expType==='income' ? 'Sumber (cth: Gaji)' : 'Kategori (cth: Makanan)'} value={expCat} onChange={(e)=>setExpCat(e.target.value)} required />
                <input data-testid="expense-desc-input" className="input-field" placeholder="Deskripsi (opsional)" value={expDesc} onChange={(e)=>setExpDesc(e.target.value)} />
                <button data-testid="expense-submit-btn" className="btn-primary w-full" type="submit"><Plus size={16} className="inline mr-1"/>Tambah</button>
              </form>

              {(() => {
                const income = expenses.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0);
                const out = expenses.filter(x=>x.type!=='income').reduce((s,x)=>s+x.amount,0);
                return (
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="rounded-xl p-2 text-center" style={{background:'rgba(123,169,138,0.15)'}}>
                      <div className="text-[10px] text-stone-600">Pemasukan</div>
                      <div className="text-sm font-bold" style={{color:'#5F8E70'}}>{formatIDR(income)}</div>
                    </div>
                    <div className="rounded-xl p-2 text-center" style={{background:'rgba(240,140,63,0.12)'}}>
                      <div className="text-[10px] text-stone-600">Pengeluaran</div>
                      <div className="text-sm font-bold" style={{color:'#DD7728'}}>{formatIDR(out)}</div>
                    </div>
                    <div className="rounded-xl p-2 text-center bg-stone-100">
                      <div className="text-[10px] text-stone-600">Saldo</div>
                      <div className="text-sm font-bold">{formatIDR(income-out)}</div>
                    </div>
                  </div>
                );
              })()}

              <h3 className="font-bold mt-6 mb-2" style={{fontFamily:'Manrope'}}>Riwayat</h3>
              <div className="space-y-2" data-testid="expenses-list">
                {expenses.length === 0 && <div className="text-sm text-stone-500">Belum ada transaksi.</div>}
                {expenses.map((x) => (
                  <div key={x.id} className="flex items-start justify-between py-2 border-b border-stone-100 last:border-0">
                    <div>
                      <div className="font-semibold flex items-center gap-1">
                        {x.type==='income' && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{background:'rgba(123,169,138,0.18)',color:'#5F8E70'}}>+ Masuk</span>}
                        {x.category}
                      </div>
                      <div className="text-xs text-stone-500">{x.description || '—'} • {x.user_name}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="font-bold" style={{color: x.type==='income' ? '#5F8E70' : '#F08C3F'}}>{x.type==='income'?'+':'-'} {formatIDR(x.amount)}</div>
                      <button data-testid={`expense-delete-${x.id}`} onClick={()=>deleteExpense(x.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "tasks" && (
            <div className="card-surface fade-in">
              <h3 className="font-bold mb-3" style={{fontFamily:'Manrope'}}>Tambah tugas</h3>
              <form onSubmit={addTask} className="space-y-2">
                <input data-testid="task-title-input" className="input-field" placeholder="Judul tugas" value={taskTitle} onChange={(e)=>setTaskTitle(e.target.value)} required />
                <select data-testid="task-assignee-select" className="input-field" value={taskAssignee} onChange={(e)=>setTaskAssignee(e.target.value)}>
                  <option value="">— Untuk siapa saja —</option>
                  {familyData?.members?.map((m)=>(
                    <option key={m.id} value={m.id}>{m.name}{m.id===user.id?' (saya)':''}</option>
                  ))}
                </select>
                <div>
                  <label className="text-xs text-stone-500 mb-1 block">Tanggal jatuh tempo (opsional)</label>
                  <input data-testid="task-due-input" type="date" className="input-field" value={taskDue} onChange={(e)=>setTaskDue(e.target.value)} />
                </div>
                {taskDue && (
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">Jam pengingat (opsional)</label>
                    <input data-testid="task-time-input" type="time" className="input-field" value={taskTime} onChange={(e)=>setTaskTime(e.target.value)} />
                    <p className="text-[11px] text-stone-400 mt-1">Kosongkan jika tugas tidak terikat jam tertentu.</p>
                  </div>
                )}
                {taskDue && (
                  <div>
                    <label className="text-xs text-stone-500 mb-1 block">Pengulangan</label>
                    <select data-testid="task-recurrence-select" className="input-field" value={taskRecurrence} onChange={(e)=>setTaskRecurrence(e.target.value)}>
                      <option value="none">🔁 Tidak berulang</option>
                      <option value="daily">🔁 Setiap hari</option>
                      <option value="weekly">🔁 Setiap minggu</option>
                    </select>
                  </div>
                )}
                <button data-testid="task-submit-btn" className="btn-primary w-full" type="submit"><Plus size={16} className="inline mr-1"/>Tambah Tugas</button>
              </form>

              <h3 className="font-bold mt-6 mb-2 flex items-center justify-between" style={{fontFamily:'Manrope'}}>
                <span>Daftar tugas</span>
                <div className="flex gap-1 text-xs bg-stone-100 rounded-lg p-0.5">
                  <button data-testid="task-view-list" onClick={()=>{setTaskView("list");setCalSelected(null);}} className={`px-2 py-1 rounded ${taskView==='list'?'bg-white shadow-sm font-semibold':''}`}>List</button>
                  <button data-testid="task-view-calendar" onClick={()=>setTaskView("calendar")} className={`px-2 py-1 rounded ${taskView==='calendar'?'bg-white shadow-sm font-semibold':''}`}>📅 Kalender</button>
                </div>
              </h3>

              {taskView === "calendar" && (() => {
                const {y, m} = calMonth;
                const first = new Date(y, m, 1);
                const daysInMonth = new Date(y, m+1, 0).getDate();
                const startDay = first.getDay(); // 0=Sun
                const monthName = first.toLocaleDateString('id-ID',{month:'long',year:'numeric'});
                const cells = [];
                for (let i=0;i<startDay;i++) cells.push(null);
                for (let d=1;d<=daysInMonth;d++) cells.push(d);
                const todayIso = new Date().toISOString().slice(0,10);
                const pad = (n)=>String(n).padStart(2,'0');
                const tasksByDate = {};
                tasks.forEach(t=>{ if(t.due_date){ tasksByDate[t.due_date]=(tasksByDate[t.due_date]||[]).concat(t); } });
                const prevMonth = ()=>setCalMonth({y: m===0?y-1:y, m: m===0?11:m-1});
                const nextMonth = ()=>setCalMonth({y: m===11?y+1:y, m: m===11?0:m+1});
                return (
                  <div data-testid="task-calendar">
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={prevMonth} className="p-1 rounded hover:bg-stone-100">‹</button>
                      <div className="font-semibold capitalize">{monthName}</div>
                      <button onClick={nextMonth} className="p-1 rounded hover:bg-stone-100">›</button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-stone-500 mb-1">
                      {['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map(d=><div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {cells.map((d,i)=>{
                        if (d===null) return <div key={i}/>;
                        const iso = `${y}-${pad(m+1)}-${pad(d)}`;
                        const tList = tasksByDate[iso]||[];
                        const isToday = iso===todayIso;
                        const isSelected = calSelected===iso;
                        const hasOverdue = tList.some(t=>!t.completed && iso<todayIso);
                        return (
                          <button key={i} data-testid={`cal-day-${iso}`} onClick={()=>setCalSelected(isSelected?null:iso)}
                            className={`aspect-square rounded-lg border text-xs flex flex-col items-center justify-center relative ${isSelected?'bg-[#F08C3F] text-white border-[#F08C3F]':isToday?'border-[#F08C3F] bg-orange-50':'border-stone-200 hover:bg-stone-50'}`}>
                            <span className="font-semibold">{d}</span>
                            {tList.length>0 && <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${hasOverdue?'bg-red-500':isSelected?'bg-white':'bg-[#7BA98A]'}`}/>}
                            {tList.length>1 && <span className="text-[8px]">{tList.length}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {calSelected && <div className="text-xs text-stone-600 mt-3">Tugas pada {new Date(calSelected).toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'})}:</div>}
                  </div>
                );
              })()}

              <div className="space-y-2 mt-3" data-testid="tasks-list">
                {tasks.length === 0 && <div className="text-sm text-stone-500">Belum ada tugas.</div>}
                {tasks.filter(t=>!calSelected || t.due_date===calSelected).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
                    <button
                      data-testid={`task-toggle-${t.id}`}
                      onClick={()=>toggleTask(t.id)}
                      className="flex items-center gap-2 text-left flex-1"
                    >
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${t.completed ? 'bg-[#7BA98A] border-[#7BA98A]' : 'border-stone-300'}`}>
                        {t.completed && <Check size={12} color="#fff" />}
                      </span>
                      <span className="flex-1">
                        <span className={t.completed ? 'line-through text-stone-400':'text-stone-800'}>{t.title}</span>
                        {t.assigned_to_name && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{background:'rgba(47,122,125,0.12)',color:'#2F7A7D'}}>→ {t.assigned_to_name}</span>}
                        {t.recurrence && t.recurrence !== 'none' && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{background:'rgba(123,169,138,0.15)',color:'#5F8E70'}}>🔁 {t.recurrence==='daily'?'Harian':'Mingguan'}</span>}
                        {t.due_date && (() => {
                          const today = new Date().toISOString().slice(0,10);
                          const overdue = !t.completed && t.due_date < today;
                          const dueToday = !t.completed && t.due_date === today;
                          return <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{background: overdue?'#FEE2E2':dueToday?'rgba(232,179,65,0.2)':'rgba(123,169,138,0.15)', color: overdue?'#B91C1C':dueToday?'#9A6B0E':'#5F8E70'}}>📅 {new Date(t.due_date).toLocaleDateString('id-ID',{day:'numeric',month:'short'})}{t.due_time?` • ${t.due_time}`:''}</span>;
                        })()}
                      </span>
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
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:'rgba(240,140,63,0.14)'}}>
                  <Sparkles size={18} color="#F08C3F" />
                </div>
                <div className="text-left">
                  <div className="font-bold" style={{fontFamily:'Manrope'}}>Upgrade ke Premium</div>
                  <div className="text-xs text-stone-500">
                    {settings?.show_strikethrough && settings?.premium_original_price > (settings?.premium_price ?? 49000) && (
                      <span className="line-through mr-1">{formatIDR(settings.premium_original_price)}</span>
                    )}
                    {formatIDR(settings?.premium_price ?? 49000)} / bulan
                  </div>
                </div>
              </div>
              <span className="font-semibold" style={{color:'#F08C3F'}}>→</span>
            </button>
          )}

          {/* Reminder settings (bottom) */}
          <PushToggle />
        </div>
      )}

      <UpgradeModal open={showUpgrade} onClose={()=>setShowUpgrade(false)} onUpgrade={initiateUpgrade} loading={upgrading} proofFile={proofFile} setProofFile={setProofFile} settings={settings} />
    </div>
  );
}
