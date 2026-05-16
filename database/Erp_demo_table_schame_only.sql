-- =====================================================
-- ERP_DB Schema for Supabase
-- Modules: FI, CO, MM, SD, PP, HR, CRM, SRM
-- =====================================================

-- =====================================================
-- 1. MASTER DATA TABLES (Common across modules)
-- =====================================================

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code VARCHAR(4) UNIQUE NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  country VARCHAR(3),
  currency VARCHAR(3),
  tax_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_code VARCHAR(4) UNIQUE NOT NULL,
  plant_name VARCHAR(255) NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  location VARCHAR(255),
  plant_type VARCHAR(50), -- Manufacturing, Distribution, Service
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE storage_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES plants(id),
  sloc_code VARCHAR(4) NOT NULL,
  sloc_name VARCHAR(255),
  warehouse_type VARCHAR(50),
  UNIQUE(plant_id, sloc_code),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  cost_center_code VARCHAR(10) UNIQUE NOT NULL,
  cost_center_name VARCHAR(255) NOT NULL,
  department VARCHAR(100),
  responsible_person VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 2. FI (FINANCIAL ACCOUNTING) MODULE
-- =====================================================

CREATE TABLE gl_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  account_number VARCHAR(10) UNIQUE NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50), -- Asset, Liability, Equity, Revenue, Expense
  account_group VARCHAR(50),
  currency VARCHAR(3),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  vendor_code VARCHAR(10) UNIQUE NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  vendor_type VARCHAR(50), -- Manufacturer, Distributor, Service Provider
  country VARCHAR(3),
  payment_terms VARCHAR(50),
  tax_id VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  customer_code VARCHAR(10) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_type VARCHAR(50), -- Retail, Wholesale, Corporate
  country VARCHAR(3),
  credit_limit DECIMAL(15, 2),
  payment_terms VARCHAR(50),
  tax_id VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  document_number VARCHAR(20) UNIQUE NOT NULL,
  posting_date DATE NOT NULL,
  document_date DATE NOT NULL,
  reference_document VARCHAR(255),
  document_type VARCHAR(20), -- JV, IV, etc.
  status VARCHAR(20), -- Draft, Posted, Reversed
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_entry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  gl_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  debit_amount DECIMAL(15, 2) DEFAULT 0,
  credit_amount DECIMAL(15, 2) DEFAULT 0,
  line_item_number INTEGER,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_number VARCHAR(20) UNIQUE NOT NULL,
  invoice_date DATE NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  customer_id UUID REFERENCES customers(id),
  invoice_type VARCHAR(20), -- Purchase, Sales
  amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3),
  status VARCHAR(20), -- Draft, Posted, Paid, Overdue
  due_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  gl_account_id UUID REFERENCES gl_accounts(id),
  quantity DECIMAL(13, 3),
  unit_price DECIMAL(13, 2),
  line_amount DECIMAL(15, 2),
  tax_amount DECIMAL(15, 2),
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_account_code VARCHAR(20) UNIQUE NOT NULL,
  bank_name VARCHAR(255),
  account_number VARCHAR(50),
  currency VARCHAR(3),
  balance DECIMAL(15, 2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 3. CO (CONTROLLING) MODULE
-- =====================================================

CREATE TABLE cost_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  cost_element_code VARCHAR(10) UNIQUE NOT NULL,
  cost_element_name VARCHAR(255) NOT NULL,
  cost_element_type VARCHAR(50), -- Primary, Secondary
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE internal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  order_number VARCHAR(20) UNIQUE NOT NULL,
  order_type VARCHAR(50), -- Maintenance, Investment, etc.
  description VARCHAR(255),
  cost_center_id UUID NOT NULL REFERENCES cost_centers(id),
  budget_amount DECIMAL(15, 2),
  actual_cost DECIMAL(15, 2) DEFAULT 0,
  status VARCHAR(20), -- Open, In Progress, Closed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cost_center_allocation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_cost_center_id UUID NOT NULL REFERENCES cost_centers(id),
  to_cost_center_id UUID NOT NULL REFERENCES cost_centers(id),
  allocation_percentage DECIMAL(5, 2),
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profit_center (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  prctr_code VARCHAR(10) UNIQUE NOT NULL,
  prctr_name VARCHAR(255) NOT NULL,
  responsible_person VARCHAR(255),
  currency VARCHAR(3),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 4. MM (MATERIALS MANAGEMENT) MODULE
-- =====================================================

CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code VARCHAR(40) UNIQUE NOT NULL,
  material_name VARCHAR(255) NOT NULL,
  material_type VARCHAR(50), -- Raw Material, Finished Good, Semi-Finished
  material_group VARCHAR(50),
  unit_of_measure VARCHAR(10), -- EA, KG, L, etc.
  standard_price DECIMAL(13, 2),
  currency VARCHAR(3),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE material_plant_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  reorder_point DECIMAL(13, 3),
  reorder_quantity DECIMAL(13, 3),
  safety_stock DECIMAL(13, 3),
  procurement_type VARCHAR(50), -- Buy, Make
  lead_time_days INTEGER,
  last_receipt_date DATE,
  UNIQUE(material_id, plant_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE material_storage_location (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  storage_location_id UUID NOT NULL REFERENCES storage_locations(id),
  quantity_on_hand DECIMAL(13, 3) DEFAULT 0,
  reserved_quantity DECIMAL(13, 3) DEFAULT 0,
  available_quantity DECIMAL(13, 3) GENERATED ALWAYS AS (quantity_on_hand - reserved_quantity) STORED,
  last_counted_date DATE,
  UNIQUE(material_id, storage_location_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  requisition_number VARCHAR(20) UNIQUE NOT NULL,
  requisition_date DATE NOT NULL,
  requested_by VARCHAR(255),
  status VARCHAR(20), -- Draft, Submitted, Approved, Rejected
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_requisition_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity DECIMAL(13, 3) NOT NULL,
  unit_price DECIMAL(13, 2),
  delivery_date DATE,
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  po_number VARCHAR(20) UNIQUE NOT NULL,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  po_date DATE NOT NULL,
  delivery_date DATE,
  total_amount DECIMAL(15, 2),
  currency VARCHAR(3),
  status VARCHAR(20), -- Draft, Released, Partially Received, Completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity_ordered DECIMAL(13, 3) NOT NULL,
  quantity_received DECIMAL(13, 3) DEFAULT 0,
  unit_price DECIMAL(13, 2) NOT NULL,
  line_amount DECIMAL(15, 2),
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  gr_number VARCHAR(20) UNIQUE NOT NULL,
  gr_date DATE NOT NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  status VARCHAR(20), -- Draft, Posted
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  storage_location_id UUID NOT NULL REFERENCES storage_locations(id),
  quantity DECIMAL(13, 3) NOT NULL,
  batch_number VARCHAR(50),
  expiry_date DATE,
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  from_storage_location_id UUID REFERENCES storage_locations(id),
  to_storage_location_id UUID REFERENCES storage_locations(id),
  movement_type VARCHAR(50), -- Receipt, Issue, Transfer
  quantity DECIMAL(13, 3),
  movement_date DATE NOT NULL,
  document_number VARCHAR(30),
  reference_doc VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 5. SD (SALES & DISTRIBUTION) MODULE
-- =====================================================

CREATE TABLE sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  sales_order_number VARCHAR(20) UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  so_date DATE NOT NULL,
  requested_delivery_date DATE,
  currency VARCHAR(3),
  total_amount DECIMAL(15, 2),
  status VARCHAR(20), -- Draft, Confirmed, Partially Delivered, Completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity_ordered DECIMAL(13, 3) NOT NULL,
  quantity_delivered DECIMAL(13, 3) DEFAULT 0,
  unit_price DECIMAL(13, 2) NOT NULL,
  line_amount DECIMAL(15, 2),
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  delivery_number VARCHAR(20) UNIQUE NOT NULL,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  delivery_date DATE NOT NULL,
  shipping_date DATE,
  status VARCHAR(20), -- Planned, Packed, Shipped, Delivered
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity_delivered DECIMAL(13, 3) NOT NULL,
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE billing_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_number VARCHAR(20) UNIQUE NOT NULL,
  sales_order_id UUID REFERENCES sales_orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_date DATE NOT NULL,
  due_date DATE,
  total_amount DECIMAL(15, 2),
  currency VARCHAR(3),
  status VARCHAR(20), -- Draft, Posted, Paid, Overdue
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE billing_document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_document_id UUID NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity DECIMAL(13, 3),
  unit_price DECIMAL(13, 2),
  line_amount DECIMAL(15, 2),
  tax_amount DECIMAL(15, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 6. PP (PRODUCTION PLANNING) MODULE
-- =====================================================

CREATE TABLE bills_of_material (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  bom_version VARCHAR(3),
  bom_type VARCHAR(50), -- Multilevel, Single-level
  status VARCHAR(20), -- Active, Inactive
  effective_from DATE,
  effective_to DATE,
  UNIQUE(material_id, plant_id, bom_version),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id UUID NOT NULL REFERENCES bills_of_material(id) ON DELETE CASCADE,
  component_material_id UUID NOT NULL REFERENCES materials(id),
  quantity DECIMAL(13, 3) NOT NULL,
  unit_of_measure VARCHAR(10),
  line_item_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  work_center_code VARCHAR(20) UNIQUE NOT NULL,
  work_center_name VARCHAR(255) NOT NULL,
  work_center_type VARCHAR(50), -- Machine, Labor, etc.
  capacity_per_period DECIMAL(10, 2),
  cost_center_id UUID REFERENCES cost_centers(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE routings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  routing_number VARCHAR(20) UNIQUE NOT NULL,
  routing_version VARCHAR(3),
  status VARCHAR(20), -- Active, Inactive
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE routing_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_id UUID NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
  work_center_id UUID NOT NULL REFERENCES work_centers(id),
  operation_sequence INTEGER NOT NULL,
  operation_type VARCHAR(50), -- Standard, Inspection
  duration_minutes INTEGER,
  setup_time_minutes INTEGER,
  UNIQUE(routing_id, operation_sequence),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plant_id UUID NOT NULL REFERENCES plants(id),
  production_order_number VARCHAR(20) UNIQUE NOT NULL,
  material_id UUID NOT NULL REFERENCES materials(id),
  bom_id UUID REFERENCES bills_of_material(id),
  routing_id UUID REFERENCES routings(id),
  order_quantity DECIMAL(13, 3) NOT NULL,
  planned_start_date DATE,
  planned_end_date DATE,
  status VARCHAR(20), -- Planned, Released, In Progress, Completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_order_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  work_center_id UUID NOT NULL REFERENCES work_centers(id),
  operation_sequence INTEGER NOT NULL,
  operation_status VARCHAR(20), -- Planned, Released, In Progress, Completed
  actual_start_date TIMESTAMP,
  actual_end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id),
  confirmation_date DATE NOT NULL,
  quantity_produced DECIMAL(13, 3),
  scrap_quantity DECIMAL(13, 3) DEFAULT 0,
  status VARCHAR(20), -- Posted, Reversed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 7. HR (HUMAN RESOURCES) MODULE
-- =====================================================

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(10),
  marital_status VARCHAR(20),
  nationality VARCHAR(3),
  email VARCHAR(255) UNIQUE,
  phone_number VARCHAR(20),
  address VARCHAR(500),
  city VARCHAR(100),
  country VARCHAR(3),
  postal_code VARCHAR(20),
  employee_type VARCHAR(50), -- Full-time, Part-time, Contract
  employment_date DATE,
  termination_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  position_code VARCHAR(20) UNIQUE NOT NULL,
  position_name VARCHAR(255) NOT NULL,
  department VARCHAR(100),
  reporting_to_position_id UUID REFERENCES positions(id),
  job_grade VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  position_id UUID NOT NULL REFERENCES positions(id),
  assignment_date DATE NOT NULL,
  end_date DATE,
  cost_center_id UUID REFERENCES cost_centers(id),
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  salary_period VARCHAR(10), -- Monthly, Bi-weekly
  basic_salary DECIMAL(15, 2),
  allowances DECIMAL(15, 2) DEFAULT 0,
  deductions DECIMAL(15, 2) DEFAULT 0,
  gross_salary DECIMAL(15, 2),
  net_salary DECIMAL(15, 2),
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  payroll_period VARCHAR(20) NOT NULL,
  payroll_date DATE NOT NULL,
  status VARCHAR(20), -- Draft, Processed, Posted
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payroll_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  basic_salary DECIMAL(15, 2),
  allowances DECIMAL(15, 2),
  deductions DECIMAL(15, 2),
  gross_pay DECIMAL(15, 2),
  net_pay DECIMAL(15, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  leave_type_code VARCHAR(20) UNIQUE NOT NULL,
  leave_type_name VARCHAR(100) NOT NULL,
  annual_entitlement DECIMAL(5, 2),
  is_paid BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  number_of_days DECIMAL(5, 2),
  reason VARCHAR(500),
  approved_by_employee_id UUID REFERENCES employees(id),
  status VARCHAR(20), -- Submitted, Approved, Rejected
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 8. CRM (CUSTOMER RELATIONSHIP MANAGEMENT) MODULE
-- =====================================================

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  customer_id UUID REFERENCES customers(id),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  title VARCHAR(100),
  email VARCHAR(255),
  phone_number VARCHAR(20),
  mobile_number VARCHAR(20),
  department VARCHAR(100),
  is_primary_contact BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  opportunity_number VARCHAR(20) UNIQUE NOT NULL,
  opportunity_name VARCHAR(255) NOT NULL,
  description VARCHAR(1000),
  opportunity_type VARCHAR(50), -- New Business, Upsell, Cross-sell
  expected_value DECIMAL(15, 2),
  probability_percentage DECIMAL(5, 2),
  expected_close_date DATE,
  assigned_to_employee_id UUID REFERENCES employees(id),
  stage VARCHAR(50), -- Prospecting, Qualification, Proposal, Negotiation, Closed
  status VARCHAR(20), -- Open, Won, Lost
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  customer_id UUID REFERENCES customers(id),
  opportunity_id UUID REFERENCES opportunities(id),
  activity_type VARCHAR(50), -- Email, Call, Meeting, Task
  subject VARCHAR(255),
  description VARCHAR(1000),
  activity_date DATE,
  completed_date DATE,
  assigned_to_employee_id UUID REFERENCES employees(id),
  status VARCHAR(20), -- Planned, In Progress, Completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  campaign_name VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50), -- Email, Direct Mail, Event, Web
  start_date DATE,
  end_date DATE,
  budget DECIMAL(15, 2),
  target_audience VARCHAR(255),
  status VARCHAR(20), -- Planning, Active, Completed, Cancelled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 9. SRM (SUPPLIER RELATIONSHIP MANAGEMENT) MODULE
-- =====================================================

CREATE TABLE supplier_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  evaluation_period_from DATE NOT NULL,
  evaluation_period_to DATE NOT NULL,
  quality_score DECIMAL(5, 2), -- 0-100
  delivery_score DECIMAL(5, 2), -- 0-100
  cost_score DECIMAL(5, 2), -- 0-100
  overall_score DECIMAL(5, 2), -- 0-100
  performance_rating VARCHAR(20), -- Excellent, Good, Fair, Poor
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  contract_number VARCHAR(20) UNIQUE NOT NULL,
  contract_type VARCHAR(50), -- Supply Agreement, Service Agreement
  start_date DATE NOT NULL,
  end_date DATE,
  contract_value DECIMAL(15, 2),
  currency VARCHAR(3),
  payment_terms VARCHAR(50),
  status VARCHAR(20), -- Active, Expired, Terminated
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  quotation_number VARCHAR(20) UNIQUE NOT NULL,
  quotation_date DATE NOT NULL,
  validity_end_date DATE,
  total_amount DECIMAL(15, 2),
  currency VARCHAR(3),
  status VARCHAR(20), -- Draft, Submitted, Accepted, Rejected, Expired
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  quantity DECIMAL(13, 3),
  unit_price DECIMAL(13, 2),
  line_amount DECIMAL(15, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_journal_entries_company_date ON journal_entries(company_id, posting_date);
CREATE INDEX idx_journal_entries_status ON journal_entries(status);
CREATE INDEX idx_invoices_company_type ON invoices(company_id, invoice_type);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_purchase_orders_company_plant ON purchase_orders(company_id, plant_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_sales_orders_company_plant ON sales_orders(company_id, plant_id);
CREATE INDEX idx_sales_orders_status ON sales_orders(status);
CREATE INDEX idx_goods_receipts_po ON goods_receipts(purchase_order_id);
CREATE INDEX idx_delivery_orders_so ON delivery_orders(sales_order_id);
CREATE INDEX idx_production_orders_status ON production_orders(status);
CREATE INDEX idx_material_storage_location ON material_storage_location(material_id, storage_location_id);
CREATE INDEX idx_employees_company_active ON employees(company_id, is_active);
CREATE INDEX idx_payroll_runs_company_period ON payroll_runs(company_id, payroll_period);
CREATE INDEX idx_opportunities_customer_status ON opportunities(customer_id, status);
CREATE INDEX idx_activities_customer_type ON activities(customer_id, activity_type);



-- Drop the old constraint
ALTER TABLE gl_accounts DROP CONSTRAINT gl_accounts_account_number_key;

-- Add composite unique constraint
ALTER TABLE gl_accounts ADD CONSTRAINT gl_accounts_company_account_unique 
  UNIQUE(company_id, account_number);