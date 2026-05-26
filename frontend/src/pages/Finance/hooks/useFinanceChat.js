// ============================================================
// FILE: frontend/src/pages/Finance/hooks/useFinanceChat.js
// PURPOSE: Finance chat hook — currently mock, will connect to
//          /api/finance/query backend endpoint in Phase 2
// ============================================================

import { useState, useCallback } from 'react';

const SAP_CONTEXT = `Company Code: 1000, Fiscal Year: 2025, Currency: INR
[SAP S/4HANA Mock Data] Sales Invoices April 2025:
- Total Invoices: 481 | Cleared: 253 | Open: 142 | Pending: 57 | Overdue: 29
- Total Billed: ₹4.82 Cr | Collected: ₹3.87 Cr | Outstanding: ₹95 L
- Yesterday (30-Apr-2025) Sales: ₹78.4 L across 12 invoices
- Yesterday Top Customer: Tata Motors Ltd ₹24.5 L
- This Week (28 Apr – 2 May) Total Revenue: ₹5.44 Cr
- This Week Net Profit: ₹38.7 L (margin: 7.1%)
- EBITDA This Quarter: ₹1.24 Cr vs Last Quarter: ₹1.09 Cr (+13.7%)
- ACDOCA: Last 7 days — 1,247 line items, 3 anomalies
- Overdue >30 days: L&T Construction ₹32.1L (16d), HCL Tech ₹6.8L (21d), Bharat Forge ₹9.4L (34d)
- Cash Forecast (30 days): Inflows ₹1.8 Cr, Outflows ₹1.4 Cr, Net +₹40 L
- Budget vs Actual: Revenue +4%, OpEx -1.8%, CAPEX +12%
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
  return `🤖 **SAP FinanceAI**\n\nQuery received: "${query}"\n\nMain SAP OData APIs se data fetch karunga:\n• \`API_BILLING_DOCUMENT_SRV\` — Invoices\n• \`ACDOCA\` — Universal Journal\n• \`FI-AR/AP\` — Receivables & Payables\n\n*Live responses ke liye backend /api/finance/query endpoint integrate karein.*`;
}

const useFinanceChat = () => {
  const [messages, setMessages] = useState([
    {
      role: 'ai', id: 1,
      text: `Namaste! 🙏 Main hoon **SAP FinanceAI** — aapka intelligent finance assistant.\n\nMain SAP S/4HANA ke OData APIs aur ACDOCA table se live data fetch karke aapke har financial question ka jawab de sakta hoon.\n\nCFO decisions, invoice analysis, profit trends — bas poochho!`,
      sources: ['odata', 'hana', 'mock'],
    },
  ]);
  const [thinking, setThinking] = useState(false);

  const send = useCallback(async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user', id: Date.now(), text };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    // TODO Phase 2: Replace with backend /api/finance/query call
    await new Promise(r => setTimeout(r, 800));
    const reply = getMockResponse(text);

    setThinking(false);
    setMessages(prev => [...prev, {
      role: 'ai', id: Date.now() + 1, text: reply,
      sources: ['odata', 'hana', 'mock'],
    }]);
  }, []);

  return { messages, thinking, send };
};

export default useFinanceChat;
