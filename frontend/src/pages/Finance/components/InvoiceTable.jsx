// ============================================================
// FILE: frontend/src/pages/Finance/components/InvoiceTable.jsx
// PURPOSE: Recent sales invoices table widget
// ============================================================

import React from 'react';

const MOCK_INVOICES = [
  { id: '9100048291', customer: 'Tata Motors Ltd', docDate: '29-Apr-25', dueDate: '29-May-25', amount: 2450000, tax: 441000, net: 2009000, status: 'Cleared', companyCode: '1000' },
  { id: '9100048290', customer: 'Reliance Industries', docDate: '28-Apr-25', dueDate: '28-May-25', amount: 1875000, tax: 337500, net: 1537500, status: 'Open', companyCode: '1000' },
  { id: '9100048285', customer: 'Infosys BPO', docDate: '25-Apr-25', dueDate: '25-May-25', amount: 920000, tax: 165600, net: 754400, status: 'Pending', companyCode: '2000' },
  { id: '9100048271', customer: 'L&T Construction', docDate: '15-Apr-25', dueDate: '15-Apr-25', amount: 3210000, tax: 577800, net: 2632200, status: 'Overdue', companyCode: '1000' },
  { id: '9100048269', customer: 'Wipro Technologies', docDate: '14-Apr-25', dueDate: '14-May-25', amount: 1260000, tax: 226800, net: 1033200, status: 'Cleared', companyCode: '2000' },
  { id: '9100048255', customer: 'HCL Technologies', docDate: '10-Apr-25', dueDate: '10-Apr-25', amount: 680000, tax: 122400, net: 557600, status: 'Overdue', companyCode: '1000' },
];

const STATUS_STYLE = {
  Cleared: { background: '#E8F5E9', color: '#188A2E' },
  Open:    { background: '#E8F2FF', color: '#0070F2' },
  Pending: { background: '#FFF3CC', color: '#9A6500' },
  Overdue: { background: '#FFEDED', color: '#BB0000' },
};

const fmt = (n) => '₹' + (n / 100000).toFixed(1) + 'L';

const InvoiceTable = ({ onAskChat }) => {
  return (
    <div className="finance-card">
      <div className="finance-card-header">
        <div className="finance-card-title">
          <div className="finance-card-dot" style={{ background: '#0070F2' }} />
          Recent Sales Invoices
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, marginLeft: 4, background: 'var(--fin-bg-hover, #F5F6F7)', color: 'var(--fin-text-muted, #6A6D70)', fontWeight: 600 }}>
            BKPF / BSEG · SAP S/4HANA
          </span>
        </div>
        <span className="finance-ask-ai" onClick={() => onAskChat('Show all overdue invoices and suggest collection strategy')}>
          Ask AI ↗
        </span>
      </div>

      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              {['Invoice No.', 'Customer', 'Doc Date', 'Due Date', 'Amount', 'GST', 'Net', 'Status', 'Co.Code'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_INVOICES.map((inv) => (
              <tr key={inv.id} onClick={() => onAskChat(`Invoice ${inv.id} ke baare mein details do — customer ${inv.customer}`)}>
                <td>{inv.id}</td>
                <td style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 500 }}>{inv.customer}</td>
                <td>{inv.docDate}</td>
                <td style={{ color: inv.status === 'Overdue' ? '#BB0000' : 'var(--fin-text-primary, #32363A)' }}>{inv.dueDate}</td>
                <td>{fmt(inv.amount)}</td>
                <td style={{ color: 'var(--fin-text-muted, #6A6D70)' }}>{fmt(inv.tax)}</td>
                <td style={{ fontWeight: 500 }}>{fmt(inv.net)}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif", ...STATUS_STYLE[inv.status] }}>
                    ● {inv.status}
                  </span>
                </td>
                <td>{inv.companyCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InvoiceTable;
