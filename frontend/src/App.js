import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthPage from "@/pages/AuthPage";
import Dashboard from "@/pages/Dashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import { PaymentSuccessPage, PaymentCancelPage } from "@/pages/PaymentPages";

function Protected({ children, adminOnly = false }) {
  const { user, bootstrapped } = useAuth();
  if (!bootstrapped) {
    return (
      <div className="app-shell flex items-center justify-center min-h-screen">
        <div className="text-stone-500 text-sm">Memuat...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  // If logged-in admin lands on user dashboard, redirect to /admin
  if (!adminOnly && user.role === "admin") return <Navigate to="/admin" replace />;
  return children;
}

function AppRoutes() {
  const { user, bootstrapped } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={
        !bootstrapped ? <div className="app-shell flex items-center justify-center"><div className="text-stone-500 text-sm pt-20">Memuat...</div></div>
        : user ? <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace /> : <AuthPage mode="login" />
      } />
      <Route path="/register" element={
        !bootstrapped ? <div className="app-shell flex items-center justify-center"><div className="text-stone-500 text-sm pt-20">Memuat...</div></div>
        : user ? <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace /> : <AuthPage mode="register" />
      } />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/admin" element={<Protected adminOnly><AdminDashboard /></Protected>} />
      <Route path="/payment/success" element={<Protected><PaymentSuccessPage /></Protected>} />
      <Route path="/payment/cancel" element={<Protected><PaymentCancelPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
