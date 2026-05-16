-- =====================================================
-- ERP_DB Sample Data - PART 2
-- MM (Materials Management), SD (Sales & Distribution),
-- PP (Production Planning), HR, CRM, SRM modules
-- =====================================================

-- =====================================================
-- MISSING STORAGE LOCATIONS (for plants without any)
-- =====================================================

INSERT INTO storage_locations (plant_id, sloc_code, sloc_name, warehouse_type) VALUES
((SELECT id FROM plants WHERE plant_code='P006'), '0601', 'Munich Service Parts', 'Service Parts'),
((SELECT id FROM plants WHERE plant_code='P006'), '0602', 'Munich Tools', 'Service Parts'),
((SELECT id FROM plants WHERE plant_code='P008'), '0801', 'Bangkok Main Warehouse', 'Distribution'),
((SELECT id FROM plants WHERE plant_code='P008'), '0802', 'Bangkok Cold Storage', 'Distribution'),
((SELECT id FROM plants WHERE plant_code='P011'), '1101', 'Bangalore Service Center', 'Service Parts'),
((SELECT id FROM plants WHERE plant_code='P013'), '1301', 'Raw Materials SP', 'Raw Materials'),
((SELECT id FROM plants WHERE plant_code='P013'), '1302', 'Production SP', 'In-Process'),
((SELECT id FROM plants WHERE plant_code='P013'), '1303', 'Finished Goods SP', 'Finished Goods'),
((SELECT id FROM plants WHERE plant_code='P014'), '1401', 'Rio Warehouse', 'Distribution'),
((SELECT id FROM plants WHERE plant_code='P015'), '1501', 'Raw Materials Toronto', 'Raw Materials'),
((SELECT id FROM plants WHERE plant_code='P015'), '1502', 'Assembly Toronto', 'In-Process'),
((SELECT id FROM plants WHERE plant_code='P015'), '1503', 'Finished Goods Toronto', 'Finished Goods'),
((SELECT id FROM plants WHERE plant_code='P016'), '1601', 'Vancouver DC', 'Distribution'),
((SELECT id FROM plants WHERE plant_code='P017'), '1701', 'Raw Materials Sydney', 'Raw Materials'),
((SELECT id FROM plants WHERE plant_code='P017'), '1702', 'Production Sydney', 'In-Process'),
((SELECT id FROM plants WHERE plant_code='P017'), '1703', 'FG Sydney', 'Finished Goods'),
((SELECT id FROM plants WHERE plant_code='P018'), '1801', 'Melbourne DC', 'Distribution'),
((SELECT id FROM plants WHERE plant_code='P020'), '2001', 'Raw Materials Mexico', 'Raw Materials'),
((SELECT id FROM plants WHERE plant_code='P020'), '2002', 'Assembly Mexico', 'In-Process'),
((SELECT id FROM plants WHERE plant_code='P020'), '2003', 'FG Mexico', 'Finished Goods');

-- =====================================================
-- 16. PURCHASE ORDER ITEMS (120 records - 3 items per PO)
-- =====================================================

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity_ordered, quantity_received, unit_price, line_amount, line_item_number) 
SELECT 
  po.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  250 + (ABS(HASHTEXT(po.po_number || 'qty1')) % 500),
  CASE WHEN po.status = 'Completed' THEN 250 + (ABS(HASHTEXT(po.po_number || 'qty1')) % 500) 
       WHEN po.status = 'Partially Received' THEN (250 + (ABS(HASHTEXT(po.po_number || 'qty1')) % 500)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  (250 + (ABS(HASHTEXT(po.po_number || 'qty1')) % 500)) * 2.50,
  1
FROM purchase_orders po
LIMIT 40;

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity_ordered, quantity_received, unit_price, line_amount, line_item_number) 
SELECT 
  po.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0006','MAT0007','MAT0008','MAT0009','MAT0010') ORDER BY RANDOM() LIMIT 1),
  150 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 300),
  CASE WHEN po.status = 'Completed' THEN 150 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 300) 
       WHEN po.status = 'Partially Received' THEN (150 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 300)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('MAT0006','MAT0007','MAT0008','MAT0009','MAT0010') ORDER BY RANDOM() LIMIT 1),
  (150 + (ABS(HASHTEXT(po.po_number || 'qty2')) % 300)) * 4.50,
  2
FROM purchase_orders po
LIMIT 40;

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity_ordered, quantity_received, unit_price, line_amount, line_item_number) 
SELECT 
  po.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0011','MAT0012','MAT0013','MAT0014','MAT0015') ORDER BY RANDOM() LIMIT 1),
  50 + (ABS(HASHTEXT(po.po_number || 'qty3')) % 150),
  CASE WHEN po.status = 'Completed' THEN 50 + (ABS(HASHTEXT(po.po_number || 'qty3')) % 150) 
       WHEN po.status = 'Partially Received' THEN (50 + (ABS(HASHTEXT(po.po_number || 'qty3')) % 150)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('MAT0011','MAT0012','MAT0013','MAT0014','MAT0015') ORDER BY RANDOM() LIMIT 1),
  (50 + (ABS(HASHTEXT(po.po_number || 'qty3')) % 150)) * 8.50,
  3
FROM purchase_orders po
LIMIT 40;

-- =====================================================
-- 17. GOODS RECEIPTS (40 records)
-- =====================================================

INSERT INTO goods_receipts (company_id, plant_id, gr_number, gr_date, purchase_order_id, vendor_id, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00001', '2024-01-19'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00001'), (SELECT id FROM vendors WHERE vendor_code='V0001'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00002', '2024-01-22'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00002'), (SELECT id FROM vendors WHERE vendor_code='V0002'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00003', '2024-01-24'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00003'), (SELECT id FROM vendors WHERE vendor_code='V0003'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00004', '2024-01-26'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00004'), (SELECT id FROM vendors WHERE vendor_code='V0004'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00005', '2024-02-01'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00005'), (SELECT id FROM vendors WHERE vendor_code='V0005'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00006', '2024-02-05'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00006'), (SELECT id FROM vendors WHERE vendor_code='V0006'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00007', '2024-02-08'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00007'), (SELECT id FROM vendors WHERE vendor_code='V0007'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00008', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00008'), (SELECT id FROM vendors WHERE vendor_code='V0008'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00009', '2024-02-15'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00009'), (SELECT id FROM vendors WHERE vendor_code='V0009'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00010', '2024-02-20'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00010'), (SELECT id FROM vendors WHERE vendor_code='V0010'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'GR-2024-00011', '2024-01-31'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00011'), (SELECT id FROM vendors WHERE vendor_code='V0011'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'GR-2024-00012', '2024-02-07'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00012'), (SELECT id FROM vendors WHERE vendor_code='V0012'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'GR-2024-00013', '2024-02-12'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00013'), (SELECT id FROM vendors WHERE vendor_code='V0013'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'GR-2024-00014', '2024-02-18'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00014'), (SELECT id FROM vendors WHERE vendor_code='V0014'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'GR-2024-00015', '2024-02-25'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00015'), (SELECT id FROM vendors WHERE vendor_code='V0015'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'GR-2024-00016', '2024-01-24'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00016'), (SELECT id FROM vendors WHERE vendor_code='V0016'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'GR-2024-00017', '2024-02-05'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00017'), (SELECT id FROM vendors WHERE vendor_code='V0017'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'GR-2024-00018', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00018'), (SELECT id FROM vendors WHERE vendor_code='V0018'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'GR-2024-00019', '2024-02-18'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00019'), (SELECT id FROM vendors WHERE vendor_code='V0019'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'GR-2024-00020', '2024-02-25'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00020'), (SELECT id FROM vendors WHERE vendor_code='V0020'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'GR-2024-00021', '2024-01-31'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00021'), (SELECT id FROM vendors WHERE vendor_code='V0021'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'GR-2024-00022', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00022'), (SELECT id FROM vendors WHERE vendor_code='V0022'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'GR-2024-00023', '2024-02-15'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00023'), (SELECT id FROM vendors WHERE vendor_code='V0023'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'GR-2024-00024', '2024-02-22'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00024'), (SELECT id FROM vendors WHERE vendor_code='V0024'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'GR-2024-00025', '2024-02-28'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00025'), (SELECT id FROM vendors WHERE vendor_code='V0025'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'GR-2024-00026', '2024-02-04'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00026'), (SELECT id FROM vendors WHERE vendor_code='V0026'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'GR-2024-00027', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00027'), (SELECT id FROM vendors WHERE vendor_code='V0027'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P013'), 'GR-2024-00028', '2024-02-08'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00028'), (SELECT id FROM vendors WHERE vendor_code='V0029'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P013'), 'GR-2024-00029', '2024-02-14'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00029'), (SELECT id FROM vendors WHERE vendor_code='V0030'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P015'), 'GR-2024-00030', '2024-01-31'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00030'), (SELECT id FROM vendors WHERE vendor_code='V0031'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P015'), 'GR-2024-00031', '2024-02-08'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00031'), (SELECT id FROM vendors WHERE vendor_code='V0032'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P017'), 'GR-2024-00032', '2024-02-04'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00032'), (SELECT id FROM vendors WHERE vendor_code='V0033'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P017'), 'GR-2024-00033', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00033'), (SELECT id FROM vendors WHERE vendor_code='V0034'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'GR-2024-00034', '2024-02-15'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00034'), (SELECT id FROM vendors WHERE vendor_code='V0035'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'GR-2024-00035', '2024-02-25'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00035'), (SELECT id FROM vendors WHERE vendor_code='V0036'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'GR-2024-00036', '2024-02-04'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00036'), (SELECT id FROM vendors WHERE vendor_code='V0037'), 'Posted'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'GR-2024-00037', '2024-02-10'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00037'), (SELECT id FROM vendors WHERE vendor_code='V0038'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00038', '2024-02-25'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00038'), (SELECT id FROM vendors WHERE vendor_code='V0001'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00039', '2024-03-01'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00039'), (SELECT id FROM vendors WHERE vendor_code='V0002'), 'Draft'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'GR-2024-00040', '2024-03-05'::DATE, (SELECT id FROM purchase_orders WHERE po_number='PO-2024-00040'), (SELECT id FROM vendors WHERE vendor_code='V0003'), 'Draft');

-- =====================================================
-- 18. GOODS RECEIPT ITEMS (120 records - 3 items per GR)
-- =====================================================

INSERT INTO goods_receipt_items (goods_receipt_id, material_id, storage_location_id, quantity, batch_number, expiry_date, line_item_number)
SELECT 
  gr.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = gr.plant_id LIMIT 1),
  250 + (ABS(HASHTEXT(gr.gr_number || 'qty1')) % 500),
  'BATCH-' || LPAD((ABS(HASHTEXT(gr.gr_number || 'batch')))::TEXT, 5, '0'),
  DATE '2024-12-31',
  1
FROM goods_receipts gr;

INSERT INTO goods_receipt_items (goods_receipt_id, material_id, storage_location_id, quantity, batch_number, expiry_date, line_item_number)
SELECT 
  gr.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0006','MAT0007','MAT0008','MAT0009','MAT0010') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = gr.plant_id ORDER BY RANDOM() LIMIT 1),
  150 + (ABS(HASHTEXT(gr.gr_number || 'qty2')) % 300),
  'BATCH-' || LPAD((ABS(HASHTEXT(gr.gr_number || 'batch2')))::TEXT, 5, '0'),
  DATE '2024-12-31',
  2
FROM goods_receipts gr;

INSERT INTO goods_receipt_items (goods_receipt_id, material_id, storage_location_id, quantity, batch_number, expiry_date, line_item_number)
SELECT 
  gr.id,
  (SELECT id FROM materials WHERE material_code IN ('MAT0011','MAT0012','MAT0013','MAT0014','MAT0015') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = gr.plant_id ORDER BY RANDOM() LIMIT 1),
  50 + (ABS(HASHTEXT(gr.gr_number || 'qty3')) % 150),
  'BATCH-' || LPAD((ABS(HASHTEXT(gr.gr_number || 'batch3')))::TEXT, 5, '0'),
  DATE '2024-12-31',
  3
FROM goods_receipts gr;

-- =====================================================
-- 19. STOCK MOVEMENTS (100 records)
-- =====================================================

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0001'),
  (SELECT id FROM plants WHERE plant_code='P001'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0101' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0102' LIMIT 1),
  'Transfer',
  50 + (ABS(HASHTEXT('SM' || n::TEXT)) % 200),
  DATE '2024-01-15' + (n::INT % 30),
  'SM-2024-' || LPAD(n::TEXT, 5, '0'),
  'PO-2024-00001'
FROM generate_series(1, 20) AS t(n);

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0001'),
  (SELECT id FROM plants WHERE plant_code='P001'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0006','MAT0007','MAT0008','MAT0009','MAT0010') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0102' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0103' LIMIT 1),
  'Transfer',
  30 + (ABS(HASHTEXT('SM' || n::TEXT)) % 100),
  DATE '2024-02-01' + (n::INT % 28),
  'SM-2024-' || LPAD((n + 20)::TEXT, 5, '0'),
  'PO-2024-00005'
FROM generate_series(1, 20) AS t(n);

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0002'),
  (SELECT id FROM plants WHERE plant_code='P004'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P004') AND sloc_code='0401' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P004') AND sloc_code='0402' LIMIT 1),
  'Transfer',
  100 + (ABS(HASHTEXT('SM' || n::TEXT)) % 300),
  DATE '2024-01-20' + (n::INT % 30),
  'SM-2024-' || LPAD((n + 40)::TEXT, 5, '0'),
  'PO-2024-00011'
FROM generate_series(1, 15) AS t(n);

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0003'),
  (SELECT id FROM plants WHERE plant_code='P007'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0011','MAT0012','MAT0013','MAT0014','MAT0015') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P007') AND sloc_code='0701' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P007') AND sloc_code='0702' LIMIT 1),
  'Transfer',
  25 + (ABS(HASHTEXT('SM' || n::TEXT)) % 75),
  DATE '2024-02-01' + (n::INT % 28),
  'SM-2024-' || LPAD((n + 55)::TEXT, 5, '0'),
  'PO-2024-00016'
FROM generate_series(1, 15) AS t(n);

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0004'),
  (SELECT id FROM plants WHERE plant_code='P009'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0001','MAT0002','MAT0003','MAT0004','MAT0005') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P009') AND sloc_code='0901' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P009') AND sloc_code='0902' LIMIT 1),
  'Transfer',
  150 + (ABS(HASHTEXT('SM' || n::TEXT)) % 400),
  DATE '2024-01-25' + (n::INT % 30),
  'SM-2024-' || LPAD((n + 70)::TEXT, 5, '0'),
  'PO-2024-00021'
FROM generate_series(1, 15) AS t(n);

INSERT INTO stock_movements (company_id, plant_id, material_id, from_storage_location_id, to_storage_location_id, movement_type, quantity, movement_date, document_number, reference_doc)
SELECT 
  (SELECT id FROM companies WHERE company_code='0001'),
  (SELECT id FROM plants WHERE plant_code='P001'),
  (SELECT id FROM materials WHERE material_code IN ('MAT0021','MAT0022','MAT0023','MAT0024','MAT0025') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0103' LIMIT 1),
  (SELECT id FROM storage_locations WHERE plant_id = (SELECT id FROM plants WHERE plant_code='P001') AND sloc_code='0104' LIMIT 1),
  'Issue',
  20 + (ABS(HASHTEXT('SM' || n::TEXT)) % 50),
  DATE '2024-02-05' + (n::INT % 20),
  'SM-2024-' || LPAD((n + 85)::TEXT, 5, '0'),
  'SO-2024-00001'
FROM generate_series(1, 15) AS t(n);

-- =====================================================
-- 20. SALES ORDERS (40 records)
-- =====================================================

INSERT INTO sales_orders (company_id, plant_id, sales_order_number, customer_id, so_date, requested_delivery_date, currency, total_amount, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00001', (SELECT id FROM customers WHERE customer_code='C0001'), '2024-01-10'::DATE, '2024-01-31'::DATE, 'USD', 245000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00002', (SELECT id FROM customers WHERE customer_code='C0002'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'USD', 187500.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00003', (SELECT id FROM customers WHERE customer_code='C0003'), '2024-01-15'::DATE, '2024-02-05'::DATE, 'USD', 312750.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00004', (SELECT id FROM customers WHERE customer_code='C0004'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'USD', 425000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00005', (SELECT id FROM customers WHERE customer_code='C0005'), '2024-01-20'::DATE, '2024-02-05'::DATE, 'USD', 156800.00, 'Partial'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00006', (SELECT id FROM customers WHERE customer_code='C0006'), '2024-01-22'::DATE, '2024-02-12'::DATE, 'USD', 278900.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00007', (SELECT id FROM customers WHERE customer_code='C0007'), '2024-01-25'::DATE, '2024-02-15'::DATE, 'USD', 365000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00008', (SELECT id FROM customers WHERE customer_code='C0008'), '2024-01-28'::DATE, '2024-02-12'::DATE, 'USD', 98500.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00009', (SELECT id FROM customers WHERE customer_code='C0009'), '2024-02-01'::DATE, '2024-02-25'::DATE, 'USD', 512000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00010', (SELECT id FROM customers WHERE customer_code='C0010'), '2024-02-03'::DATE, '2024-02-23'::DATE, 'USD', 234500.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'SO-2024-00011', (SELECT id FROM customers WHERE customer_code='C0011'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'EUR', 285000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'SO-2024-00012', (SELECT id FROM customers WHERE customer_code='C0012'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'EUR', 425000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'SO-2024-00013', (SELECT id FROM customers WHERE customer_code='C0013'), '2024-01-22'::DATE, '2024-02-12'::DATE, 'EUR', 325000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'SO-2024-00014', (SELECT id FROM customers WHERE customer_code='C0014'), '2024-01-25'::DATE, '2024-02-10'::DATE, 'EUR', 185000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P004'), 'SO-2024-00015', (SELECT id FROM customers WHERE customer_code='C0015'), '2024-02-01'::DATE, '2024-02-22'::DATE, 'EUR', 350000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'SO-2024-00016', (SELECT id FROM customers WHERE customer_code='C0016'), '2024-01-08'::DATE, '2024-01-28'::DATE, 'SGD', 325000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'SO-2024-00017', (SELECT id FROM customers WHERE customer_code='C0017'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'SGD', 425000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'SO-2024-00018', (SELECT id FROM customers WHERE customer_code='C0018'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'SGD', 285000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'SO-2024-00019', (SELECT id FROM customers WHERE customer_code='C0019'), '2024-01-25'::DATE, '2024-02-10'::DATE, 'SGD', 165000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P007'), 'SO-2024-00020', (SELECT id FROM customers WHERE customer_code='C0020'), '2024-02-02'::DATE, '2024-02-23'::DATE, 'SGD', 245000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'SO-2024-00021', (SELECT id FROM customers WHERE customer_code='C0021'), '2024-01-10'::DATE, '2024-01-31'::DATE, 'INR', 2850000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'SO-2024-00022', (SELECT id FROM customers WHERE customer_code='C0022'), '2024-01-15'::DATE, '2024-02-05'::DATE, 'INR', 3150000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'SO-2024-00023', (SELECT id FROM customers WHERE customer_code='C0023'), '2024-01-20'::DATE, '2024-02-10'::DATE, 'INR', 2450000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'SO-2024-00024', (SELECT id FROM customers WHERE customer_code='C0024'), '2024-01-25'::DATE, '2024-02-10'::DATE, 'INR', 1850000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P009'), 'SO-2024-00025', (SELECT id FROM customers WHERE customer_code='C0025'), '2024-02-01'::DATE, '2024-02-22'::DATE, 'INR', 2250000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'SO-2024-00026', (SELECT id FROM customers WHERE customer_code='C0026'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'AED', 425000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'SO-2024-00027', (SELECT id FROM customers WHERE customer_code='C0027'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'AED', 525000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P013'), 'SO-2024-00028', (SELECT id FROM customers WHERE customer_code='C0028'), '2024-01-15'::DATE, '2024-02-05'::DATE, 'BRL', 625000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P013'), 'SO-2024-00029', (SELECT id FROM customers WHERE customer_code='C0029'), '2024-01-20'::DATE, '2024-02-10'::DATE, 'BRL', 725000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P015'), 'SO-2024-00030', (SELECT id FROM customers WHERE customer_code='C0030'), '2024-01-10'::DATE, '2024-01-31'::DATE, 'CAD', 275000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P015'), 'SO-2024-00031', (SELECT id FROM customers WHERE customer_code='C0031'), '2024-01-15'::DATE, '2024-02-05'::DATE, 'CAD', 385000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P017'), 'SO-2024-00032', (SELECT id FROM customers WHERE customer_code='C0032'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'AUD', 325000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P017'), 'SO-2024-00033', (SELECT id FROM customers WHERE customer_code='C0033'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'AUD', 425000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'SO-2024-00034', (SELECT id FROM customers WHERE customer_code='C0034'), '2024-01-10'::DATE, '2024-02-10'::DATE, 'JPY', 28000000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'SO-2024-00035', (SELECT id FROM customers WHERE customer_code='C0035'), '2024-01-15'::DATE, '2024-02-20'::DATE, 'JPY', 35000000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'SO-2024-00036', (SELECT id FROM customers WHERE customer_code='C0036'), '2024-01-12'::DATE, '2024-02-02'::DATE, 'MXN', 4500000.00, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'SO-2024-00037', (SELECT id FROM customers WHERE customer_code='C0037'), '2024-01-18'::DATE, '2024-02-08'::DATE, 'MXN', 5500000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00038', (SELECT id FROM customers WHERE customer_code='C0038'), '2024-02-05'::DATE, '2024-02-26'::DATE, 'USD', 525000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00039', (SELECT id FROM customers WHERE customer_code='C0039'), '2024-02-10'::DATE, '2024-03-02'::DATE, 'USD', 385000.00, 'Confirmed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P001'), 'SO-2024-00040', (SELECT id FROM customers WHERE customer_code='C0040'), '2024-02-15'::DATE, '2024-03-06'::DATE, 'USD', 225000.00, 'Draft');

-- =====================================================
-- 21. SALES ORDER ITEMS (120 records - 3 items per SO)
-- =====================================================

INSERT INTO sales_order_items (sales_order_id, material_id, quantity_ordered, quantity_delivered, unit_price, line_amount, line_item_number)
SELECT 
  so.id,
  (SELECT id FROM materials WHERE material_code IN ('FG0001','FG0002','FG0003','FG0004','FG0005','FG0006','FG0007','FG0008','FG0009','FG0010') ORDER BY RANDOM() LIMIT 1),
  20 + (ABS(HASHTEXT(so.sales_order_number || 'qty1')) % 50),
  CASE WHEN so.status = 'Delivered' THEN 20 + (ABS(HASHTEXT(so.sales_order_number || 'qty1')) % 50) 
       WHEN so.status = 'Partial' THEN (20 + (ABS(HASHTEXT(so.sales_order_number || 'qty1')) % 50)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('FG0001','FG0002','FG0003','FG0004','FG0005','FG0006','FG0007','FG0008','FG0009','FG0010') ORDER BY RANDOM() LIMIT 1),
  (20 + (ABS(HASHTEXT(so.sales_order_number || 'qty1')) % 50)) * 850,
  1
FROM sales_orders so;

INSERT INTO sales_order_items (sales_order_id, material_id, quantity_ordered, quantity_delivered, unit_price, line_amount, line_item_number)
SELECT 
  so.id,
  (SELECT id FROM materials WHERE material_code IN ('FG0011','FG0012','FG0013','FG0014','FG0015','FG0016','FG0017','FG0018','FG0019','FG0020') ORDER BY RANDOM() LIMIT 1),
  15 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 35),
  CASE WHEN so.status = 'Delivered' THEN 15 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 35) 
       WHEN so.status = 'Partial' THEN (15 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 35)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('FG0011','FG0012','FG0013','FG0014','FG0015','FG0016','FG0017','FG0018','FG0019','FG0020') ORDER BY RANDOM() LIMIT 1),
  (15 + (ABS(HASHTEXT(so.sales_order_number || 'qty2')) % 35)) * 1450,
  2
FROM sales_orders so;

INSERT INTO sales_order_items (sales_order_id, material_id, quantity_ordered, quantity_delivered, unit_price, line_amount, line_item_number)
SELECT 
  so.id,
  (SELECT id FROM materials WHERE material_code IN ('FG0001','FG0005','FG0010','FG0015','FG0020') ORDER BY RANDOM() LIMIT 1),
  10 + (ABS(HASHTEXT(so.sales_order_number || 'qty3')) % 20),
  CASE WHEN so.status = 'Delivered' THEN 10 + (ABS(HASHTEXT(so.sales_order_number || 'qty3')) % 20) 
       WHEN so.status = 'Partial' THEN (10 + (ABS(HASHTEXT(so.sales_order_number || 'qty3')) % 20)) / 2 
       ELSE 0 END,
  (SELECT standard_price FROM materials WHERE material_code IN ('FG0001','FG0005','FG0010','FG0015','FG0020') ORDER BY RANDOM() LIMIT 1),
  (10 + (ABS(HASHTEXT(so.sales_order_number || 'qty3')) % 20)) * 950,
  3
FROM sales_orders so;

-- =====================================================
-- 22. DELIVERY ORDERS (40 records)
-- =====================================================

INSERT INTO delivery_orders (company_id, plant_id, delivery_number, sales_order_id, customer_id, delivery_date, shipping_date, status) VALUES
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00001', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00001'), (SELECT id FROM customers WHERE customer_code='C0001'), '2024-01-25'::DATE, '2024-01-26'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00002', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00002'), (SELECT id FROM customers WHERE customer_code='C0002'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00003', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00003'), (SELECT id FROM customers WHERE customer_code='C0003'), '2024-02-02'::DATE, '2024-02-03'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00004', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00004'), (SELECT id FROM customers WHERE customer_code='C0004'), '2024-02-05'::DATE, '2024-02-06'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00005', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00005'), (SELECT id FROM customers WHERE customer_code='C0005'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00006', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00006'), (SELECT id FROM customers WHERE customer_code='C0006'), '2024-02-10'::DATE, '2024-02-11'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00007', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00007'), (SELECT id FROM customers WHERE customer_code='C0007'), '2024-02-13'::DATE, '2024-02-14'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00008', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00008'), (SELECT id FROM customers WHERE customer_code='C0008'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00009', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00009'), (SELECT id FROM customers WHERE customer_code='C0009'), '2024-02-18'::DATE, '2024-02-19'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00010', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00010'), (SELECT id FROM customers WHERE customer_code='C0010'), '2024-02-20'::DATE, '2024-02-21'::DATE, 'Packed'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P005'), 'DO-2024-00011', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00011'), (SELECT id FROM customers WHERE customer_code='C0011'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P005'), 'DO-2024-00012', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00012'), (SELECT id FROM customers WHERE customer_code='C0012'), '2024-02-04'::DATE, '2024-02-05'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P005'), 'DO-2024-00013', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00013'), (SELECT id FROM customers WHERE customer_code='C0013'), '2024-02-09'::DATE, '2024-02-10'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P005'), 'DO-2024-00014', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00014'), (SELECT id FROM customers WHERE customer_code='C0014'), '2024-02-06'::DATE, '2024-02-07'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0002'), (SELECT id FROM plants WHERE plant_code='P005'), 'DO-2024-00015', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00015'), (SELECT id FROM customers WHERE customer_code='C0015'), '2024-02-18'::DATE, '2024-02-19'::DATE, 'Packed'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P008'), 'DO-2024-00016', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00016'), (SELECT id FROM customers WHERE customer_code='C0016'), '2024-01-24'::DATE, '2024-01-25'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P008'), 'DO-2024-00017', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00017'), (SELECT id FROM customers WHERE customer_code='C0017'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P008'), 'DO-2024-00018', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00018'), (SELECT id FROM customers WHERE customer_code='C0018'), '2024-02-05'::DATE, '2024-02-06'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P008'), 'DO-2024-00019', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00019'), (SELECT id FROM customers WHERE customer_code='C0019'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0003'), (SELECT id FROM plants WHERE plant_code='P008'), 'DO-2024-00020', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00020'), (SELECT id FROM customers WHERE customer_code='C0020'), '2024-02-19'::DATE, '2024-02-20'::DATE, 'Packed'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P010'), 'DO-2024-00021', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00021'), (SELECT id FROM customers WHERE customer_code='C0021'), '2024-01-27'::DATE, '2024-01-28'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P010'), 'DO-2024-00022', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00022'), (SELECT id FROM customers WHERE customer_code='C0022'), '2024-02-01'::DATE, '2024-02-02'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P010'), 'DO-2024-00023', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00023'), (SELECT id FROM customers WHERE customer_code='C0023'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P010'), 'DO-2024-00024', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00024'), (SELECT id FROM customers WHERE customer_code='C0024'), '2024-02-06'::DATE, '2024-02-07'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0004'), (SELECT id FROM plants WHERE plant_code='P010'), 'DO-2024-00025', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00025'), (SELECT id FROM customers WHERE customer_code='C0025'), '2024-02-19'::DATE, '2024-02-20'::DATE, 'Packed'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'DO-2024-00026', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00026'), (SELECT id FROM customers WHERE customer_code='C0026'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0005'), (SELECT id FROM plants WHERE plant_code='P012'), 'DO-2024-00027', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00027'), (SELECT id FROM customers WHERE customer_code='C0027'), '2024-02-05'::DATE, '2024-02-06'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P014'), 'DO-2024-00028', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00028'), (SELECT id FROM customers WHERE customer_code='C0028'), '2024-02-01'::DATE, '2024-02-02'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0006'), (SELECT id FROM plants WHERE plant_code='P014'), 'DO-2024-00029', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00029'), (SELECT id FROM customers WHERE customer_code='C0029'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P016'), 'DO-2024-00030', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00030'), (SELECT id FROM customers WHERE customer_code='C0030'), '2024-01-27'::DATE, '2024-01-28'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0007'), (SELECT id FROM plants WHERE plant_code='P016'), 'DO-2024-00031', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00031'), (SELECT id FROM customers WHERE customer_code='C0031'), '2024-02-01'::DATE, '2024-02-02'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P018'), 'DO-2024-00032', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00032'), (SELECT id FROM customers WHERE customer_code='C0032'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0008'), (SELECT id FROM plants WHERE plant_code='P018'), 'DO-2024-00033', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00033'), (SELECT id FROM customers WHERE customer_code='C0033'), '2024-02-05'::DATE, '2024-02-06'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'DO-2024-00034', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00034'), (SELECT id FROM customers WHERE customer_code='C0034'), '2024-02-08'::DATE, '2024-02-09'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0009'), (SELECT id FROM plants WHERE plant_code='P019'), 'DO-2024-00035', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00035'), (SELECT id FROM customers WHERE customer_code='C0035'), '2024-02-18'::DATE, '2024-02-19'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'DO-2024-00036', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00036'), (SELECT id FROM customers WHERE customer_code='C0036'), '2024-01-28'::DATE, '2024-01-29'::DATE, 'Delivered'),
((SELECT id FROM companies WHERE company_code='0010'), (SELECT id FROM plants WHERE plant_code='P020'), 'DO-2024-00037', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00037'), (SELECT id FROM customers WHERE customer_code='C0037'), '2024-02-05'::DATE, '2024-02-06'::DATE, 'Shipped'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00038', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00038'), (SELECT id FROM customers WHERE customer_code='C0038'), '2024-02-22'::DATE, '2024-02-23'::DATE, 'Packed'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00039', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00039'), (SELECT id FROM customers WHERE customer_code='C0039'), '2024-02-28'::DATE, '2024-03-01'::DATE, 'Planned'),
((SELECT id FROM companies WHERE company_code='0001'), (SELECT id FROM plants WHERE plant_code='P002'), 'DO-2024-00040', (SELECT id FROM sales_orders WHERE sales_order_number='SO-2024-00040'), (SELECT id FROM customers WHERE customer_code='C0040'), '2024-03-05'::DATE, NULL, 'Planned');

-- END OF PART 2
-- Additional modules (PP, HR, CRM, SRM) data continues in subsequent files
