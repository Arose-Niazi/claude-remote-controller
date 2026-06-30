import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { VPN_LIST, VPN_CONNECT, VPN_DISCONNECT, VPN_UPDATE } from '@crc/shared';
import type { VpnProfile, VpnUpdatePayload } from '@crc/shared';

interface VpnPanelProps {
  socket: Socket | null;
  agentId: string;
  onClose: () => void;
}

// If no VPN_UPDATE arrives within this window after an action, clear the
// spinner and surface a timeout error so the button doesn't stick on "Working...".
const ACTION_TIMEOUT_MS = 12_000;

const typeLabels: Record<string, string> = {
  wireguard: 'WireGuard',
  openvpn: 'OpenVPN',
  azure: 'Azure VPN',
};

export default function VpnPanel({ socket, agentId, onClose }: VpnPanelProps) {
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionTimerRef = useRef<number | null>(null);

  const clearActionTimer = () => {
    if (actionTimerRef.current !== null) {
      window.clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!socket) return;
    socket.emit(VPN_LIST, { agentId });

    const handleUpdate = (payload: VpnUpdatePayload) => {
      if (payload.agentId === agentId) {
        setProfiles(payload.profiles);
        setLoading(false);
        setActionLoading(null);
        setActionError(null);
        clearActionTimer();
      }
    };

    // A dropped connection means we'll never get our VPN_UPDATE — clear the
    // spinner so the button doesn't stick on "Working...".
    const handleDisconnectSocket = () => {
      setActionLoading(null);
      clearActionTimer();
      setActionError('Lost connection to the relay. Please retry.');
    };

    socket.on(VPN_UPDATE, handleUpdate);
    socket.on('disconnect', handleDisconnectSocket);
    socket.on('connect_error', handleDisconnectSocket);
    return () => {
      socket.off(VPN_UPDATE, handleUpdate);
      socket.off('disconnect', handleDisconnectSocket);
      socket.off('connect_error', handleDisconnectSocket);
      clearActionTimer();
    };
  }, [socket, agentId]);

  function startAction(profileId: string) {
    setActionLoading(profileId);
    setActionError(null);
    clearActionTimer();
    actionTimerRef.current = window.setTimeout(() => {
      // No VPN_UPDATE arrived in time — clear the spinner and surface a timeout.
      setActionLoading((current) => (current === profileId ? null : current));
      setActionError('VPN action timed out — the agent may be offline or busy. Please retry.');
      actionTimerRef.current = null;
    }, ACTION_TIMEOUT_MS);
  }

  function handleConnect(profileId: string) {
    startAction(profileId);
    socket?.emit(VPN_CONNECT, { agentId, profileId });
  }

  function handleDisconnect(profileId: string) {
    startAction(profileId);
    socket?.emit(VPN_DISCONNECT, { agentId, profileId });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider">VPN Connections</h3>
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {loading && (
            <div className="text-center text-text-muted text-sm py-6">
              Loading VPN profiles...
            </div>
          )}

          {actionError && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2 break-words">
              {actionError}
            </div>
          )}

          {!loading && profiles.length === 0 && (
            <div className="text-center text-text-muted text-sm py-6">
              No VPN profiles configured.
              <br />
              <span className="text-xs text-text-muted">
                Add profiles to ~/.crc-agent/config.json
              </span>
            </div>
          )}

          {profiles.map((profile) => {
            const isConnected = profile.status === 'connected';
            const isBusy =
              actionLoading === profile.id ||
              profile.status === 'connecting' ||
              profile.status === 'disconnecting';

            return (
              <div
                key={profile.id}
                className="bg-surface-deep rounded-xl border border-border-subtle p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span>{isConnected ? '\u{1F512}' : '\u{1F513}'}</span>
                    <span className="text-sm font-medium text-text">{profile.name}</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                      isConnected
                        ? 'bg-green-500/15 text-green-400'
                        : profile.status === 'error'
                        ? 'bg-red-500/10 text-red-400'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {profile.status}
                  </span>
                </div>

                <div className="text-xs text-text-muted mb-2">
                  {typeLabels[profile.type] || profile.type}
                </div>

                {profile.error && (
                  <div className={`text-xs mb-2 rounded-lg p-1.5 break-words ${
                    profile.error.includes('app opened')
                      ? 'text-blue-300 bg-blue-500/10'
                      : 'text-red-400 bg-red-500/10'
                  }`}>
                    {profile.error}
                  </div>
                )}

                <button
                  onClick={() =>
                    isConnected
                      ? handleDisconnect(profile.id)
                      : handleConnect(profile.id)
                  }
                  disabled={isBusy}
                  className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    isConnected
                      ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {isBusy
                    ? 'Working...'
                    : isConnected
                    ? 'Disconnect'
                    : 'Connect'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
