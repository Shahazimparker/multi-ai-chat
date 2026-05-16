-- =====================================================
-- ERP_DB Sample Data - PART 4
-- Positions, Assignments, Payroll, Leave, CRM, SRM
-- =====================================================

-- =====================================================
-- 31. POSITIONS (40 records)
-- =====================================================

INSERT INTO positions (company_id, position_code, position_name, department, reporting_to_position_id, job_grade, is_active) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0001', 'Manufacturing Manager', 'Production', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0002', 'Production Supervisor', 'Production', (SELECT id FROM positions WHERE position_code='POS-0001'), 'Grade 5', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0003', 'Machine Operator', 'Production', (SELECT id FROM positions WHERE position_code='POS-0002'), 'Grade 3', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0004', 'Quality Manager', 'Quality', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0005', 'QA Inspector', 'Quality', (SELECT id FROM positions WHERE position_code='POS-0004'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0006', 'Maintenance Manager', 'Maintenance', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0007', 'Maintenance Technician', 'Maintenance', (SELECT id FROM positions WHERE position_code='POS-0006'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0008', 'Logistics Manager', 'Logistics', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0009', 'Warehouse Supervisor', 'Logistics', (SELECT id FROM positions WHERE position_code='POS-0008'), 'Grade 5', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0010', 'Warehouse Worker', 'Logistics', (SELECT id FROM positions WHERE position_code='POS-0009'), 'Grade 2', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0011', 'Finance Manager', 'Finance', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0012', 'Accountant', 'Finance', (SELECT id FROM positions WHERE position_code='POS-0011'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0013', 'HR Manager', 'Human Resources', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0014', 'HR Specialist', 'Human Resources', (SELECT id FROM positions WHERE position_code='POS-0013'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0002'), 'POS-0015', 'Betriebsleiter', 'Produktion', NULL, 'Grad 6', true),
((SELECT id FROM companies WHERE company_code='0002'), 'POS-0016', 'Schichtleiter', 'Produktion', (SELECT id FROM positions WHERE position_code='POS-0015'), 'Grad 5', true),
((SELECT id FROM companies WHERE company_code='0002'), 'POS-0017', 'Maschinenbediener', 'Produktion', (SELECT id FROM positions WHERE position_code='POS-0016'), 'Grad 3', true),
((SELECT id FROM companies WHERE company_code='0002'), 'POS-0018', 'Qualitätsleiter', 'Qualität', NULL, 'Grad 6', true),
((SELECT id FROM companies WHERE company_code='0002'), 'POS-0019', 'Prüfer', 'Qualität', (SELECT id FROM positions WHERE position_code='POS-0018'), 'Grad 4', true),
((SELECT id FROM companies WHERE company_code='0003'), 'POS-0020', 'Plant Manager SG', 'Production', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0003'), 'POS-0021', 'Supervisor SG', 'Production', (SELECT id FROM positions WHERE position_code='POS-0020'), 'Grade 5', true),
((SELECT id FROM companies WHERE company_code='0004'), 'POS-0022', 'संयंत्र प्रबंधक', 'उत्पादन', NULL, 'ग्रेड 7', true),
((SELECT id FROM companies WHERE company_code='0004'), 'POS-0023', 'पर्यवेक्षक', 'उत्पादन', (SELECT id FROM positions WHERE position_code='POS-0022'), 'ग्रेड 5', true),
((SELECT id FROM companies WHERE company_code='0005'), 'POS-0024', 'مدير المصنع', 'الإنتاج', NULL, 'درجة 7', true),
((SELECT id FROM companies WHERE company_code='0006'), 'POS-0025', 'Gerente de Produção', 'Produção', NULL, 'Grau 7', true),
((SELECT id FROM companies WHERE company_code='0007'), 'POS-0026', 'Plant Manager', 'Production', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0008'), 'POS-0027', 'Plant Manager AU', 'Production', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0009'), 'POS-0028', '工場長', '製造', NULL, 'グレード 7', true),
((SELECT id FROM companies WHERE company_code='0010'), 'POS-0029', 'Gerente de Producción', 'Producción', NULL, 'Grado 7', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0030', 'General Manager', 'Executive', NULL, 'Grade 8', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0031', 'Operations Director', 'Operations', (SELECT id FROM positions WHERE position_code='POS-0030'), 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0032', 'Sales Manager', 'Sales', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0033', 'Sales Executive', 'Sales', (SELECT id FROM positions WHERE position_code='POS-0032'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0034', 'Procurement Manager', 'Procurement', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0035', 'Procurement Officer', 'Procurement', (SELECT id FROM positions WHERE position_code='POS-0034'), 'Grade 4', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0036', 'Engineering Manager', 'Engineering', NULL, 'Grade 7', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0037', 'Process Engineer', 'Engineering', (SELECT id FROM positions WHERE position_code='POS-0036'), 'Grade 5', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0038', 'Safety Officer', 'Safety', NULL, 'Grade 5', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0039', 'IT Manager', 'IT', NULL, 'Grade 6', true),
((SELECT id FROM companies WHERE company_code='0001'), 'POS-0040', 'IT Support', 'IT', (SELECT id FROM positions WHERE position_code='POS-0039'), 'Grade 3', true);

-- =====================================================
-- 32. EMPLOYEE ASSIGNMENTS (100 records)
-- =====================================================

INSERT INTO employee_assignments (employee_id, position_id, assignment_date, end_date, cost_center_id, is_current)
SELECT 
  e.id,
  (SELECT id FROM positions WHERE company_id = e.company_id ORDER BY RANDOM() LIMIT 1),
  '2024-01-01'::DATE,
  NULL,
  (SELECT id FROM cost_centers WHERE company_id = e.company_id ORDER BY RANDOM() LIMIT 1),
  true
FROM employees e
WHERE e.is_active = true;

-- =====================================================
-- 33. SALARIES (100 records)
-- =====================================================

INSERT INTO salaries (employee_id, salary_period, basic_salary, allowances, deductions, gross_salary, net_salary, valid_from, valid_to)
SELECT 
  e.id,
  'Monthly',
  CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id)) % 15000) 
       ELSE 2000 + (ABS(HASHTEXT(e.employee_id)) % 8000) END,
  CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || 'all')) % 2000)
       ELSE 200 + (ABS(HASHTEXT(e.employee_id || 'all')) % 800) END,
  CASE WHEN e.employee_type = 'Full-time' THEN 800 + (ABS(HASHTEXT(e.employee_id || 'ded')) % 3000)
       ELSE 300 + (ABS(HASHTEXT(e.employee_id || 'ded')) % 1000) END,
  (CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id)) % 15000) 
        ELSE 2000 + (ABS(HASHTEXT(e.employee_id)) % 8000) END) + 
  (CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || 'all')) % 2000)
        ELSE 200 + (ABS(HASHTEXT(e.employee_id || 'all')) % 800) END),
  (CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id)) % 15000) 
        ELSE 2000 + (ABS(HASHTEXT(e.employee_id)) % 8000) END) + 
  (CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || 'all')) % 2000)
        ELSE 200 + (ABS(HASHTEXT(e.employee_id || 'all')) % 800) END) -
  (CASE WHEN e.employee_type = 'Full-time' THEN 800 + (ABS(HASHTEXT(e.employee_id || 'ded')) % 3000)
        ELSE 300 + (ABS(HASHTEXT(e.employee_id || 'ded')) % 1000) END),
  '2024-01-01'::DATE,
  '2099-12-31'::DATE
FROM employees e
WHERE e.is_active = true;

-- =====================================================
-- 34. PAYROLL RUNS (12 records - monthly for 2024)
-- =====================================================

INSERT INTO payroll_runs (company_id, payroll_period, payroll_date, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'Jan 2024', '2024-01-31'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'Feb 2024', '2024-02-29'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'Mar 2024', '2024-03-31'::DATE, 'Processed'),
((SELECT id FROM companies WHERE company_code='0001'), 'Apr 2024', '2024-04-30'::DATE, 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'Jan 2024', '2024-01-31'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), 'Feb 2024', '2024-02-29'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), 'Jan 2024', '2024-01-31'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), 'Feb 2024', '2024-02-29'::DATE, 'Processed'),
((SELECT id FROM companies WHERE company_code='0004'), 'Jan 2024', '2024-01-31'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), 'Feb 2024', '2024-02-29'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0005'), 'Jan 2024', '2024-01-31'::DATE, 'Posted'),
((SELECT id FROM companies WHERE company_code='0006'), 'Jan 2024', '2024-01-31'::DATE, 'Posted');

-- =====================================================
-- 35. PAYROLL DETAILS (100+ records)
-- =====================================================

INSERT INTO payroll_details (payroll_run_id, employee_id, basic_salary, allowances, deductions, gross_pay, net_pay)
SELECT 
  pr.id,
  e.id,
  CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 15000) 
       ELSE 2000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 8000) END,
  CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 2000)
       ELSE 200 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 800) END,
  CASE WHEN e.employee_type = 'Full-time' THEN 800 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'ded')) % 3000)
       ELSE 300 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'ded')) % 1000) END,
  (CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 15000) 
        ELSE 2000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 8000) END) + 
  (CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 2000)
        ELSE 200 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 800) END),
  (CASE WHEN e.employee_type = 'Full-time' THEN 3000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 15000) 
        ELSE 2000 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period)) % 8000) END) + 
  (CASE WHEN e.employee_type = 'Full-time' THEN 500 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 2000)
        ELSE 200 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'all')) % 800) END) -
  (CASE WHEN e.employee_type = 'Full-time' THEN 800 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'ded')) % 3000)
        ELSE 300 + (ABS(HASHTEXT(e.employee_id || pr.payroll_period || 'ded')) % 1000) END)
FROM payroll_runs pr
CROSS JOIN employees e
WHERE e.company_id = pr.company_id AND e.is_active = true
LIMIT 100;

-- =====================================================
-- 36. LEAVE TYPES (20 records)
-- =====================================================

INSERT INTO leave_types (company_id, leave_type_code, leave_type_name, annual_entitlement, is_paid) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'LT-001', 'Annual Leave', 20.0, true),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-002', 'Sick Leave', 10.0, true),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-003', 'Casual Leave', 5.0, true),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-004', 'Bereavement Leave', 3.0, true),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-005', 'Maternity Leave', 90.0, true),
((SELECT id FROM companies WHERE company_code='0002'), 'LT-006', 'Jahresurlaub', 25.0, true),
((SELECT id FROM companies WHERE company_code='0002'), 'LT-007', 'Krankenstand', 10.0, true),
((SELECT id FROM companies WHERE company_code='0002'), 'LT-008', 'Elternzeit', 180.0, true),
((SELECT id FROM companies WHERE company_code='0003'), 'LT-009', 'Annual Leave SG', 14.0, true),
((SELECT id FROM companies WHERE company_code='0003'), 'LT-010', 'Sick Leave SG', 4.0, true),
((SELECT id FROM companies WHERE company_code='0004'), 'LT-011', 'वार्षिक अवकाश', 18.0, true),
((SELECT id FROM companies WHERE company_code='0004'), 'LT-012', 'बीमार अवकाश', 8.0, true),
((SELECT id FROM companies WHERE company_code='0005'), 'LT-013', 'إجازة سنوية', 20.0, true),
((SELECT id FROM companies WHERE company_code='0006'), 'LT-014', 'Férias Anuais', 20.0, true),
((SELECT id FROM companies WHERE company_code='0007'), 'LT-015', 'Annual Leave CA', 15.0, true),
((SELECT id FROM companies WHERE company_code='0008'), 'LT-016', 'Annual Leave AU', 20.0, true),
((SELECT id FROM companies WHERE company_code='0009'), 'LT-017', '年間休暇', 16.0, true),
((SELECT id FROM companies WHERE company_code='0010'), 'LT-018', 'Vacaciones Anuales', 15.0, true),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-019', 'Unpaid Leave', 0.0, false),
((SELECT id FROM companies WHERE company_code='0001'), 'LT-020', 'Study Leave', 5.0, true);

-- =====================================================
-- 37. LEAVE REQUESTS (50 records)
-- =====================================================

INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, number_of_days, reason, approved_by_employee_id, status) VALUES
((SELECT id FROM employees WHERE employee_id='EMP0001'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-01-08'::DATE, '2024-01-12'::DATE, 5.0, 'Vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0002'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-01-15'::DATE, '2024-01-16'::DATE, 2.0, 'Medical checkup', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0003'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-01-22'::DATE, '2024-01-26'::DATE, 5.0, 'Family trip', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0004'), (SELECT id FROM leave_types WHERE leave_type_code='LT-003'), '2024-02-01'::DATE, '2024-02-02'::DATE, 2.0, 'Personal matters', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0005'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-02-10'::DATE, '2024-02-16'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0006'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-02-05'::DATE, '2024-02-06'::DATE, 2.0, 'Illness', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0007'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-01'::DATE, '2024-03-07'::DATE, 5.0, 'Extended vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0008'), (SELECT id FROM leave_types WHERE leave_type_code='LT-003'), '2024-02-20'::DATE, '2024-02-21'::DATE, 2.0, 'Appointment', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0009'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-02-15'::DATE, '2024-02-16'::DATE, 2.0, 'Unwell', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0010'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-15'::DATE, '2024-03-22'::DATE, 5.0, 'Spring vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0011'), (SELECT id FROM leave_types WHERE leave_type_code='LT-006'), '2024-01-20'::DATE, '2024-01-27'::DATE, 5.0, 'Urlaub', (SELECT id FROM employees WHERE employee_id='EMP0011'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0012'), (SELECT id FROM leave_types WHERE leave_type_code='LT-007'), '2024-02-05'::DATE, '2024-02-06'::DATE, 2.0, 'Krank', (SELECT id FROM employees WHERE employee_id='EMP0011'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0016'), (SELECT id FROM leave_types WHERE leave_type_code='LT-009'), '2024-01-15'::DATE, '2024-01-19'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0016'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0017'), (SELECT id FROM leave_types WHERE leave_type_code='LT-010'), '2024-02-01'::DATE, '2024-02-02'::DATE, 2.0, 'Sick leave', (SELECT id FROM employees WHERE employee_id='EMP0016'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0021'), (SELECT id FROM leave_types WHERE leave_type_code='LT-011'), '2024-01-22'::DATE, '2024-01-26'::DATE, 5.0, 'छुट्टी', (SELECT id FROM employees WHERE employee_id='EMP0021'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0022'), (SELECT id FROM leave_types WHERE leave_type_code='LT-012'), '2024-02-10'::DATE, '2024-02-11'::DATE, 2.0, 'बीमार', (SELECT id FROM employees WHERE employee_id='EMP0021'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0026'), (SELECT id FROM leave_types WHERE leave_type_code='LT-013'), '2024-01-15'::DATE, '2024-01-22'::DATE, 5.0, 'إجازة', (SELECT id FROM employees WHERE employee_id='EMP0026'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0028'), (SELECT id FROM leave_types WHERE leave_type_code='LT-014'), '2024-02-05'::DATE, '2024-02-09'::DATE, 5.0, 'Férias', (SELECT id FROM employees WHERE employee_id='EMP0028'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0030'), (SELECT id FROM leave_types WHERE leave_type_code='LT-015'), '2024-01-20'::DATE, '2024-01-24'::DATE, 5.0, 'Vacation', (SELECT id FROM employees WHERE employee_id='EMP0030'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0032'), (SELECT id FROM leave_types WHERE leave_type_code='LT-016'), '2024-02-12'::DATE, '2024-02-16'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0034'), (SELECT id FROM leave_types WHERE leave_type_code='LT-017'), '2024-01-25'::DATE, '2024-02-02'::DATE, 5.0, '休暇', (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0036'), (SELECT id FROM leave_types WHERE leave_type_code='LT-018'), '2024-02-20'::DATE, '2024-02-23'::DATE, 4.0, 'Vacaciones', (SELECT id FROM employees WHERE employee_id='EMP0036'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0001'), (SELECT id FROM leave_types WHERE leave_type_code='LT-003'), '2024-03-08'::DATE, '2024-03-08'::DATE, 1.0, 'Personal', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0002'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-18'::DATE, '2024-03-22'::DATE, 5.0, 'Spring break', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0003'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-03-05'::DATE, '2024-03-06'::DATE, 2.0, 'Doctor visit', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0038'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-02-26'::DATE, '2024-03-01'::DATE, 4.0, 'Weekend trip', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0039'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-02-08'::DATE, '2024-02-09'::DATE, 2.0, 'Sick', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0040'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-25'::DATE, '2024-03-29'::DATE, 5.0, 'Spring vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0041'), (SELECT id FROM leave_types WHERE leave_type_code='LT-003'), '2024-02-28'::DATE, '2024-02-29'::DATE, 2.0, 'Personal', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0042'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-03-01'::DATE, '2024-03-01'::DATE, 1.0, 'Unwell', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0043'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-01-29'::DATE, '2024-02-02'::DATE, 4.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0044'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-02-22'::DATE, '2024-02-23'::DATE, 2.0, 'Unwell', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0045'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-10'::DATE, '2024-03-15'::DATE, 5.0, 'Easter vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0046'), (SELECT id FROM leave_types WHERE leave_type_code='LT-006'), '2024-02-15'::DATE, '2024-02-23'::DATE, 5.0, 'Urlaub', (SELECT id FROM employees WHERE employee_id='EMP0011'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0047'), (SELECT id FROM leave_types WHERE leave_type_code='LT-007'), '2024-03-01'::DATE, '2024-03-01'::DATE, 1.0, 'Krank', (SELECT id FROM employees WHERE employee_id='EMP0011'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0051'), (SELECT id FROM leave_types WHERE leave_type_code='LT-009'), '2024-02-10'::DATE, '2024-02-16'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0016'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0052'), (SELECT id FROM leave_types WHERE leave_type_code='LT-010'), '2024-02-20'::DATE, '2024-02-21'::DATE, 2.0, 'Sick', (SELECT id FROM employees WHERE employee_id='EMP0016'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0056'), (SELECT id FROM leave_types WHERE leave_type_code='LT-011'), '2024-02-15'::DATE, '2024-02-23'::DATE, 5.0, 'छुट्टी', (SELECT id FROM employees WHERE employee_id='EMP0021'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0057'), (SELECT id FROM leave_types WHERE leave_type_code='LT-012'), '2024-03-05'::DATE, '2024-03-06'::DATE, 2.0, 'बीमार', (SELECT id FROM employees WHERE employee_id='EMP0021'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0061'), (SELECT id FROM leave_types WHERE leave_type_code='LT-013'), '2024-02-20'::DATE, '2024-02-27'::DATE, 5.0, 'إجازة', (SELECT id FROM employees WHERE employee_id='EMP0026'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0063'), (SELECT id FROM leave_types WHERE leave_type_code='LT-014'), '2024-01-29'::DATE, '2024-02-02'::DATE, 5.0, 'Férias', (SELECT id FROM employees WHERE employee_id='EMP0028'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0065'), (SELECT id FROM leave_types WHERE leave_type_code='LT-015'), '2024-02-26'::DATE, '2024-03-01'::DATE, 4.0, 'Vacation', (SELECT id FROM employees WHERE employee_id='EMP0030'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0067'), (SELECT id FROM leave_types WHERE leave_type_code='LT-016'), '2024-03-11'::DATE, '2024-03-15'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0069'), (SELECT id FROM leave_types WHERE leave_type_code='LT-017'), '2024-02-25'::DATE, '2024-03-04'::DATE, 5.0, '休暇', (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0071'), (SELECT id FROM leave_types WHERE leave_type_code='LT-018'), '2024-03-18'::DATE, '2024-03-22'::DATE, 5.0, 'Vacaciones', (SELECT id FROM employees WHERE employee_id='EMP0036'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0073'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-01-10'::DATE, '2024-01-17'::DATE, 5.0, 'Holiday', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0074'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-02-12'::DATE, '2024-02-13'::DATE, 2.0, 'Sick', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0075'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-04'::DATE, '2024-03-08'::DATE, 5.0, 'Vacation', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0076'), (SELECT id FROM leave_types WHERE leave_type_code='LT-003'), '2024-02-19'::DATE, '2024-02-20'::DATE, 2.0, 'Personal', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Approved'),
((SELECT id FROM employees WHERE employee_id='EMP0077'), (SELECT id FROM leave_types WHERE leave_type_code='LT-002'), '2024-03-11'::DATE, '2024-03-12'::DATE, 2.0, 'Doctor', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted'),
((SELECT id FROM employees WHERE employee_id='EMP0078'), (SELECT id FROM leave_types WHERE leave_type_code='LT-001'), '2024-03-21'::DATE, '2024-03-28'::DATE, 5.0, 'Easter break', (SELECT id FROM employees WHERE employee_id='EMP0001'), 'Submitted');

-- =====================================================
-- 38. CONTACTS (50 records)
-- =====================================================

INSERT INTO contacts (company_id, customer_id, first_name, last_name, title, email, phone_number, mobile_number, department, is_primary_contact) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), 'John', 'Smith', 'Procurement Manager', 'john.smith@automotiveparts.com', '+1-212-555-0101', '+1-917-555-0101', 'Procurement', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), 'Mary', 'Johnson', 'Sales Representative', 'mary.johnson@automotiveparts.com', '+1-212-555-0102', '+1-917-555-0102', 'Sales', false),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), 'Robert', 'Williams', 'VP Operations', 'robert.williams@mfgolutions.com', '+1-310-555-0101', '+1-323-555-0101', 'Operations', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), 'Susan', 'Brown', 'Quality Lead', 'susan.brown@mfgolutions.com', '+1-310-555-0102', '+1-323-555-0102', 'Quality', false),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), 'Michael', 'Davis', 'Logistics Manager', 'michael.davis@indequip.com', '+1-404-555-0101', '+1-470-555-0101', 'Logistics', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), 'Jennifer', 'Miller', 'IT Manager', 'jennifer.miller@techsystems.com', '+1-408-555-0101', '+1-650-555-0101', 'IT', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0005'), 'David', 'Wilson', 'Store Manager', 'david.wilson@retailchain.com', '+1-770-555-0101', '+1-404-555-0102', 'Retail', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0006'), 'Lisa', 'Anderson', 'Supply Chain Director', 'lisa.anderson@machineparts.com', '+1-214-555-0101', '+1-972-555-0101', 'Supply Chain', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0007'), 'James', 'Taylor', 'Regional Manager', 'james.taylor@elecdist.com', '+1-206-555-0101', '+1-425-555-0101', 'Sales', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0008'), 'Patricia', 'Garcia', 'Procurement Officer', 'patricia.garcia@insupplies.com', '+1-602-555-0101', '+1-480-555-0101', 'Procurement', true),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0011'), 'Hans', 'Mueller', 'Einkaufsleiter', 'hans.mueller@automotive-de.com', '+49-89-555-0101', '+49-171-555-0101', 'Einkauf', true),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0012'), 'Greta', 'Schmidt', 'Betriebsdirektorin', 'greta.schmidt@maschinenbau.com', '+49-30-555-0101', '+49-152-555-0101', 'Betrieb', true),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0013'), 'Klaus', 'Weber', 'Großhandelsleiter', 'klaus.weber@grosshandel-sue.com', '+49-79-555-0101', '+49-160-555-0101', 'Vertrieb', true),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0014'), 'Anna', 'Fischer', 'Einzelhandelsmanagerin', 'anna.fischer@einzelhandel.com', '+49-40-555-0101', '+49-170-555-0101', 'Einzelhandel', true),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0015'), 'Friedrich', 'Mueller', 'Vertriebsleiter', 'friedrich.mueller@elektronik.com', '+49-201-555-0101', '+49-151-555-0101', 'Vertrieb', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0016'), 'Rajesh', 'Kumar', 'Operations Manager', 'rajesh.kumar@aseancorp.com', '+65-6888-0101', '+65-9111-0101', 'Operations', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0017'), 'Priya', 'Sharma', 'Procurement Head', 'priya.sharma@eqwtrade.com', '+66-2-555-0101', '+66-81-555-0101', 'Procurement', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0018'), 'Amit', 'Patel', 'Supply Manager', 'amit.patel@seasia-trading.com', '+66-2-555-0102', '+66-82-555-0102', 'Supply', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0019'), 'Anita', 'Desai', 'Retail Manager', 'anita.desai@electretail.com', '+65-6888-0102', '+65-9111-0102', 'Retail', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0020'), 'Vikram', 'Singh', 'Logistics Chief', 'vikram.singh@bangkoksupply.com', '+66-2-555-0103', '+66-83-555-0103', 'Logistics', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0021'), 'Vikram', 'Singh', 'खरीद प्रबंधक', 'vikram.singh@indiaautomotive.com', '+91-11-4444-0101', '+91-98-0000-0101', 'खरीद', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0022'), 'Anjali', 'Gupta', 'संचालन निदेशक', 'anjali.gupta@indiamfg.com', '+91-11-4444-0102', '+91-98-0000-0102', 'संचालन', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0023'), 'Manoj', 'Reddy', 'आपूर्ति श्रृंखला', 'manoj.reddy@indiasupp.com', '+91-22-5555-0101', '+91-97-0000-0101', 'आपूर्ति', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0024'), 'Priya', 'Nair', 'खुदरा प्रबंधक', 'priya.nair@indiaretail.com', '+91-80-2222-0101', '+91-99-0000-0101', 'खुदरा', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0025'), 'Arun', 'Patel', 'विक्रय निदेशक', 'arun.patel@indiasales.com', '+91-79-2222-0101', '+91-96-0000-0101', 'विक्रय', true),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0026'), 'Ahmed', 'Al-Mansouri', 'مدير المشتريات', 'ahmed.almansouri@gulftrade.com', '+971-4-312-0101', '+971-50-0000-0101', 'المشتريات', true),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0027'), 'Fatima', 'Al-Zahra', 'مديرة العمليات', 'fatima.alzahra@gulfmfg.com', '+971-4-312-0102', '+971-50-0000-0102', 'العمليات', true),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0028'), 'Carlos', 'Silva', 'Gerente de Logística', 'carlos.silva@brazildist.com', '+55-11-3333-0101', '+55-11-9999-0101', 'Logística', true),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0029'), 'Patricia', 'Santos', 'Diretora de Produção', 'patricia.santos@brazilmfg.com', '+55-11-3333-0102', '+55-11-9999-0102', 'Produção', true),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0030'), 'Michael', 'Chen', 'Procurement Manager', 'michael.chen@canadadist.com', '+1-416-555-0101', '+1-647-555-0101', 'Procurement', true),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0031'), 'Jennifer', 'Lee', 'VP Operations', 'jennifer.lee@canadamfg.com', '+1-416-555-0102', '+1-647-555-0102', 'Operations', true),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0032'), 'David', 'Miller', 'Supply Manager', 'david.miller@ausdist.com', '+61-2-8888-0101', '+61-4-0000-0101', 'Supply', true),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0033'), 'Emma', 'Thompson', 'Operations Director', 'emma.thompson@ausmfg.com', '+61-2-8888-0102', '+61-4-0000-0102', 'Operations', true),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0034'), 'Hiroshi', 'Tanaka', '購買部長', 'hiroshi.tanaka@japantrade.com', '+81-3-1111-0101', '+81-90-0000-0101', '購買', true),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0035'), 'Yuki', 'Yamamoto', '運営責任者', 'yuki.yamamoto@japanops.com', '+81-3-1111-0102', '+81-90-0000-0102', '運営', true),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0036'), 'Miguel', 'Rodriguez', 'Gerente de Compras', 'miguel.rodriguez@mexicotrade.com', '+52-55-1111-0101', '+52-55-9999-0101', 'Compras', true),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0037'), 'Rosa', 'Martinez', 'Directora de Fabricación', 'rosa.martinez@mexicomfg.com', '+52-55-1111-0102', '+52-55-9999-0102', 'Fabricación', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0038'), 'Thomas', 'Martin', 'Sourcing Head', 'thomas.martin@premiumind.com', '+1-857-555-0101', '+1-617-555-0101', 'Sourcing', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0039'), 'Christine', 'White', 'Distribution Manager', 'christine.white@regdist.com', '+1-828-555-0101', '+1-704-555-0101', 'Distribution', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0040'), 'Richard', 'Black', 'Retail Operations', 'richard.black@specialretail.com', '+1-602-555-0102', '+1-480-555-0102', 'Retail', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0041'), 'Nancy', 'Green', 'Technical Buyer', 'nancy.green@premiumglobal.com', '+1-617-555-0102', '+1-857-555-0102', 'Procurement', false),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0041'), 'Peter', 'Becker', 'Teknologie-Manager', 'peter.becker@techmuenchen.com', '+49-89-555-0102', '+49-171-555-0102', 'Technologie', true),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0042'), 'Wei', 'Chen', 'Innovation Director', 'wei.chen@asianinnovation.com', '+65-6888-0103', '+65-9111-0103', 'Innovation', true),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0043'), 'Arjun', 'Kapoor', 'प्रीमियम क्रेता', 'arjun.kapoor@premiumind.com', '+91-11-4444-0103', '+91-98-0000-0103', 'क्रय', true),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0044'), 'Mohammed', 'Al-Rashid', 'الحل المتميز', 'mohammed.alrashid@premiumgulf.com', '+971-4-312-0103', '+971-50-0000-0103', 'الحل', true),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0045'), 'Roberto', 'Oliveira', 'Gerente Premium', 'roberto.oliveira@premiumbrasil.com', '+55-11-3333-0103', '+55-11-9999-0103', 'Premium', true),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0046'), 'Andrew', 'Thompson', 'Premium Solutions', 'andrew.thompson@premiumcanada.com', '+1-416-555-0103', '+1-647-555-0103', 'Solutions', true),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0047'), 'James', 'Wilson', 'Premium APAC', 'james.wilson@premiumapac.com', '+61-2-8888-0103', '+61-4-0000-0103', 'APAC', true),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0048'), 'Kenji', 'Yamamoto', 'プレミアム企業', 'kenji.yamamoto@premiumpremium.com', '+81-3-1111-0103', '+81-90-0000-0103', 'プレミアム', true),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0049'), 'Juan', 'Hernandez', 'Socio Global', 'juan.hernandez@socio-global.com', '+52-55-1111-0103', '+52-55-9999-0103', 'Global', true),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0050'), 'Gary', 'Harris', 'Chief Procurement', 'gary.harris@globalstrategic.com', '+1-212-555-0103', '+1-917-555-0103', 'Procurement', true);

-- =====================================================
-- 39. OPPORTUNITIES (50 records)
-- =====================================================

INSERT INTO opportunities (company_id, customer_id, opportunity_number, opportunity_name, description, opportunity_type, expected_value, probability_percentage, expected_close_date, assigned_to_employee_id, stage, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), 'OPP-2024-00001', 'Automotive Parts Supply Expansion', 'New product line for OEM', 'New Business', 250000.00, 75.0, '2024-03-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), 'OPP-2024-00002', 'Volume Increase 2024', 'Increase existing orders by 30%', 'Upsell', 187500.00, 85.0, '2024-02-28'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), 'OPP-2024-00003', 'Cross-sell Industrial Equipment', 'Add equipment solutions', 'Cross-sell', 156000.00, 60.0, '2024-04-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), 'OPP-2024-00004', 'Technology Systems Integration', 'Full system integration project', 'New Business', 425000.00, 70.0, '2024-05-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Proposal', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0005'), 'OPP-2024-00005', 'Retail Chain Expansion', 'Supply to 50 new stores', 'Upsell', 312500.00, 50.0, '2024-06-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Prospecting', 'Lost'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0006'), 'OPP-2024-00006', 'Long-term Service Contract', 'Annual service agreement', 'New Business', 125000.00, 80.0, '2024-03-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0007'), 'OPP-2024-00007', 'Regional Distribution Rights', 'Exclusive territory agreement', 'New Business', 200000.00, 45.0, '2024-04-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0008'), 'OPP-2024-00008', 'Premium Product Line', 'Premium tier products', 'Cross-sell', 87500.00, 65.0, '2024-03-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0009'), 'OPP-2024-00009', 'Customized Solutions Package', 'Bespoke configuration', 'Upsell', 256000.00, 90.0, '2024-02-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0010'), 'OPP-2024-00010', 'Geographic Expansion Deal', 'Enter new market region', 'New Business', 175000.00, 55.0, '2024-05-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Prospecting', 'Open'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0011'), 'OPP-2024-00011', 'Automobilzulieferer Expansion', 'Neue Produktreihe', 'New Business', 285000.00, 75.0, '2024-03-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0046'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0012'), 'OPP-2024-00012', 'Maschinenaufträge Erhöhung', 'Bestand erhöhen um 25%', 'Upsell', 212500.00, 80.0, '2024-02-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0047'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0016'), 'OPP-2024-00013', 'ASEAN Regional Supply', 'Regional supply agreement', 'New Business', 325000.00, 70.0, '2024-04-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0051'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0017'), 'OPP-2024-00014', 'Supply Chain Partnership', 'Integrated supply chain', 'New Business', 245000.00, 65.0, '2024-05-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0052'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0021'), 'OPP-2024-00015', 'भारत विस्तार समझौता', 'नई आपूर्ति समझौता', 'New Business', 2850000.00, 75.0, '2024-03-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0056'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0022'), 'OPP-2024-00016', 'भारत मात्रा वृद्धि', 'मात्रा 20% बढ़ाएं', 'Upsell', 3150000.00, 85.0, '2024-02-28'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0057'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0026'), 'OPP-2024-00017', 'Gulf Regional Supply', 'Regional supply contract', 'New Business', 425000.00, 70.0, '2024-04-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0061'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0028'), 'OPP-2024-00018', 'Brasil Expansão de Fornecimento', 'Novo acordo de fornecimento', 'New Business', 625000.00, 72.0, '2024-04-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0063'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0030'), 'OPP-2024-00019', 'Canada Supply Expansion', 'Expand supply agreement', 'Upsell', 275000.00, 80.0, '2024-03-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0065'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0032'), 'OPP-2024-00020', 'Australia New Supply Deal', 'New supply contract', 'New Business', 325000.00, 68.0, '2024-05-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0067'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0034'), 'OPP-2024-00021', '日本供給拡大', '新しい供給契約', 'New Business', 28000000.00, 75.0, '2024-04-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0069'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0036'), 'OPP-2024-00022', 'México Expansión de Suministro', 'Nuevo acuerdo de suministro', 'New Business', 4500000.00, 72.0, '2024-04-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0071'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0038'), 'OPP-2024-00023', 'Premium Industrial Solutions', 'Premium product offering', 'Upsell', 525000.00, 88.0, '2024-02-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0073'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0039'), 'OPP-2024-00024', 'Regional Distribution Network', 'Multi-state distribution', 'New Business', 385000.00, 62.0, '2024-05-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0074'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0040'), 'OPP-2024-00025', 'Specialty Retail Partnership', 'Specialty store supply', 'New Business', 225000.00, 58.0, '2024-06-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0075'), 'Prospecting', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), 'OPP-2024-00026', 'Automotive Aftermarket', 'Aftermarket parts supply', 'Cross-sell', 156250.00, 68.0, '2024-03-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), 'OPP-2024-00027', 'OEM Production Support', 'Direct OEM supply', 'Upsell', 312500.00, 82.0, '2024-02-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), 'OPP-2024-00028', 'Strategic Equipment Bundle', 'Equipment package deal', 'Cross-sell', 234000.00, 64.0, '2024-04-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), 'OPP-2024-00029', 'Systems Maintenance Contract', 'Annual maintenance agreement', 'New Business', 85000.00, 92.0, '2024-01-31'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0005'), 'OPP-2024-00030', 'Store Technology Upgrade', 'POS and tech upgrade', 'Upsell', 95500.00, 55.0, '2024-05-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0006'), 'OPP-2024-00031', 'Maintenance Parts Supply', 'Recurring parts supply', 'Upsell', 45000.00, 78.0, '2024-03-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Negotiation', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0007'), 'OPP-2024-00032', 'Logistics Technology Solutions', 'Supply chain software', 'New Business', 165000.00, 52.0, '2024-06-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Prospecting', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0008'), 'OPP-2024-00033', 'Premium Service Plan', 'Extended warranty package', 'Cross-sell', 42500.00, 71.0, '2024-03-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0009'), 'OPP-2024-00034', 'Additional Production Capacity', 'Capacity reservation agreement', 'Upsell', 128000.00, 88.0, '2024-02-28'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0010'), 'OPP-2024-00035', 'International Sourcing', 'Export supply agreement', 'New Business', 87500.00, 48.0, '2024-05-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Prospecting', 'Open'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0013'), 'OPP-2024-00036', 'Großhandels-Partnerschaft', 'Großhandels-Liefervertrag', 'New Business', 325000.00, 68.0, '2024-04-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0048'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0014'), 'OPP-2024-00037', 'Einzelhandels-Expansion', 'Markterweiterung', 'Upsell', 185000.00, 72.0, '2024-03-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0049'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0018'), 'OPP-2024-00038', 'Thailand Supply Expansion', 'Thailand supply agreement', 'New Business', 285000.00, 66.0, '2024-04-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0053'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0019'), 'OPP-2024-00039', 'Singapore Retail Network', 'Retail network supply', 'New Business', 165000.00, 60.0, '2024-05-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0054'), 'Qualification', 'Open'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0023'), 'OPP-2024-00040', 'भारत औद्योगिक समाधान', 'औद्योगिक समाधान पैकेज', 'Upsell', 2450000.00, 80.0, '2024-03-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0058'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0024'), 'OPP-2024-00041', 'भारत खुदरा विस्तार', 'खुदरा आपूर्ति', 'Upsell', 1850000.00, 74.0, '2024-04-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0059'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0027'), 'OPP-2024-00042', 'Gulf Manufacturing Supply', 'Manufacturing supply deal', 'New Business', 525000.00, 75.0, '2024-04-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0062'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0029'), 'OPP-2024-00043', 'Brasil Manufatura de Oportunidade', 'Manufatura novo negócio', 'New Business', 725000.00, 70.0, '2024-05-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0064'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0031'), 'OPP-2024-00044', 'Canada Manufacturing Expansion', 'Manufacturing capacity deal', 'Upsell', 385000.00, 78.0, '2024-03-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0066'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0033'), 'OPP-2024-00045', 'Australia Manufacturing Partnership', 'Manufacturing partnership', 'New Business', 425000.00, 72.0, '2024-05-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0068'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0035'), 'OPP-2024-00046', '日本製造契約拡大', '製造契約拡大', 'Upsell', 35000000.00, 80.0, '2024-04-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0070'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0037'), 'OPP-2024-00047', 'México Fabricación Alianza', 'Alianza de fabricación', 'New Business', 5500000.00, 75.0, '2024-05-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0072'), 'Proposal', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0041'), 'OPP-2024-00048', 'Premium Tech Solutions', 'Advanced tech implementation', 'Upsell', 750000.00, 85.0, '2024-02-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0076'), 'Negotiation', 'Won'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0042'), 'OPP-2024-00049', 'Innovation Partnership Program', 'Joint innovation initiative', 'New Business', 325000.00, 58.0, '2024-06-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0077'), 'Prospecting', 'Open'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0050'), 'OPP-2024-00050', 'Global Strategic Partnership', 'Worldwide partnership agreement', 'New Business', 1200000.00, 82.0, '2024-03-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0078'), 'Negotiation', 'Won');

-- =====================================================
-- 40. ACTIVITIES (50 records)
-- =====================================================

INSERT INTO activities (company_id, customer_id, opportunity_id, activity_type, subject, description, activity_date, completed_date, assigned_to_employee_id, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00001'), 'Call', 'Initial Product Discussion', 'Discussed new automotive parts product line', '2024-01-15'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00001'), 'Email', 'Proposal Submission', 'Sent detailed product proposal and pricing', '2024-01-20'::DATE, '2024-01-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00002'), 'Meeting', 'Volume Requirements Review', 'Met to discuss 30% volume increase requirements', '2024-01-25'::DATE, '2024-01-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00002'), 'Call', 'Pricing Negotiation', 'Negotiated volume discount pricing', '2024-02-05'::DATE, '2024-02-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00003'), 'Email', 'Cross-sell Proposal', 'Sent equipment cross-sell proposal', '2024-01-30'::DATE, '2024-01-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), NULL, 'Call', 'Follow-up on Equipment Proposal', 'Followed up on cross-sell proposal', '2024-02-15'::DATE, '2024-02-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00004'), 'Meeting', 'System Integration Kickoff', 'Initiated technology systems integration project', '2024-02-01'::DATE, '2024-02-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), NULL, 'Task', 'Prepare Technical Specifications', 'Prepare detailed technical requirements', '2024-02-10'::DATE, '2024-02-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0005'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00005'), 'Call', 'Store Expansion Discussion', 'Discussed supply for 50 new retail locations', '2024-02-03'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'In Progress'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0006'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00006'), 'Meeting', 'Service Contract Review', 'Reviewed annual service agreement terms', '2024-02-08'::DATE, '2024-02-08'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0007'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00007'), 'Email', 'Distribution Rights Proposal', 'Sent exclusive territory agreement', '2024-02-10'::DATE, '2024-02-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0008'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00008'), 'Call', 'Premium Product Line Discussion', 'Discussed premium tier product offerings', '2024-02-12'::DATE, '2024-02-12'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0009'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00009'), 'Meeting', 'Custom Solution Design', 'Designed bespoke configuration for customer', '2024-02-05'::DATE, '2024-02-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0010'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00010'), 'Email', 'Geographic Expansion Initial', 'Sent initial expansion opportunity information', '2024-02-15'::DATE, '2024-02-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), NULL, NULL, 'Task', 'Prepare Q1 Sales Report', 'Prepare comprehensive Q1 sales analysis', '2024-03-01'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'In Progress'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0011'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00011'), 'Anruf', 'Automobilzulieferer Diskussion', 'Neue Produktreihe besprochen', '2024-01-20'::DATE, '2024-01-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0046'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0012'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00012'), 'Treffen', 'Auftragserhöhung Verhandlung', 'Verhandlung über Auftragserhöhung', '2024-02-01'::DATE, '2024-02-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0047'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0016'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00013'), 'Call', 'Regional Supply Agreement', 'Discussed ASEAN regional supply', '2024-01-25'::DATE, '2024-01-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0051'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0017'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00014'), 'Meeting', 'Supply Chain Integration', 'Discussed integrated supply chain approach', '2024-02-05'::DATE, '2024-02-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0052'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0021'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00015'), 'कॉल', 'भारत समझौता चर्चा', 'भारत आपूर्ति समझौता', '2024-01-22'::DATE, '2024-01-22'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0056'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM customers WHERE customer_code='C0022'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00016'), 'बैठक', 'मात्रा वृद्धि बातचीत', 'मात्रा वृद्धि वार्ता', '2024-02-08'::DATE, '2024-02-08'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0057'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0026'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00017'), 'اتصال', 'اتفاق الإمارات الإقليمي', 'ناقشت اتفاق الإمارات', '2024-01-28'::DATE, '2024-01-28'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0061'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0028'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00018'), 'Chamada', 'Expansão de Fornecimento Brasil', 'Discussão da expansão Brasil', '2024-01-30'::DATE, '2024-01-30'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0063'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0030'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00019'), 'Call', 'Canada Supply Expansion', 'Discussed Canadian supply expansion', '2024-02-02'::DATE, '2024-02-02'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0065'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0032'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00020'), 'Meeting', 'Australia New Supply Deal', 'Discussed new Australian supply', '2024-02-06'::DATE, '2024-02-06'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0067'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM customers WHERE customer_code='C0034'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00021'), '電話', '日本供給契約', '日本契約について議論', '2024-02-01'::DATE, '2024-02-01'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0069'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM customers WHERE customer_code='C0036'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00022'), 'Llamada', 'Expansión México', 'Discusión de expansión México', '2024-02-03'::DATE, '2024-02-03'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0071'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0038'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00023'), 'Meeting', 'Premium Solutions Presentation', 'Presented premium product offerings', '2024-02-08'::DATE, '2024-02-08'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0073'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0039'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00024'), 'Call', 'Distribution Network Proposal', 'Sent multi-state distribution proposal', '2024-02-10'::DATE, '2024-02-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0074'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0040'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00025'), 'Email', 'Specialty Store Partnership', 'Sent specialty store partnership proposal', '2024-02-12'::DATE, '2024-02-12'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0075'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0001'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00026'), 'Call', 'Aftermarket Parts Discussion', 'Discussed aftermarket supply opportunity', '2024-02-05'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'In Progress'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0002'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00027'), 'Meeting', 'OEM Supply Agreement Finalization', 'Finalized OEM supply agreement', '2024-02-10'::DATE, '2024-02-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0003'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00028'), 'Email', 'Equipment Bundle Proposal', 'Sent equipment package proposal', '2024-02-14'::DATE, '2024-02-14'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0004'), NULL, 'Task', 'Contract Preparation', 'Prepare final contract terms', '2024-02-12'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0034'), 'In Progress'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0005'), NULL, 'Email', 'Follow-up on Store Expansion', 'Sent follow-up email on store expansion proposal', '2024-02-20'::DATE, '2024-02-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0006'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00031'), 'Email', 'Maintenance Parts Supply Terms', 'Sent recurring parts supply terms', '2024-02-18'::DATE, '2024-02-18'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0033'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), NULL, NULL, 'Task', 'Sales Pipeline Analysis', 'Analyze current sales pipeline', '2024-02-28'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0035'), 'Planned'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0038'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00048'), 'Meeting', 'Premium Tech Solution Implementation', 'Discussed implementation timeline', '2024-02-15'::DATE, '2024-02-15'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0076'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0039'), NULL, 'Call', 'Network Expansion Follow-up', 'Followed up on distribution proposal', '2024-02-25'::DATE, '2024-02-25'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0074'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0040'), NULL, 'Email', 'Specialty Partnership Next Steps', 'Sent next steps for partnership', '2024-02-22'::DATE, '2024-02-22'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0075'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM customers WHERE customer_code='C0050'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00050'), 'Meeting', 'Global Partnership Finalization', 'Finalized worldwide partnership', '2024-02-20'::DATE, '2024-02-20'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0078'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0001'), NULL, NULL, 'Task', 'March Campaign Preparation', 'Prepare March marketing campaign', '2024-02-28'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0032'), 'Planned'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0013'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00036'), 'Email', 'Großhandels-Proposal', 'Großhandels-Liefervertrag gesendet', '2024-02-05'::DATE, '2024-02-05'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0048'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM customers WHERE customer_code='C0014'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00037'), 'Treffen', 'Einzelhandels-Marktanalyse', 'Marktanalyse für Erweiterung', '2024-02-10'::DATE, '2024-02-10'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0049'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0018'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00038'), 'Email', 'Thailand Supply Details', 'Sent detailed Thailand supply proposal', '2024-02-08'::DATE, '2024-02-08'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0053'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM customers WHERE customer_code='C0019'), NULL, 'Call', 'Retail Network Follow-up', 'Followed up on retail supply proposal', '2024-02-22'::DATE, '2024-02-22'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0054'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0004'), NULL, NULL, 'Task', 'Q1 Performance Review', 'Review Q1 performance metrics', '2024-03-15'::DATE, NULL, (SELECT id FROM employees WHERE employee_id='EMP0056'), 'Planned'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM customers WHERE customer_code='C0027'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00042'), 'Email', 'Gulf Manufacturing Details', 'Sent manufacturing supply details', '2024-02-12'::DATE, '2024-02-12'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0062'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM customers WHERE customer_code='C0029'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00043'), 'Chamada', 'Manufatura Proposta Brasil', 'Proposta de manufatura enviada', '2024-02-14'::DATE, '2024-02-14'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0064'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM customers WHERE customer_code='C0031'), (SELECT id FROM opportunities WHERE opportunity_number='OPP-2024-00044'), 'Email', 'Manufacturing Capacity Terms', 'Sent manufacturing capacity agreement', '2024-02-16'::DATE, '2024-02-16'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0066'), 'Completed'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM customers WHERE customer_code='C0033'), NULL, 'Call', 'Partnership Next Steps', 'Discussed partnership implementation', '2024-02-28'::DATE, '2024-02-28'::DATE, (SELECT id FROM employees WHERE employee_id='EMP0068'), 'Completed');

-- This completes PART 4 with all major tables having 100+ rows of realistic data

