import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthPage from "@/pages/AuthPage";
import Dashboard from "@/pages/Dashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import Landing from "@/pages/Landing";
import SplashScreen from "@/components/SplashScreen";
import { PaymentSuccessPage, PaymentCancelPage } from "@/pages/PaymentPages";

function Protected({ children, adminOnly = false }) {
  const { user, bootstrapped } = useAuth();
  if (!bootstrapped) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/app" replace />;
  if (!adminOnly && user.role === "admin") return <Navigate to="/admin" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user, bootstrapped } = useAuth();
  if (!bootstrapped) return <SplashScreen />;
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/app"} replace />;
  return children;
}

function RootGate() {
  // Landing is accessible to everyone; logged-in users see "Buka Dashboard" CTA
  const { bootstrapped } = useAuth();
  if (!bootstrapped) return <SplashScreen />;
  return <Landing />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootGate />} />
      <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
      <Route path="/app" element={<Protected><Dashboard /></Protected>} />
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
