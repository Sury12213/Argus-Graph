import { motion } from 'framer-motion';
import { Activity, BadgeDollarSign, Database, Network, Radio, ScanSearch, ShieldCheck, Zap } from 'lucide-react';
import { Button, Card, MetricCard } from '../components/ui';
import argusLogo from '../assets/argus-logo.svg';

const features = [
  { icon: <Network size={20} />, title: 'Wallet cluster detection', desc: 'Graph-based detection of coordinated wallets, circular trading, and wash patterns.' },
  { icon: <Activity size={20} />, title: 'Velocity analytics', desc: 'Live momentum, holder movement, and pump-risk signals from time-series behavior.' },
  { icon: <BadgeDollarSign size={20} />, title: 'Smart money tracking', desc: 'Alpha wallets, whale inflows, and exit signals from high-conviction holders.' },
  { icon: <Radio size={20} />, title: 'Social intelligence', desc: 'Sentiment, bot ratio, and viral activity context for each scan target.' },
];

const LandingPage = ({ onConnect }: { onConnect: () => void }) => {
  return (
    <div className="landing-shell">
      <div className="landing-noise" />
      <div className="landing-container">
        <header className="landing-header">
          <div className="landing-brand">
            <span className="brand-logo"><img src={argusLogo} alt="" /></span>
            <div>
              <strong>Argus-Graph</strong>
              <span>Solana wallet intelligence</span>
            </div>
          </div>
          <Button variant="ghost" onClick={onConnect}>Connect wallet</Button>
        </header>

        <main className="landing-hero">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="page-eyebrow">Forensic risk engine</div>
            <h1 className="landing-title">Professional wallet intelligence before execution risk becomes loss.</h1>
            <p className="landing-copy">Argus-Graph combines cluster analysis, social velocity, smart-money flow, and execution safety into one decision-grade Solana risk console.</p>
            <div className="landing-actions">
              <Button variant="primary" size="lg" icon={<ScanSearch size={18} />} onClick={onConnect}>Start secure scan</Button>
              <div className="landing-proof"><ShieldCheck size={16} /> No seed phrase requests. Wallet signature only.</div>
            </div>
          </motion.div>

          <motion.div className="landing-preview panel panel-pad" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
            <div className="section-header">
              <div className="section-header__main">
                <span className="icon-shell"><Database size={20} /></span>
                <div>
                  <h2 className="section-header__title">Scan intelligence</h2>
                  <p className="section-header__description">Weighted engine output, not cosmetic scoring.</p>
                </div>
              </div>
            </div>
            <div className="grid grid-2">
              <MetricCard label="Risk score" value="18.4" helperText="Low exposure" icon={<ShieldCheck size={18} />} />
              <MetricCard label="Velocity" value="42%" helperText="Stable activity" icon={<Activity size={18} />} />
              <MetricCard label="Clusters" value="7" helperText="2 watched groups" icon={<Network size={18} />} />
              <MetricCard label="Execution" value="Clear" helperText="No guardrails triggered" icon={<Zap size={18} />} />
            </div>
          </motion.div>
        </main>

        <section className="landing-features">
          {features.map((feature, index) => (
            <motion.div key={feature.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + index * 0.08 }}>
              <Card icon={feature.icon} title={feature.title} description={feature.desc}><div /></Card>
            </motion.div>
          ))}
        </section>
      </div>
    </div>
  );
};

export default LandingPage;


