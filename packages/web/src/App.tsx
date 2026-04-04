import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useSocket } from './hooks/useSocket';
import Layout from './components/Layout';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import TerminalView from './components/TerminalView';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const { socket, connected } = useSocket();

  if (!token) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Layout connected={connected}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard socket={socket} />} />
        <Route path="/terminal/:agentId" element={<TerminalView socket={socket} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
