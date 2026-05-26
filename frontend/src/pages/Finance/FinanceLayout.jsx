import { useState, useCallback, useRef, useEffect } from 'react';


// ── SAP Data ──
const SAP_CONFIG = {
  odataBaseUrl: 'https://your-s4hana.example.com/sap/opu/odata/sap',
  clientId: '',
  clientSecret: '',
  deepseekApiKey: 'YOUR_DEEPSEEK_API_KEY',
  deepseekModel: 'deepseek-chat',
  useLiveData: false,
};

const MOCK_INVOICES = [
  { id: '9100048291', customer: 'Tata Motors Ltd', docDate: '29-Apr-25', dueDate: '29-May-25', amount: 2450000, tax: 441000, net: 2009000, status: 'Cleared', companyCode: '1000' },
  { id: '9100048290', customer: 'Reliance Industries', docDate: '28-Apr-25', dueDate: '28-May-25', amount: 1875000, tax: 337500, net: 1537500, status: 'Open', companyCode: '1000' },
  { id: '9100048285', customer: 'Infosys BPO', docDate: '25-Apr-25', dueDate: '25-May-25', amount: 920000, tax: 165600, net: 754400, status: 'Pending', companyCode: '2000' },
  { id: '9100048271', customer: 'L&T Construction', docDate: '15-Apr-25', dueDate: '15-Apr-25', amount: 3210000, tax: 577800, net: 2632200, status: 'Overdue', companyCode: '1000' },
  { id: '9100048269', customer: 'Wipro Technologies', docDate: '14-Apr-25', dueDate: '14-May-25', amount: 1260000, tax: 226800, net: 1033200, status: 'Cleared', companyCode: '2000' },
  { id: '9100048255', customer: 'HCL Technologies', docDate: '10-Apr-25', dueDate: '10-Apr-25', amount: 680000, tax: 122400, net: 557600, status: 'Overdue', companyCode: '1000' },
];

const MOCK_WEEKLY_REVENUE = [
  { day: 'Mon', value: 6000000, label: '₹60L' },
  { day: 'Tue', value: 8200000, label: '₹82L' },
  { day: 'Wed', value: 12000000, label: '₹1.2Cr' },
  { day: 'Thu', value: 7400000, label: '₹74L' },
  { day: 'Fri', value: 9100000, label: '₹91L' },
  { day: 'Sat', value: 4500000, label: '₹45L' },
  { day: 'Sun', value: 3000000, label: '₹30L' },
];

const MOCK_INVOICE_STATUS = [
  { label: 'Cleared', count: 253, pct: 52.6, color: '#188A2E' },
  { label: 'Open',    count: 142, pct: 29.5, color: '#0070F2' },
  { label: 'Pending', count: 57,  pct: 11.8, color: '#E8A000' },
  { label: 'Overdue', count: 29,  pct: 6.1,  color: '#BB0000' },
];

const KPI_DATA = [
  { label: 'Total Sales Invoices', value: '₹4.82 Cr', delta: '+12.4% vs last month', up: true, color: 'blue', query: 'Total sales invoice value this month?' },
  { label: 'Net Profit (This Week)', value: '₹38.7 L', delta: '+7.1% vs last week', up: true, color: 'teal', query: 'What is the net profit for this week?' },
  { label: 'Open Invoices (Pending)', value: '142', delta: '18 overdue >30 days', up: false, color: 'gold', query: 'How many open invoices are pending?' },
  { label: 'Collection Efficiency', value: '87.3%', delta: '+3.2% this month', up: true, color: 'green', query: 'What is the collection efficiency this month?' },
];

const CFO_QUERIES = [
  { icon: '📅', label: "Yesterday's Sales", query: "Yesterday ki total sales kitni thi?" },
  { icon: '💰', label: "This Week Profit",  query: "Is week ka total profit breakdown karo" },
  { icon: '⚠️', label: "Overdue Invoices",  query: "Top 5 overdue invoices and recommended action" },
  { icon: '🔮', label: "30-Day Forecast",   query: "Cash flow forecast for next 30 days" },
  { icon: '📊', label: "Budget vs Actual",  query: "Compare actual vs budget — where are the biggest variances?" },
  { icon: '👥', label: "DSO by Customer",   query: "Which customers have highest outstanding DSO?" },
  { icon: '📈', label: "EBITDA Comparison", query: "EBITDA this quarter vs last quarter" },
  { icon: '🔍', label: "ACDOCA Anomalies",  query: "Any anomalies or unusual transactions this week in ACDOCA?" },
];

const CHAT_QUICK_QUERIES = [
  { label: "📅 Yesterday's Sales", query: "Yesterday ki total sales kitni thi?" },
  { label: "💰 This Week Profit",  query: "Is week ka total profit breakdown karo" },
  { label: "👥 Top Debtors",       query: "Top 5 customers by outstanding amount" },
  { label: "📊 EBITDA Summary",    query: "EBITDA this quarter vs last — CFO ke liye summary" },
  { label: "⚠️ Overdue List",      query: "Kaunse invoices 30 din se zyada overdue hain?" },
  { label: "🔮 Cash Forecast",     query: "Next month cash flow forecast karo" },
];

const SAP_CONTEXT = `Company Code: 1000, Fiscal Year: 2025, Currency: INR
[SAP S/4HANA Mock Data] Sales Invoices April 2025:
- Total Invoices: 481 | Cleared: 253 | Open: 142 | Pending: 57 | Overdue: 29
- Total Billed: ₹4.82 Cr | Collected: ₹3.87 Cr | Outstanding: ₹95 L
- Yesterday (30-Apr-2025) Sales: ₹78.4 L across 12 invoices
- Yesterday Top Customer: Tata Motors Ltd ₹24.5 L
- This Week (28 Apr – 2 May) Total Revenue: ₹5.44 Cr
- This Week Net Profit: ₹38.7 L (margin: 7.1%)
- EBITDA This Quarter: ₹1.24 Cr vs Last Quarter: ₹1.09 Cr (+13.7%)
- ACDOCA: Last 7 days — 1,247 line items, 3 anomalies: duplicate vendor payment ₹4.2L (27-Apr), GL suspense posting ₹89L, FX variance −₹1.8L
- Overdue >30 days: L&T Construction ₹32.1L (16d), HCL Tech ₹6.8L (21d), Bharat Forge ₹9.4L (34d)
- Cash Forecast (30 days): Inflows ₹1.8 Cr, Outflows ₹1.4 Cr, Net +₹40 L
- Budget vs Actual: Revenue +4% ✓, OpEx −1.8% ✓, CAPEX +12% ⚠
- Top DSO: L&T 45d, Bharat Forge 38d, ONGC 32d, SAIL 29d, BEML 27d
- GST Liability: ₹86.4L (CGST ₹43.2L, SGST ₹43.2L)`;

function getMockResponse(query) {
  const q = query.toLowerCase();
  if (q.includes('yesterday') && q.includes('sales'))
    return `📅 **Yesterday's Sales (30 Apr 2025)**\n\nOData: \`API_BILLING_DOCUMENT_SRV\`\n\n• **Total Revenue:** ₹78.4 L across **12 invoices**\n• **Top Customer:** Tata Motors Ltd — ₹24.5 L ✅ Cleared\n• **Pending:** Infosys BPO ₹9.2 L (awaiting approval)\n• **GST Collected:** ₹14.1 L\n\n💡 *CFO Note:* Yesterday 4% above daily target of ₹75 L. Collection rate 83.3%.`;
  if (q.includes('week') && (q.includes('profit') || q.includes('revenue')))
    return `💰 **This Week's Summary (28 Apr – 2 May 2025)**\n\nSource: \`ACDOCA + BKPF\`\n\n• **Total Revenue:** ₹5.44 Cr\n• **Net Profit:** ₹38.7 L **(7.12% margin)**\n• **Best Day:** Wednesday ₹1.2 Cr\n• **COGS:** ₹4.12 Cr | **OpEx:** ₹93.3 L\n\n📊 WoW: Revenue +8.2%, Profit +7.1%\n\n💡 Margin improvement possible by reducing logistics OpEx (12% above budget).`;
  if (q.includes('overdue') || q.includes('pending'))
    return `⚠️ **Overdue Invoices (>30 days)**\n\nSource: \`FI_AR_4 OData + BSEG\`\n\n• L&T Construction — ₹32.1 L — 16 days\n• HCL Technologies — ₹6.8 L — 21 days\n• Bharat Forge — ₹9.4 L — 34 days ⚠️\n\n**Total Overdue: ₹48.3 L**\n\n💡 Bharat Forge (34 days) — escalate to collections immediately. Send dunning via SAP AR.`;
  if (q.includes('ebitda') || q.includes('quarter'))
    return `📈 **EBITDA Comparison**\n\nSource: \`ACDOCA + Profit Center Accounting\`\n\n• **Q1 2025:** ₹1.24 Cr\n• **Q4 2024:** ₹1.09 Cr\n• **Growth:** +**13.7%** QoQ ✅\n• EBITDA Margin: **22.8%** (industry avg 19.5%)\n\n💡 IT division drove +31% growth. Manufacturing margins compressed — review CAPEX (112% of budget).`;
  if (q.includes('acdoca') || q.includes('anomal'))
    return `🔍 **ACDOCA Anomaly Detection**\n\nScanned **1,247 line items** (last 7 days).\n\n⚠️ **3 Anomalies:**\n1. **Duplicate Vendor Payment** — 27 Apr — ₹4.2 L (ADITYA BIRLA) — 2 postings same day\n2. **GL Suspense Posting** — 29 Apr — ₹89 L to CC 9999 without clearance\n3. **FX Rate Variance** — USD invoice at stale rate (−₹1.8 L impact)\n\n💡 Reverse duplicate doc. Investigate CC 9999 posting immediately.`;
  if (q.includes('cash') || q.includes('forecast'))
    return `🔮 **30-Day Cash Flow Forecast**\n\nSource: \`SAP Cash Management\`\n\n• **Inflows:** ₹1.8 Cr (AR due ₹1.42 Cr + pipeline ₹38 L)\n• **Outflows:** ₹1.4 Cr (Vendor ₹95 L + Salary/OpEx ₹45 L)\n• **Net Position: +₹40 L** ✅\n\n💡 Risk: If L&T collection (₹32.1 L) delayed → net drops to +₹7.9 L. Proactive follow-up recommended.`;
  if (q.includes('dso') || q.includes('debtor') || q.includes('customer'))
    return `👥 **Top Debtors by DSO**\n\nSource: \`FI-AR OData · BSID\`\n\n• L&T Construction — ₹32.1 L — **45 days**\n• Bharat Forge — ₹9.4 L — **38 days**\n• ONGC — ₹7.8 L — **32 days**\n• SAIL — ₹5.6 L — 29 days\n• BEML — ₹4.2 L — 27 days\n\n**Avg DSO: 34.2 days** (target 30 days)\n\n💡 Activate SAP Collections Management for top 3.`;
  if (q.includes('budget'))
    return `📊 **Budget vs Actual — April 2025**\n\nSource: \`CO-PA + ACDOCA\`\n\n• Revenue: ₹4.82 Cr vs ₹4.64 Cr budget — **+4% ✅**\n• OpEx: ₹93.3 L vs ₹95 L — **−1.8% ✅**\n• CAPEX: ₹20.2 L vs ₹18 L — **+12% ⚠️**\n• Headcount: ₹41.4 L vs ₹42 L — **−1.4% ✅**\n\n💡 CAPEX overspend on IT infra — review PO approvals > ₹5 L.`;
  return `🤖 **SAP FinanceAI**\n\nQuery received: "${query}"\n\nMain SAP OData APIs se data fetch karunga:\n• \`API_BILLING_DOCUMENT_SRV\` — Invoices\n• \`ACDOCA\` — Universal Journal\n• \`FI-AR/AP\` — Receivables & Payables\n\n*Live responses ke liye DeepSeek API key set karein \`SAP_CONFIG\` mein.*`;
}

// ── Hooks ──
// ── Hook: SAP OData fetch ──────────────────────────────────────────────────
function useSAPData() {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  const fetchEntity = useCallback(async (entity, filter = '') => {
    if (!SAP_CONFIG.useLiveData) return null;
    setLoading(true);
    try {
      const url = `${SAP_CONFIG.odataBaseUrl}/${entity}?$format=json${filter ? '&$filter=' + filter : ''}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: 'Basic ' + btoa(`${SAP_CONFIG.clientId}:${SAP_CONFIG.clientSecret}`),
          Accept: 'application/json',
        },
      });
      const data = await resp.json();
      return data.d?.results ?? data.value ?? null;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchEntity, loading, error };
}

// ── Hook: DeepSeek chat ───────────────────────────────────────────────────
function useDeepSeek() {
  const call = useCallback(async (userMsg, extraContext = '') => {
    const key = SAP_CONFIG.deepseekApiKey;
    if (!key || key === 'YOUR_DEEPSEEK_API_KEY') return null;
    const system = `You are SAP FinanceAI, an expert SAP S/4HANA financial analyst.
You have access to live SAP data via OData APIs and ACDOCA table.
Respond in Hinglish when the user writes in Hindi/Hinglish, otherwise English.
Always cite the SAP data source (OData entity / table name).
Be concise, actionable and CFO-friendly.
Current SAP Context:\n${SAP_CONTEXT}\n${extraContext}`;
    try {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: SAP_CONFIG.deepseekModel,
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
          max_tokens: 600,
          temperature: 0.3,
        }),
      });
      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch {
      return null;
    }
  }, []);
  return { call };
}

// ── Hook: Claude (Anthropic) ──────────────────────────────────────────────
function useClaude() {
  const call = useCallback(async (userMsg) => {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `You are SAP FinanceAI, an expert SAP S/4HANA financial analyst. Respond in Hinglish when appropriate. Be concise. Context:\n${SAP_CONTEXT}`,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
      const data = await resp.json();
      return data.content?.[0]?.text ?? null;
    } catch {
      return null;
    }
  }, []);
  return { call };
}

// ── Master chat hook ──────────────────────────────────────────────────────
function useSAPChat(model = 'deepseek') {
  const [messages, setMessages] = useState([
    {
      role: 'ai', id: 1,
      text: `Namaste! 🙏 Main hoon **SAP FinanceAI** — aapka intelligent finance assistant.\n\nMain SAP S/4HANA ke OData APIs aur ACDOCA table se live data fetch karke aapke har financial question ka jawab de sakta hoon.\n\nCFO decisions, invoice analysis, profit trends — bas poochho!`,
      sources: ['odata', 'hana', 'deepseek'],
    },
  ]);
  const [thinking, setThinking] = useState(false);
  const deepseek = useDeepSeek();
  const claude   = useClaude();

  const send = useCallback(async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user', id: Date.now(), text };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    let reply = model === 'deepseek'
      ? await deepseek.call(text)
      : await claude.call(text);

    if (!reply) reply = getMockResponse(text);

    setThinking(false);
    setMessages(prev => [...prev, {
      role: 'ai', id: Date.now() + 1, text: reply,
      sources: ['odata', 'hana', model],
      model,
    }]);
  }, [model, deepseek, claude]);

  return { messages, thinking, send };
}

// ── TopBar ──
const NAV_ITEMS = ['Finance', 'Sales & Revenue', 'Procurement', 'CFO View', 'Reports'];

function TopBar({ activeNav, setActiveNav }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: 52, background: '#32363A',
      flexShrink: 0, zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            background: '#0070F2', color: 'white', fontSize: 11, fontWeight: 600,
            padding: '3px 8px', borderRadius: 4, letterSpacing: '0.05em',
          }}>SAP</div>
          <div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: 'white', letterSpacing: '0.02em' }}>
              FinanceAI
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
              S/4HANA Intelligence Suite
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', gap: 2 }}>
        {NAV_ITEMS.map(item => (
          <button key={item} onClick={() => setActiveNav(item)} style={{
            padding: '6px 14px', borderRadius: 6,
            fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none',
            background: activeNav === item ? '#0070F2' : 'transparent',
            color: activeNav === item ? 'white' : 'rgba(255,255,255,0.6)',
            fontFamily: "'IBM Plex Sans', sans-serif",
            transition: 'all 0.15s',
          }}>
            {item}
          </button>
        ))}
      </nav>

      {/* Right: Badges + User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ConnBadge color="#0EBFA1" label="SAP S/4HANA Connected" />
        <ConnBadge color="#7C3AED" label="DeepSeek Ready" />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 10px 4px 4px', borderRadius: 20,
          background: 'rgba(255,255,255,0.1)', cursor: 'pointer',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', background: '#0070F2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, color: 'white',
          }}>SA</div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Shah Azim</span>
        </div>
      </div>
    </header>
  );
}

function ConnBadge({ color, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      background: color + '22', color, border: `0.5px solid ${color}55`,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        animation: 'pulse 2s infinite',
      }} />
      {label}
    </div>
  );
}

// ── Sidebar ──
const SECTIONS = [
  {
    label: 'Finance',
    items: [
      { icon: '📊', label: 'Overview', badge: null },
      { icon: '🧾', label: 'Sales Invoices', badge: 4 },
      { icon: '💳', label: 'Accounts Payable', badge: null },
      { icon: '📥', label: 'Accounts Receivable', badge: null },
      { icon: '📈', label: 'Profit & Loss', badge: null },
    ],
  },
  {
    label: 'Operations',
    items: [
      { icon: '🏭', label: 'Cost Centers', badge: null },
      { icon: '📦', label: 'Purchase Orders', badge: null },
      { icon: '🔄', label: 'GR/GI Postings', badge: null },
      { icon: '💰', label: 'Budget vs Actual', badge: null },
    ],
  },
  {
    label: 'CFO Tools',
    items: [
      { icon: '🎯', label: 'KPI Targets', badge: null },
      { icon: '⚠️', label: 'Risk Alerts', badge: 3 },
      { icon: '🤖', label: 'AI Insights', badge: null },
    ],
  },
  {
    label: 'Config',
    items: [
      { icon: '🔗', label: 'OData APIs', badge: null },
      { icon: '🔑', label: 'API Keys', badge: null },
    ],
  },
];

function Sidebar({ onAskChat }) {
  const [active, setActive] = useState('Overview');

  return (
    <aside style={{
      background: '#fff', borderRight: '1px solid #E0E0E0',
      padding: '14px 8px', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {SECTIONS.map(sec => (
        <React.Fragment key={sec.label}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            color: '#6A6D70', padding: '10px 10px 4px', textTransform: 'uppercase',
          }}>{sec.label}</div>
          {sec.items.map(item => (
            <button
              key={item.label}
              onClick={() => setActive(item.label)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px', borderRadius: 6,
                fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                border: 'none', width: '100%', textAlign: 'left',
                background: active === item.label ? '#E8F2FF' : 'transparent',
                color: active === item.label ? '#0070F2' : '#6A6D70',
                fontFamily: "'IBM Plex Sans', sans-serif",
                transition: 'all 0.13s',
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: 5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12,
                background: active === item.label ? '#0070F2' : '#F5F6F7',
              }}>{item.icon}</div>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: '#BB0000', color: 'white', fontWeight: 700,
                }}>{item.badge}</span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </aside>
  );
}

// ── KPIGrid ──
const COLOR_MAP = {
  blue:  { accent: '#0070F2', light: '#E8F2FF' },
  teal:  { accent: '#0EBFA1', light: '#E0FAF5' },
  gold:  { accent: '#E8A000', light: '#FFF3CC' },
  green: { accent: '#188A2E', light: '#E8F5E9' },
};

function KPIGrid({ onAskChat }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
    }}>
      {KPI_DATA.map(kpi => {
        const c = COLOR_MAP[kpi.color];
        return (
          <div
            key={kpi.label}
            onClick={() => onAskChat(kpi.query)}
            style={{
              background: '#fff', border: '1px solid #E0E0E0',
              borderRadius: 10, padding: 16, position: 'relative',
              overflow: 'hidden', cursor: 'pointer',
              transition: 'box-shadow 0.15s, transform 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* bottom accent bar */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: 3, background: c.accent,
            }} />
            <div style={{
              fontSize: 11, fontWeight: 600, color: '#6A6D70',
              letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
            }}>{kpi.label}</div>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 24, fontWeight: 500, lineHeight: 1,
              color: c.accent, marginBottom: 6,
            }}>{kpi.value}</div>
            <div style={{
              fontSize: 11.5, fontWeight: 500, display: 'flex',
              alignItems: 'center', gap: 4,
              color: kpi.up ? '#188A2E' : '#BB0000',
            }}>
              {kpi.up ? '▲' : '▼'} {kpi.delta}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Dashboard Widgets ──
// ── CFO Quick Decisions ───────────────────────────────────────────────────
function CFOPanel({ onAskChat }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E0E0E0', borderRadius: 10,
      padding: '14px 18px',
    }}>
      <div style={{
        fontSize: 13.5, fontWeight: 600, color: '#32363A',
        display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8A000' }} />
        CFO Quick Decisions
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {CFO_QUERIES.map(q => (
          <button
            key={q.label}
            onClick={() => onAskChat(q.query)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 20, fontSize: 11.5,
              fontWeight: 500, cursor: 'pointer',
              border: '1px solid #E0E0E0', background: '#fff', color: '#32363A',
              fontFamily: "'IBM Plex Sans', sans-serif", transition: 'all 0.13s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#E8F2FF';
              e.currentTarget.style.borderColor = '#0070F2';
              e.currentTarget.style.color = '#0070F2';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.borderColor = '#E0E0E0';
              e.currentTarget.style.color = '#32363A';
            }}
          >
            <span style={{ fontSize: 13 }}>{q.icon}</span>
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Revenue Bar Chart ─────────────────────────────────────────────────────
function RevenueChart({ onAskChat }) {
  const max = Math.max(...MOCK_WEEKLY_REVENUE.map(d => d.value));
  return (
    <div style={{
      background: '#fff', border: '1px solid #E0E0E0', borderRadius: 10, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#32363A', display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0070F2' }} />
          Daily Revenue (This Week)
        </div>
        <span
          onClick={() => onAskChat('Explain this week daily revenue trend and reasons')}
          style={{ fontSize: 11.5, color: '#0070F2', cursor: 'pointer', fontWeight: 500 }}
        >Ask AI ↗</span>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, marginBottom: 12 }}>
        {MOCK_WEEKLY_REVENUE.map(d => {
          const pct = (d.value / max) * 100;
          const isMax = d.value === max;
          const isMin = d.value === Math.min(...MOCK_WEEKLY_REVENUE.map(x => x.value));
          const bg = isMax ? '#0070F2' : isMin ? '#6A6D70' : '#0EBFA1';
          return (
            <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{
                width: '100%', borderRadius: '3px 3px 0 0',
                background: bg, height: `${pct}%`, minHeight: 4,
                transition: 'height 0.8s ease',
              }} />
              <div style={{ fontSize: 9, color: '#6A6D70', fontFamily: "'IBM Plex Mono', monospace" }}>{d.day}</div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 18 }}>
        {[
          { lbl: 'PEAK DAY', val: 'Wed ₹1.2 Cr', color: '#0070F2' },
          { lbl: 'LOWEST DAY', val: 'Sun ₹30 L', color: '#BB0000' },
          { lbl: 'WEEKLY TOTAL', val: '₹5.44 Cr', color: '#188A2E' },
        ].map(s => (
          <div key={s.lbl}>
            <div style={{ fontSize: 10, color: '#6A6D70', marginBottom: 2 }}>{s.lbl}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Invoice Status Donut ──────────────────────────────────────────────────
function DonutChart({ onAskChat }) {
  const total = MOCK_INVOICE_STATUS.reduce((s, d) => s + d.count, 0);
  let offset = 0;
  const R = 38, CIRC = 2 * Math.PI * R;

  return (
    <div style={{
      background: '#fff', border: '1px solid #E0E0E0', borderRadius: 10, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#32363A', display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0EBFA1' }} />
          Invoice Status Distribution
        </div>
        <span
          onClick={() => onAskChat('What should I do about pending and overdue invoices?')}
          style={{ fontSize: 11.5, color: '#0070F2', cursor: 'pointer', fontWeight: 500 }}
        >Ask AI ↗</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="110" height="110" viewBox="0 0 110 110" style={{ flexShrink: 0 }}>
          <circle cx="55" cy="55" r={R} fill="none" stroke="#E0E0E0" strokeWidth="16" />
          {MOCK_INVOICE_STATUS.map(seg => {
            const dash = (seg.pct / 100) * CIRC;
            const gap  = CIRC - dash;
            const el = (
              <circle
                key={seg.label}
                cx="55" cy="55" r={R}
                fill="none" stroke={seg.color} strokeWidth="16"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 55 55)"
              />
            );
            offset += dash;
            return el;
          })}
          <text x="55" y="51" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="14" fontWeight="500" fill="#32363A">{total}</text>
          <text x="55" y="64" textAnchor="middle" fontFamily="IBM Plex Sans" fontSize="9" fill="#6A6D70">invoices</text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {MOCK_INVOICE_STATUS.map(seg => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{seg.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6A6D70', marginLeft: 10 }}>
                {seg.count} ({seg.pct}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Invoice Table ──
const STATUS_STYLE = {
  Cleared: { background: '#E8F5E9', color: '#188A2E' },
  Open:    { background: '#E8F2FF', color: '#0070F2' },
  Pending: { background: '#FFF3CC', color: '#9A6500' },
  Overdue: { background: '#FFEDED', color: '#BB0000' },
};

const fmt = (n) => '₹' + (n / 100000).toFixed(1) + 'L';

function InvoiceTable({ onAskChat }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E0E0E0', borderRadius: 10, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#32363A', display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0070F2' }} />
          Recent Sales Invoices
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 8, marginLeft: 4,
            background: '#F5F6F7', color: '#6A6D70', fontWeight: 600,
          }}>BKPF / BSEG · SAP S/4HANA</span>
        </div>
        <span
          onClick={() => onAskChat('Show all overdue invoices and suggest collection strategy')}
          style={{ fontSize: 11.5, color: '#0070F2', cursor: 'pointer', fontWeight: 500 }}
        >Ask AI ↗</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Invoice No.', 'Customer', 'Doc Date', 'Due Date', 'Amount', 'GST', 'Net', 'Status', 'Co.Code'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', fontSize: 10.5, fontWeight: 600,
                  letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: '#6A6D70', padding: '6px 10px',
                  borderBottom: '1px solid #E0E0E0', background: '#F5F6F7',
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_INVOICES.map((inv, i) => (
              <tr
                key={inv.id}
                style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#E8F2FF'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => onAskChat(`Invoice ${inv.id} ke baare mein details do — customer ${inv.customer}`)}
              >
                <td style={tdStyle}>{inv.id}</td>
                <td style={{ ...tdStyle, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 500 }}>{inv.customer}</td>
                <td style={tdStyle}>{inv.docDate}</td>
                <td style={{ ...tdStyle, color: inv.status === 'Overdue' ? '#BB0000' : '#32363A' }}>{inv.dueDate}</td>
                <td style={tdStyle}>{fmt(inv.amount)}</td>
                <td style={{ ...tdStyle, color: '#6A6D70' }}>{fmt(inv.tax)}</td>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(inv.net)}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 10,
                    fontSize: 10.5, fontWeight: 600,
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    ...STATUS_STYLE[inv.status],
                  }}>● {inv.status}</span>
                </td>
                <td style={tdStyle}>{inv.companyCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tdStyle = {
  padding: '9px 10px',
  borderBottom: '0.5px solid #E0E0E0',
  color: '#32363A',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 12,
};

// ── Chat Panel ──
const SOURCE_STYLE = {
  odata:    { bg: '#E8F5FF', color: '#0057A8', label: '⚡ OData' },
  hana:     { bg: '#FFF3E0', color: '#A05A00', label: '🗄 ACDOCA' },
  deepseek: { bg: '#EDE7F6', color: '#5E35B1', label: '🤖 DeepSeek' },
  claude:   { bg: '#E8F2FF', color: '#0057A8', label: '🤖 Claude' },
};

const DS_PILLS = ['SAP OData', 'HANA DB', 'ACDOCA', 'BTP AI Core'];

function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i}>{p}</strong> : p
  );
}

function renderText(text) {
  return text.split('\n').map((line, i) => {
    const codeInline = line.split(/`([^`]+)`/g);
    const formatted = codeInline.map((seg, j) =>
      j % 2 === 1
        ? <code key={j} style={{ fontFamily: "'IBM Plex Mono',monospace", background: '#F5F6F7', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{seg}</code>
        : parseBold(seg)
    );
    return <span key={i}>{formatted}{i < text.split('\n').length - 1 && <br />}</span>;
  });
}

function ChatPanel({ model, setModel, onSend, messages, thinking, externalQuery, onExternalQueryConsumed }) {
  const [input, setInput] = useState('');
  const [activeSources, setActiveSources] = useState({ 'SAP OData': true, 'HANA DB': true, 'ACDOCA': true, 'BTP AI Core': false });
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // Consume external query (from dashboard click)
  useEffect(() => {
    if (externalQuery) {
      onSend(externalQuery);
      onExternalQueryConsumed();
    }
  }, [externalQuery]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    textareaRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <aside style={{
      background: '#fff', borderLeft: '1px solid #E0E0E0',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #E0E0E0', flexShrink: 0, background: '#32363A' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #0070F2, #0EBFA1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>🤖</div>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'white' }}>SAP FinanceAI</span>
          </div>
          {/* Model toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {['deepseek', 'claude'].map(m => (
              <button key={m} onClick={() => setModel(m)} style={{
                padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif",
                border: '1px solid rgba(255,255,255,0.2)',
                background: model === m ? '#0070F2' : 'transparent',
                color: model === m ? 'white' : 'rgba(255,255,255,0.55)',
                transition: 'all 0.13s',
                textTransform: 'capitalize',
              }}>{m === 'deepseek' ? 'DeepSeek' : 'Claude'}</button>
            ))}
          </div>
        </div>

        {/* Data source pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DS_PILLS.map(pill => {
            const on = activeSources[pill];
            return (
              <button key={pill}
                onClick={() => setActiveSources(prev => ({ ...prev, [pill]: !prev[pill] }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 9px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif",
                  border: '1px solid',
                  borderColor: on ? 'rgba(14,191,161,0.5)' : 'rgba(255,255,255,0.15)',
                  background: on ? 'rgba(14,191,161,0.2)' : 'transparent',
                  color: on ? '#0EBFA1' : 'rgba(255,255,255,0.55)',
                  transition: 'all 0.13s',
                }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                {pill}
              </button>
            );
          })}
        </div>
      </div>

      {/* Config notice */}
      <div style={{
        margin: '8px 14px 0', padding: '7px 12px',
        background: '#FFF3CC', border: '1px solid rgba(232,160,0,0.35)',
        borderRadius: 6, fontSize: 11, color: '#7A5500', lineHeight: 1.5,
      }}>
        <strong>Integration:</strong> Set <code style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>SAP_CONFIG.deepseekApiKey</code> &amp; <code style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>odataBaseUrl</code> for live data. Demo mode active.
      </div>

      {/* ── Messages ── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 14,
        display: 'flex', flexDirection: 'column', gap: 12,
        background: '#F0F2F5',
      }}>
        {messages.map(msg => (
          <Message key={msg.id} msg={msg} />
        ))}
        {thinking && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick queries ── */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #E0E0E0', background: '#F5F6F7', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6A6D70', marginBottom: 7, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          Frequent Queries
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {CHAT_QUICK_QUERIES.map(q => (
            <button key={q.label}
              onClick={() => onSend(q.query)}
              style={{
                padding: '4px 10px', borderRadius: 14, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', border: '1px solid #E0E0E0', background: '#fff',
                color: '#32363A', fontFamily: "'IBM Plex Sans', sans-serif", transition: 'all 0.13s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#0070F2'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#0070F2'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#32363A'; e.currentTarget.style.borderColor = '#E0E0E0'; }}
            >{q.label}</button>
          ))}
        </div>
      </div>

      {/* ── Input ── */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #E0E0E0', background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder="SAP ke baare mein poochho… e.g. Yesterday's revenue, overdue invoices"
            style={{
              flex: 1, padding: '9px 13px', borderRadius: 10,
              border: '1px solid #E0E0E0', background: '#F5F6F7',
              color: '#32363A', fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif",
              resize: 'none', outline: 'none', lineHeight: 1.5,
              minHeight: 38, maxHeight: 100, transition: 'border-color 0.13s',
            }}
            onFocus={e => e.target.style.borderColor = '#0070F2'}
            onBlur={e => e.target.style.borderColor = '#E0E0E0'}
          />
          <button onClick={handleSend} style={{
            width: 38, height: 38, borderRadius: 10, background: '#0070F2',
            border: 'none', cursor: 'pointer', fontSize: 16, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.13s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#0040B0'}
            onMouseLeave={e => e.currentTarget.style.background = '#0070F2'}
          >↑</button>
        </div>
        <div style={{ fontSize: 10.5, color: '#6A6D70', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          {['⚡ OData', '🗄 ACDOCA', '🤖 ' + (model === 'deepseek' ? 'DeepSeek' : 'Claude')].map(s => (
            <span key={s} style={{ padding: '1px 7px', borderRadius: 8, background: '#F5F6F7', fontSize: 9.5, fontWeight: 600, color: '#6A6D70' }}>{s}</span>
          ))}
          <span style={{ marginLeft: 4 }}>Enter to send · Shift+Enter new line</span>
        </div>
      </div>
    </aside>
  );
}

function Message({ msg }) {
  const isAI = msg.role === 'ai';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: isAI ? 'row' : 'row-reverse' }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: 'white',
        background: isAI ? 'linear-gradient(135deg, #0070F2, #0EBFA1)' : '#32363A',
      }}>{isAI ? 'AI' : 'SA'}</div>

      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {isAI && (
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6A6D70' }}>
            FinanceAI · {msg.model === 'claude' ? 'Claude' : 'DeepSeek'}
          </div>
        )}

        <div style={{
          padding: '10px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.55,
          ...(isAI
            ? { background: '#fff', border: '1px solid #E0E0E0', borderTopLeftRadius: 3, color: '#32363A' }
            : { background: '#0070F2', color: 'white', borderTopRightRadius: 3 }
          ),
        }}>
          {renderText(msg.text)}
        </div>

        {isAI && msg.sources && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {msg.sources.map(s => {
              const st = SOURCE_STYLE[s];
              if (!st) return null;
              return (
                <span key={s} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 7px', borderRadius: 8, fontSize: 9.5, fontWeight: 600,
                  background: st.bg, color: st.color,
                }}>{st.label}</span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: 'white',
        background: 'linear-gradient(135deg, #0070F2, #0EBFA1)',
      }}>AI</div>
      <div style={{
        padding: '12px 16px', borderRadius: 10, borderTopLeftRadius: 3,
        background: '#fff', border: '1px solid #E0E0E0',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {['#0070F2', '#0EBFA1', '#E8A000'].map((c, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%', background: c,
            animation: `thinkpulse 1.2s ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── App ──
function App() {
  const [activeNav, setActiveNav] = useState("Finance");
  const [model, setModel]         = useState("deepseek");
  const [externalQuery, setExternalQuery] = useState(null);

  const { messages, thinking, send } = useSAPChat(model);

  const askChat = (query) => setExternalQuery(query);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", overflow: "hidden",
      fontFamily: "'IBM Plex Sans', sans-serif",
      color: "#32363A",
    }}>
      {/* ── Global keyframes injected once ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; overflow: hidden; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #C0C0C0; border-radius: 3px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes thinkpulse {
          0%,80%,100%{opacity:0.15; transform:scale(0.8)}
          40%{opacity:1; transform:scale(1)}
        }
      `}</style>

      {/* Top bar */}
      <TopBar activeNav={activeNav} setActiveNav={setActiveNav} />

      {/* Main 3-column layout */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr 340px",
        flex: 1,
        overflow: "hidden",
      }}>
        {/* Sidebar */}
        <Sidebar onAskChat={askChat} />

        {/* Dashboard content */}
        <main style={{
          background: "#F0F2F5",
          overflowY: "auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}>
          {/* Page header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <h1 style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 22, fontWeight: 600, color: "#32363A", lineHeight: 1.2,
              }}>Finance Overview</h1>
              <p style={{ fontSize: 12.5, color: "#6A6D70", marginTop: 3 }}>
                Fiscal Year 2025 · Company Code: 1000 · Live from SAP S/4HANA via OData
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { label: "↓ Export", primary: false },
                { label: "⟳ Refresh", primary: false },
                { label: "+ New Invoice", primary: true },
              ].map(b => (
                <button key={b.label} style={{
                  padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 500,
                  cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif",
                  border: b.primary ? "1px solid #0070F2" : "1px solid #E0E0E0",
                  background: b.primary ? "#0070F2" : "#fff",
                  color: b.primary ? "white" : "#32363A",
                  transition: "all 0.13s",
                }}
                  onMouseEnter={e => { if (!b.primary) e.currentTarget.style.background = "#F5F6F7"; }}
                  onMouseLeave={e => { if (!b.primary) e.currentTarget.style.background = "#fff"; }}
                >{b.label}</button>
              ))}
            </div>
          </div>

          {/* KPI Cards */}
          <KPIGrid onAskChat={askChat} />

          {/* CFO Quick Panel */}
          <CFOPanel onAskChat={askChat} />

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <RevenueChart onAskChat={askChat} />
            <DonutChart onAskChat={askChat} />
          </div>

          {/* Invoice Table */}
          <InvoiceTable onAskChat={askChat} />

          {/* Bottom padding */}
          <div style={{ height: 8 }} />
        </main>

        {/* AI Chat Panel */}
        <ChatPanel
          model={model}
          setModel={setModel}
          messages={messages}
          thinking={thinking}
          onSend={send}
          externalQuery={externalQuery}
          onExternalQueryConsumed={() => setExternalQuery(null)}
        />
      </div>
    </div>
  );
}
