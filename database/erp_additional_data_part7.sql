-- =====================================================
-- ERP_DB Additional Sample Data - PART 7
-- Comprehensive billing, materials, and operations data
-- =====================================================

-- =====================================================
-- ADDITIONAL BILLING DOCUMENTS (50 more records)
-- =====================================================

INSERT INTO billing_documents (company_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date, total_amount, currency, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00051', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00041'), (SELECT id FROM customers WHERE customer_code='C0041'), '2024-03-15'::DATE, '2024-04-14'::DATE, 545000.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00052', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00042'), (SELECT id FROM customers WHERE customer_code='C0042'), '2024-03-20'::DATE, '2024-04-19'::DATE, 405000.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00053', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00043'), (SELECT id FROM customers WHERE customer_code='C0043'), '2024-03-25'::DATE, '2024-04-24'::DATE, 295500.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00054', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00044'), (SELECT id FROM customers WHERE customer_code='C0044'), '2024-03-28'::DATE, '2024-04-27'::DATE, 385000.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00055', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00045'), (SELECT id FROM customers WHERE customer_code='C0045'), '2024-04-02'::DATE, '2024-05-02'::DATE, 475000.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00056', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00046'), (SELECT id FROM customers WHERE customer_code='C0046'), '2024-04-08'::DATE, '2024-05-08'::DATE, 555000.00, 'USD', 'Paid'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00057', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00047'), (SELECT id FROM customers WHERE customer_code='C0047'), '2024-04-12'::DATE, '2024-05-12'::DATE, 425000.00, 'USD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00058', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00048'), (SELECT id FROM customers WHERE customer_code='C0048'), '2024-04-15'::DATE, '2024-05-15'::DATE, 325500.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00059', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00049'), (SELECT id FROM customers WHERE customer_code='C0049'), '2024-04-22'::DATE, '2024-05-22'::DATE, 445000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00060', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00050'), (SELECT id FROM customers WHERE customer_code='C0050'), '2024-04-28'::DATE, '2024-05-28'::DATE, 625000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00061', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00051'), (SELECT id FROM customers WHERE customer_code='C0013'), '2024-03-18'::DATE, '2024-04-17'::DATE, 335000.00, 'EUR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00062', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00052'), (SELECT id FROM customers WHERE customer_code='C0014'), '2024-03-25'::DATE, '2024-04-24'::DATE, 205000.00, 'EUR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00063', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00053'), (SELECT id FROM customers WHERE customer_code='C0015'), '2024-04-05'::DATE, '2024-05-05'::DATE, 365000.00, 'EUR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00064', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00054'), (SELECT id FROM customers WHERE customer_code='C0013'), '2024-04-12'::DATE, '2024-05-12'::DATE, 285000.00, 'EUR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00065', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00055'), (SELECT id FROM customers WHERE customer_code='C0014'), '2024-04-20'::DATE, '2024-05-20'::DATE, 365000.00, 'EUR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00066', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00056'), (SELECT id FROM customers WHERE customer_code='C0020'), '2024-03-18'::DATE, '2024-04-17'::DATE, 295000.00, 'SGD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00067', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00057'), (SELECT id FROM customers WHERE customer_code='C0016'), '2024-04-05'::DATE, '2024-05-05'::DATE, 385000.00, 'SGD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00068', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00058'), (SELECT id FROM customers WHERE customer_code='C0017'), '2024-04-08'::DATE, '2024-05-08'::DATE, 475000.00, 'SGD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00069', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00059'), (SELECT id FROM customers WHERE customer_code='C0018'), '2024-04-18'::DATE, '2024-05-18'::DATE, 325000.00, 'SGD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00070', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00060'), (SELECT id FROM customers WHERE customer_code='C0019'), '2024-05-05'::DATE, '2024-06-04'::DATE, 265000.00, 'SGD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00071', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00061'), (SELECT id FROM customers WHERE customer_code='C0025'), '2024-03-20'::DATE, '2024-04-19'::DATE, 2350000.00, 'INR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00072', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00062'), (SELECT id FROM customers WHERE customer_code='C0021'), '2024-04-05'::DATE, '2024-05-05'::DATE, 2950000.00, 'INR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00073', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00063'), (SELECT id FROM customers WHERE customer_code='C0022'), '2024-04-12'::DATE, '2024-05-12'::DATE, 3250000.00, 'INR', 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00074', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00064'), (SELECT id FROM customers WHERE customer_code='C0023'), '2024-04-22'::DATE, '2024-05-22'::DATE, 2550000.00, 'INR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00075', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00065'), (SELECT id FROM customers WHERE customer_code='C0024'), '2024-05-08'::DATE, '2024-06-07'::DATE, 1950000.00, 'INR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0005'), 'BILL-2024-00076', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00066'), (SELECT id FROM customers WHERE customer_code='C0027'), '2024-03-18'::DATE, '2024-04-17'::DATE, 525000.00, 'AED', 'Posted'),
((SELECT id FROM companies WHERE company_code='0005'), 'BILL-2024-00077', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00067'), (SELECT id FROM customers WHERE customer_code='C0026'), '2024-04-15'::DATE, '2024-05-15'::DATE, 365000.00, 'AED', 'Draft'),
((SELECT id FROM companies WHERE company_code='0006'), 'BILL-2024-00078', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00068'), (SELECT id FROM customers WHERE customer_code='C0029'), '2024-03-22'::DATE, '2024-04-21'::DATE, 735000.00, 'BRL', 'Posted'),
((SELECT id FROM companies WHERE company_code='0006'), 'BILL-2024-00079', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00069'), (SELECT id FROM customers WHERE customer_code='C0028'), '2024-04-18'::DATE, '2024-05-18'::DATE, 635000.00, 'BRL', 'Draft'),
((SELECT id FROM companies WHERE company_code='0007'), 'BILL-2024-00080', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00070'), (SELECT id FROM customers WHERE customer_code='C0031'), '2024-03-22'::DATE, '2024-04-21'::DATE, 385000.00, 'CAD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0007'), 'BILL-2024-00081', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00071'), (SELECT id FROM customers WHERE customer_code='C0030'), '2024-04-18'::DATE, '2024-05-18'::DATE, 295000.00, 'CAD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0008'), 'BILL-2024-00082', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00072'), (SELECT id FROM customers WHERE customer_code='C0033'), '2024-03-25'::DATE, '2024-04-24'::DATE, 425000.00, 'AUD', 'Posted'),
((SELECT id FROM companies WHERE company_code='0008'), 'BILL-2024-00083', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00073'), (SELECT id FROM customers WHERE customer_code='C0032'), '2024-04-18'::DATE, '2024-05-18'::DATE, 335000.00, 'AUD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0009'), 'BILL-2024-00084', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00074'), (SELECT id FROM customers WHERE customer_code='C0035'), '2024-04-12'::DATE, '2024-05-12'::DATE, 36000000.00, 'JPY', 'Posted'),
((SELECT id FROM companies WHERE company_code='0009'), 'BILL-2024-00085', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00075'), (SELECT id FROM customers WHERE customer_code='C0034'), '2024-05-08'::DATE, '2024-06-07'::DATE, 32000000.00, 'JPY', 'Draft'),
((SELECT id FROM companies WHERE company_code='0010'), 'BILL-2024-00086', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00076'), (SELECT id FROM customers WHERE customer_code='C0037'), '2024-03-28'::DATE, '2024-04-27'::DATE, 5500000.00, 'MXN', 'Posted'),
((SELECT id FROM companies WHERE company_code='0010'), 'BILL-2024-00087', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00077'), (SELECT id FROM customers WHERE customer_code='C0036'), '2024-04-25'::DATE, '2024-05-25'::DATE, 4750000.00, 'MXN', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00088', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00078'), (SELECT id FROM customers WHERE customer_code='C0001'), '2024-05-05'::DATE, '2024-06-04'::DATE, 285000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00089', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00079'), (SELECT id FROM customers WHERE customer_code='C0002'), '2024-05-10'::DATE, '2024-06-09'::DATE, 325500.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00090', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00080'), (SELECT id FROM customers WHERE customer_code='C0003'), '2024-05-15'::DATE, '2024-06-14'::DATE, 435000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00091', NULL, (SELECT id FROM customers WHERE customer_code='C0001'), '2024-05-18'::DATE, '2024-06-17'::DATE, 185000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00092', NULL, (SELECT id FROM customers WHERE customer_code='C0002'), '2024-05-22'::DATE, '2024-06-21'::DATE, 245000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'BILL-2024-00093', NULL, (SELECT id FROM customers WHERE customer_code='C0003'), '2024-05-25'::DATE, '2024-06-24'::DATE, 325000.00, 'USD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00094', NULL, (SELECT id FROM customers WHERE customer_code='C0013'), '2024-05-10'::DATE, '2024-06-09'::DATE, 185000.00, 'EUR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'BILL-2024-00095', NULL, (SELECT id FROM customers WHERE customer_code='C0014'), '2024-05-15'::DATE, '2024-06-14'::DATE, 265000.00, 'EUR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0003'), 'BILL-2024-00096', NULL, (SELECT id FROM customers WHERE customer_code='C0016'), '2024-05-08'::DATE, '2024-06-07'::DATE, 195000.00, 'SGD', 'Draft'),
((SELECT id FROM companies WHERE company_code='0004'), 'BILL-2024-00097', NULL, (SELECT id FROM customers WHERE customer_code='C0021'), '2024-05-12'::DATE, '2024-06-11'::DATE, 1450000.00, 'INR', 'Draft'),
((SELECT id FROM companies WHERE company_code='0005'), 'BILL-2024-00098', NULL, (SELECT id FROM customers WHERE customer_code='C0026'), '2024-05-10'::DATE, '2024-06-09'::DATE, 285000.00, 'AED', 'Draft'),
((SELECT id FROM companies WHERE company_code='0006'), 'BILL-2024-00099', NULL, (SELECT id FROM customers WHERE customer_code='C0028'), '2024-05-12'::DATE, '2024-06-11'::DATE, 425000.00, 'BRL', 'Draft'),
((SELECT id FROM companies WHERE company_code='0007'), 'BILL-2024-00100', NULL, (SELECT id FROM customers WHERE customer_code='C0030'), '2024-05-15'::DATE, '2024-06-14'::DATE, 185000.00, 'CAD', 'Draft');

-- =====================================================
-- ADDITIONAL COST ELEMENTS (40 more records)
-- =====================================================

INSERT INTO cost_elements (company_id, cost_element_code, cost_element_name, cost_element_type, is_active) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00051', 'Raw Materials Cost', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00052', 'Labor Cost Direct', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00053', 'Overhead Manufacturing', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00054', 'Depreciation Equipment', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00055', 'Utilities Manufacturing', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00056', 'Maintenance Labor', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00057', 'Supplies Consumable', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00058', 'Logistics Cost', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00059', 'Quality Testing', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0001'), 'CE-00060', 'Packaging Materials', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0002'), 'CE-00061', 'Rohstoffe Kosten', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0002'), 'CE-00062', 'Arbeitskosten Direkt', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0002'), 'CE-00063', 'Fertigungsgemeinkosten', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0002'), 'CE-00064', 'Abschreibung Ausrüstung', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0002'), 'CE-00065', 'Betriebsnebenkosten', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0003'), 'CE-00066', 'Raw Materials SG', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0003'), 'CE-00067', 'Direct Labor SG', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0003'), 'CE-00068', 'Factory Overhead SG', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0003'), 'CE-00069', 'Equipment Depreciation SG', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0003'), 'CE-00070', 'Utilities SG', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0004'), 'CE-00071', 'कच्चे माल की लागत', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0004'), 'CE-00072', 'प्रत्यक्ष श्रम लागत', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0004'), 'CE-00073', 'निर्माण ओवरहेड', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0004'), 'CE-00074', 'उपकरण मूल्यह्रास', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0004'), 'CE-00075', 'उपयोगिता निर्माण', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0005'), 'CE-00076', 'تكاليف المواد الخام', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0005'), 'CE-00077', 'تكاليف العمالة المباشرة', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0005'), 'CE-00078', 'النفقات العامة للتصنيع', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0005'), 'CE-00079', 'استهلاك المعدات', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0006'), 'CE-00080', 'Custos de Matérias Primas', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0006'), 'CE-00081', 'Custos de Mão de Obra Direta', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0006'), 'CE-00082', 'Despesas Gerais de Manufatura', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0006'), 'CE-00083', 'Depreciação de Equipamentos', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0007'), 'CE-00084', 'Raw Materials Canada', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0007'), 'CE-00085', 'Direct Labor Canada', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0007'), 'CE-00086', 'Manufacturing Overhead CA', 'Secondary', true),
((SELECT id FROM companies WHERE company_code='0008'), 'CE-00087', 'Raw Materials AU', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0009'), 'CE-00088', '原材料コスト', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0009'), 'CE-00089', '直接労働コスト', 'Primary', true),
((SELECT id FROM companies WHERE company_code='0010'), 'CE-00090', 'Costos de Materias Primas', 'Primary', true);

-- =====================================================
-- ADDITIONAL INTERNAL ORDERS (30 more records)
-- =====================================================

INSERT INTO internal_orders (company_id, order_number, order_type, description, cost_center_id, budget_amount, actual_cost, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00031', 'Maintenance', 'Equipment maintenance program', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 150000.00, 85000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00032', 'Training', 'Staff training initiative', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 75000.00, 45000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00033', 'Upgrade', 'System upgrade project', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 250000.00, 180000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00034', 'Repair', 'Machine repair project', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 85000.00, 62000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00035', 'Safety', 'Safety improvement program', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 125000.00, 95000.00, 'Submitted'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00036', 'Cleaning', 'Facility cleaning service', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 35000.00, 28000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00037', 'Testing', 'Quality testing program', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 95000.00, 75000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00038', 'Relocation', 'Department relocation', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 180000.00, 145000.00, 'Submitted'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00039', 'Expansion', 'Facility expansion', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 450000.00, 325000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00040', 'Renovation', 'Office renovation', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 225000.00, 165000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'IO-2024-00041', 'Wartung', 'Ausrüstungswartung', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0002') LIMIT 1), 140000.00, 95000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0002'), 'IO-2024-00042', 'Schulung', 'Mitarbeiterschulung', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0002') LIMIT 1), 80000.00, 52000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0002'), 'IO-2024-00043', 'Upgrade', 'Systemupgrade', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0002') LIMIT 1), 260000.00, 195000.00, 'Submitted'),
((SELECT id FROM companies WHERE company_code='0003'), 'IO-2024-00044', 'Maintenance SG', 'Maintenance Program SG', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0003') LIMIT 1), 160000.00, 105000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0003'), 'IO-2024-00045', 'Training SG', 'Training Initiative SG', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0003') LIMIT 1), 85000.00, 55000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0004'), 'IO-2024-00046', 'रखरखाव', 'उपकरण रखरखाव', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0004') LIMIT 1), 1250000.00, 850000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0004'), 'IO-2024-00047', 'प्रशिक्षण', 'कर्मचारी प्रशिक्षण', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0004') LIMIT 1), 650000.00, 425000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0005'), 'IO-2024-00048', 'الصيانة', 'برنامج صيانة المعدات', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0005') LIMIT 1), 185000.00, 125000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0005'), 'IO-2024-00049', 'التدريب', 'مبادرة تدريب الموظفين', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0005') LIMIT 1), 95000.00, 62000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0006'), 'IO-2024-00050', 'Manutenção', 'Programa de Manutenção', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0006') LIMIT 1), 195000.00, 135000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0007'), 'IO-2024-00051', 'Maintenance CA', 'Equipment Maintenance', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0007') LIMIT 1), 155000.00, 105000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0008'), 'IO-2024-00052', 'Maintenance AU', 'Maintenance Program AU', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0008') LIMIT 1), 165000.00, 115000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0009'), 'IO-2024-00053', 'メンテナンス', 'メンテナンスプログラム', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0009') LIMIT 1), 1850000.00, 1250000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0010'), 'IO-2024-00054', 'Mantenimiento', 'Programa de Mantenimiento', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0010') LIMIT 1), 250000.00, 175000.00, 'Released'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00055', 'Certification', 'ISO certification audit', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 65000.00, 48000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), 'IO-2024-00056', 'Inspection', 'Third party inspection', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0001') LIMIT 1), 45000.00, 32000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), 'IO-2024-00057', 'Zertifizierung', 'ISO Zertifizierungsprüfung', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0002') LIMIT 1), 70000.00, 52000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0003'), 'IO-2024-00058', 'Certification SG', 'ISO Certification Audit', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0003') LIMIT 1), 60000.00, 44000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0004'), 'IO-2024-00059', 'प्रमाणन', 'ISO प्रमाणन ऑडिट', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0004') LIMIT 1), 525000.00, 385000.00, 'Draft'),
((SELECT id FROM companies WHERE company_code='0005'), 'IO-2024-00060', 'الشهادة', 'تدقيق شهادة ISO', (SELECT id FROM cost_centers WHERE company_id = (SELECT id FROM companies WHERE company_code='0005') LIMIT 1), 75000.00, 55000.00, 'Draft');

-- =====================================================
-- ADDITIONAL PURCHASE ORDER ITEMS (80 more records via generate)
-- =====================================================

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity_ordered, quantity_received, unit_price, line_amount, line_item_number)
SELECT 
  po.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  50 + (ABS(HASHTEXT(po.po_number || 'qty')) % 150),
  (50 + (ABS(HASHTEXT(po.po_number || 'qty')) % 150)) * CASE WHEN po.status = 'Released' THEN 0.8 WHEN po.status = 'Partially Received' THEN 0.5 ELSE 0 END,
  100 + (ABS(HASHTEXT(po.po_number || 'price')) % 500),
  (50 + (ABS(HASHTEXT(po.po_number || 'qty')) % 150)) * (100 + (ABS(HASHTEXT(po.po_number || 'price')) % 500)),
  1
FROM purchase_orders po
WHERE po.po_number BETWEEN 'PO-2024-00041' AND 'PO-2024-00080'
LIMIT 40;

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity_ordered, quantity_received, unit_price, line_amount, line_item_number)
SELECT 
  po.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0006','MAT0007','MAT0008','MAT0009','MAT0010') ORDER BY RANDOM() LIMIT 1),
  75 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 150),
  (75 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 150)) * CASE WHEN po.status = 'Released' THEN 0.6 WHEN po.status = 'Partially Received' THEN 0.3 ELSE 0 END,
  150 + (ABS(HASHTEXT(po.po_number || 'price2')) % 600),
  (75 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 150)) * (150 + (ABS(HASHTEXT(po.po_number || 'price2')) % 600)),
  2
FROM purchase_orders po
WHERE po.po_number BETWEEN 'PO-2024-00041' AND 'PO-2024-00080'
LIMIT 40;

-- =====================================================
-- ADDITIONAL SALES ORDER ITEMS (80 more records)
-- =====================================================

INSERT INTO sales_order_items (sales_order_id, material_id, quantity_ordered, quantity_delivered, unit_price, line_amount, line_item_number)
SELECT 
  so.id,
  (SELECT id FROM materials WHERE material_code IN ('FG0001','FG0002','FG0003','FG0004','FG0005') ORDER BY RANDOM() LIMIT 1),
  35 + (ABS(HASHTEXT(so.sales_order_number || 'qty')) % 100),
  (35 + (ABS(HASHTEXT(so.sales_order_number || 'qty')) % 100)) * CASE WHEN so.status = 'Confirmed' THEN 0.7 ELSE 0 END,
  500 + (ABS(HASHTEXT(so.sales_order_number || 'price')) % 2000),
  (35 + (ABS(HASHTEXT(so.sales_order_number || 'qty')) % 100)) * (500 + (ABS(HASHTEXT(so.sales_order_number || 'price')) % 2000)),
  1
FROM sales_orders so
WHERE so.sales_order_number BETWEEN 'SO-2024-00041' AND 'SO-2024-00080'
LIMIT 40;

INSERT INTO sales_order_items (sales_order_id, material_id, quantity_ordered, quantity_delivered, unit_price, line_amount, line_item_number)
SELECT 
  so.id,
  (SELECT id FROM materials WHERE material_code IN ('FG0006','FG0007','FG0008','FG0009','FG0010') ORDER BY RANDOM() LIMIT 1),
  50 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 150),
  (50 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 150)) * CASE WHEN so.status = 'Confirmed' THEN 0.5 ELSE 0 END,
  600 + (ABS(HASHTEXT(so.sales_order_number || 'price2')) % 2500),
  (50 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 150)) * (600 + (ABS(HASHTEXT(so.sales_order_number || 'price2')) % 2500)),
  2
FROM sales_orders so
WHERE so.sales_order_number BETWEEN 'SO-2024-00041' AND 'SO-2024-00080'
LIMIT 40;

-- =====================================================
-- END OF PART 7 - Summary
-- =====================================================
-- Total Additional Records in PART 7:
-- - Billing Documents: 50
-- - Cost Elements: 40
-- - Internal Orders: 30
-- - Purchase Order Items: 80
-- - Sales Order Items: 80
-- = 280 additional records
-- 
-- CUMULATIVE DATA SO FAR (All Parts):
-- - Invoices: 150+
-- - Purchase Orders: 120+
-- - Sales Orders: 120+
-- - Production Orders: 70+
-- - Billing Documents: 100+
-- - Opportunities: 80+
-- - Employees: 100
-- - + All other modules with 100+ rows each
-- 
-- =====================================================
