import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { VPN_LIST, VPN_CONNECT, VPN_DISCONNECT, VPN_UPDATE } from '@crc/shared';
import type { VpnProfile, VpnUpdatePayload } from '@crc/shared';

interface VpnPanelProps {
  socket: Socket | null;
  agentId: string;
  onClose: () => void;
}

const typeLabels: Record<string, string> = {
  wireguard: 'WireGuard',
  openvpn: 'OpenVPN',
  azure: 'Azure VPN',
};

export default function VpnPanel({ socket, agentId, onClose }: VpnPanelProps) {
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit(VPN_LIST, { agentId });

    const handleUpdate = (payload: VpnUpdatePayload) => {
      if (payload.agentId === agentId) {
        setProfiles(payload.profiles);
        setLoading(false);
        setActionLoading(null);
      }
    };

    socket.on(VPN_UPDATE, handleUpdate);
    return () => {
      socket.off(VPN_UPDATE, handleUpdate);
    };
  }, [socket, agentId]);

  function handleConnect(profileId: string) {
    setActionLoading(profileId);
    socket?.emit(VPN_CONNECT, { agentId, profileId });
  }

  function handleDisconnect(profileId: string) {
    setActionLoading(profileId);
    socket?.emit(VPN_DISCONNECT, { agentId, profileId });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold">VPN Connections</h3>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {loading && (
            <div className="text-center text-slate-400 text-sm py-6">
              Loading VPN profiles...
            </div>
          )}

          {!loading && profiles.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-6">
              No VPN profiles configured.
              <br />
              <span className="text-xs text-slate-500">
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
                className="rounded-lg border bg-slate-900/50 border-slate-700 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span>{isConnected ? '\u{1F512}' : '\u{1F513}'}</span>
                    <span className="text-sm font-medium">{profile.name}</span>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      isConnected
                        ? 'bg-green-900/40 text-green-400'
                        : profile.status === 'error'
                        ? 'bg-red-900/40 text-red-400'
                        : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {profile.status}
                  </span>
                </div>

                <div className="text-xs text-slate-500 mb-2">
                  {typeLabels[profile.type] || profile.type}
                </div>

                {profile.error && (
                  <div className="text-xs text-red-400 mb-2 bg-red-900/20 rounded p-1.5 break-words">
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
                  className={`w-full py-1.5 text-xs font-medium rounded transition-colors ${
                    isConnected
                      ? 'bg-red-900/60 hover:bg-red-800 text-red-300'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
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
