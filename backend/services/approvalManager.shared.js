const supabase = require('../config/supabase');
const { ApprovalManager } = require('./humanApproval.service');

const approvalManager = new ApprovalManager({
  store: supabase,
  waitForApproval: false,
});

approvalManager.createHandler('default', {
  store: supabase,
  waitForApproval: false,
});

module.exports = { approvalManager };
