import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Shield, Sliders, Save } from 'lucide-react';
import { userApi } from '../services/api';

const Settings = () => {
  const [settings, setSettings] = useState({
    maxRiskScore: 50,
    autoExitEnabled: false,
    slippageBps: 100,
    displayName: '',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data } = await userApi.getProfile();
      const profile = data.data;
      setSettings({
        maxRiskScore: profile.maxRiskScore ?? 50,
        autoExitEnabled: profile.autoExitEnabled ?? false,
        slippageBps: profile.slippageBps ?? 100,
        displayName: profile.displayName ?? '',
      });
    } catch {
      // Use defaults
    }
  };

  const handleSave = async () => {
    try {
      await userApi.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // Handle error
    }
  };

  const getRiskLabel = (score: number) => {
    if (score >= 75) return { label: 'Very Aggressive', color: 'var(--color-danger)' };
    if (score >= 50) return { label: 'Moderate', color: 'var(--color-warning)' };
    if (score >= 30) return { label: 'Conservative', color: 'var(--color-safe)' };
    return { label: 'Ultra Safe', color: 'var(--color-info)' };
  };

  const riskProfile = getRiskLabel(settings.maxRiskScore);

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, marginBottom: 'var(--space-2)' }}>
          <SettingsIcon size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--space-3)' }} />
          Risk Settings
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-8)' }}>
          Customize your risk tolerance and Guardian behavior
        </p>
      </motion.div>

      <div className="grid grid-2">
        {/* Risk Tolerance */}
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="card-header">
            <h3 className="card-title">
              <Shield size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Risk Tolerance
            </h3>
            <span style={{ color: riskProfile.color, fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              {riskProfile.label}
            </span>
          </div>

          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
            }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Max Risk Score</span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                color: riskProfile.color,
                fontSize: 'var(--text-lg)',
              }}>
                {settings.maxRiskScore}
              </span>
            </div>

            <input
              type="range"
              min={10}
              max={90}
              value={settings.maxRiskScore}
              onChange={(e) => setSettings({ ...settings, maxRiskScore: parseInt(e.target.value) })}
              style={{
                width: '100%',
                accentColor: riskProfile.color,
                height: 6,
                cursor: 'pointer',
              }}
            />

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginTop: 'var(--space-1)',
            }}>
              <span>Ultra Safe (10)</span>
              <span>Aggressive (90)</span>
            </div>
          </div>

          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            Transactions will be <strong>blocked</strong> if the token's risk score exceeds this threshold.
            Lower values = more protection, but may block some legitimate trades.
          </p>
        </motion.div>

        {/* Advanced Settings */}
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="card-header">
            <h3 className="card-title">
              <Sliders size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Advanced
            </h3>
          </div>

          {/* Auto Exit */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--space-4)',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>🛡️ Guardian Auto-Exit</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Auto-sell if dev rugs or cluster dumps
              </div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, autoExitEnabled: !settings.autoExitEnabled })}
              style={{
                width: 50,
                height: 28,
                borderRadius: 'var(--radius-full)',
                border: 'none',
                cursor: 'pointer',
                background: settings.autoExitEnabled ? 'var(--color-safe)' : 'var(--color-bg-tertiary)',
                position: 'relative',
                transition: 'all var(--transition-fast)',
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: 3,
                left: settings.autoExitEnabled ? 25 : 3,
                transition: 'all var(--transition-fast)',
                boxShadow: 'var(--shadow-sm)',
              }} />
            </button>
          </div>

          {/* Slippage */}
          <div style={{
            padding: 'var(--space-4)',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-2)',
            }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Default Slippage</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-primary-light)' }}>
                {(settings.slippageBps / 100).toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={5000}
              step={10}
              value={settings.slippageBps}
              onChange={(e) => setSettings({ ...settings, slippageBps: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              <span>0.1%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Display Name */}
          <div style={{ padding: 'var(--space-4)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
            <label style={{ fontWeight: 600, fontSize: 'var(--text-sm)', display: 'block', marginBottom: 'var(--space-2)' }}>
              Display Name
            </label>
            <input
              className="input"
              value={settings.displayName}
              onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
              placeholder="Your display name"
            />
          </div>
        </motion.div>
      </div>

      {/* Save Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}
      >
        <button className="btn btn-primary btn-lg" onClick={handleSave}>
          <Save size={16} />
          Save Settings
        </button>
        {saved && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ color: 'var(--color-safe)', fontWeight: 600 }}
          >
            ✓ Settings saved!
          </motion.span>
        )}
      </motion.div>
    </div>
  );
};

export default Settings;
