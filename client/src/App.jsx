import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import ResearchDashboard from './pages/ResearchDashboard';

function Gate() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  return user ? <ResearchDashboard /> : <AuthPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
