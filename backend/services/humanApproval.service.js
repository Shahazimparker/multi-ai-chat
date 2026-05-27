// ============================================================
// FILE: backend/services/humanApproval.service.js
// PURPOSE: Human-in-the-loop approval checkpoints
//          - Pause execution for human review
//          - Request approval before proceeding
//          - State snapshots and resumption
//          - Audit trail of decisions
//          - Timeout handling
// ============================================================

/**
 * ApprovalRequest — represents a request for human approval
 */
class ApprovalRequest {
  constructor(options = {}) {
    this.id = options.id || `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.type = options.type || 'approval'; // approval, input, selection, feedback
    this.title = options.title || '';
    this.description = options.description || '';
    this.context = options.context || {}; // execution state, previous output, etc
    this.options = options.options || []; // for selection type
    this.timeout = options.timeout || null; // ms, null = no timeout
    this.requiredBy = options.requiredBy || null; // node/step that needs approval
    this.createdAt = new Date().toISOString();
    this.expiresAt = this.timeout ? new Date(Date.now() + this.timeout).toISOString() : null;
    this.status = 'pending'; // pending, approved, rejected, expired, timeout
    this.approvedAt = null;
    this.approver = null;
    this.response = null;
    this.reason = null; // why approved/rejected
  }

  approve(response = true, approver = 'system', reason = '') {
    this.status = 'approved';
    this.response = response;
    this.approver = approver;
    this.reason = reason;
    this.approvedAt = new Date().toISOString();
    return this;
  }

  reject(reason = '', approver = 'system') {
    this.status = 'rejected';
    this.approver = approver;
    this.reason = reason;
    this.approvedAt = new Date().toISOString();
    return this;
  }

  expire() {
    this.status = 'expired';
    this.approvedAt = new Date().toISOString();
    return this;
  }

  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }

  isPending() {
    return this.status === 'pending' && !this.isExpired();
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      description: this.description,
      context: this.context,
      options: this.options,
      status: this.status,
      response: this.response,
      reason: this.reason,
      approver: this.approver,
      createdAt: this.createdAt,
      approvedAt: this.approvedAt,
    };
  }
}

/**
 * InterruptPoint — marks where execution can be paused
 */
class InterruptPoint {
  constructor(options = {}) {
    this.nodeId = options.nodeId || '';
    this.type = options.type || 'before'; // before, after
    this.condition = options.condition || null; // (output) => boolean to decide if pause
    this.approvalType = options.approvalType || 'approval'; // approval, input, selection
    this.title = options.title || `Approval for ${this.nodeId}`;
    this.description = options.description || '';
    this.options = options.options || []; // for selection type
    this.timeout = options.timeout || 300000; // default 5 min
    this.autoApprove = options.autoApprove || false; // skip human if condition not met
  }

  async shouldInterrupt(output) {
    if (!this.condition) return true;
    return await this.condition(output);
  }

  toJSON() {
    return {
      nodeId: this.nodeId,
      type: this.type,
      approvalType: this.approvalType,
      title: this.title,
      description: this.description,
      options: this.options,
      timeout: this.timeout,
      autoApprove: this.autoApprove,
    };
  }
}

/**
 * ExecutionSnapshot — captures state at pause point
 */
class ExecutionSnapshot {
  constructor(options = {}) {
    this.id = options.id || `snapshot-${Date.now()}`;
    this.nodeId = options.nodeId || '';
    this.type = options.type || 'before'; // before/after node execution
    this.input = options.input || null;
    this.output = options.output || null;
    this.state = options.state || {};
    this.metadata = options.metadata || {};
    this.timestamp = new Date().toISOString();
    this.executionPath = options.executionPath || [];
  }

  toJSON() {
    return {
      id: this.id,
      nodeId: this.nodeId,
      type: this.type,
      input: this.input,
      output: this.output,
      state: this.state,
      metadata: this.metadata,
      timestamp: this.timestamp,
      executionPath: this.executionPath,
    };
  }
}

const MAX_APPROVAL_TIMEOUT_MS = 3600000; // hard cap: 1 hour

/**
 * HumanApprovalHandler — manages approval flow
 */
class HumanApprovalHandler {
  constructor(options = {}) {
    this.requests = new Map(); // id → ApprovalRequest
    this.snapshots = new Map(); // id → ExecutionSnapshot
    this.auditLog = [];
    this.pendingCallbacks = new Map(); // id → { resolve, reject, timeout }
    this.approvalFn = options.approvalFn || null; // external callback to request approval
    this.defaultApprover = options.defaultApprover || 'system';
    this.autoRejectExpired = options.autoRejectExpired !== false;
    this.defaultTimeout = options.defaultTimeout || 300000; // 5 min default
  }

  /**
   * Create approval request and wait for response
   */
  async requestApproval(options = {}) {
    // Clamp timeout: null/undefined → defaultTimeout, > cap → cap
    const rawTimeout = options.timeout != null ? options.timeout : this.defaultTimeout;
    const clampedTimeout = Math.min(rawTimeout, MAX_APPROVAL_TIMEOUT_MS);
    const request = new ApprovalRequest({ ...options, timeout: clampedTimeout });
    this.requests.set(request.id, request);

    // Log the request
    this._logAudit('approval_requested', {
      requestId: request.id,
      type: request.type,
      title: request.title,
    });

    // If external approval function provided, call it (fire-and-forget; errors don't block)
    if (this.approvalFn) {
      Promise.resolve()
        .then(() => this.approvalFn(request))
        .catch((err) => {
          console.error('[HumanApprovalHandler] approvalFn failed:', err.message);
          // Auto-reject if the notification delivery itself fails
          if (request.isPending()) {
            request.reject('Approval notification failed: ' + err.message, 'system');
            const cb = this.pendingCallbacks.get(request.id);
            if (cb) {
              clearTimeout(cb.timeout);
              cb.reject(new Error('Approval notification failed: ' + err.message));
              this.pendingCallbacks.delete(request.id);
            }
          }
        });
    }

    // Wait for approval (with timeout)
    return await this._waitForApproval(request);
  }

  /**
   * Wait for approval with timeout
   */
  async _waitForApproval(request) {
    return new Promise((resolve, reject) => {
      const timeoutId = request.timeout
        ? setTimeout(() => {
            if (request.isPending()) {
              request.expire();
              this._logAudit('approval_expired', { requestId: request.id });

              if (this.autoRejectExpired) {
                reject(new Error(`Approval timeout for ${request.id}`));
              } else {
                resolve(request);
              }
            }
          }, request.timeout)
        : null;

      this.pendingCallbacks.set(request.id, {
        resolve,
        reject,
        timeout: timeoutId,
      });
    });
  }

  /**
   * Approve a request
   */
  approve(requestId, response = true, approver = 'human', reason = '') {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    request.approve(response, approver, reason);
    this._logAudit('approval_granted', {
      requestId,
      approver,
      reason,
    });

    const callback = this.pendingCallbacks.get(requestId);
    if (callback) {
      clearTimeout(callback.timeout);
      callback.resolve(request);
      this.pendingCallbacks.delete(requestId);
    }

    return request;
  }

  /**
   * Reject a request
   */
  reject(requestId, reason = '', approver = 'human') {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    request.reject(reason, approver);
    this._logAudit('approval_rejected', {
      requestId,
      approver,
      reason,
    });

    const callback = this.pendingCallbacks.get(requestId);
    if (callback) {
      clearTimeout(callback.timeout);
      callback.reject(new Error(reason || 'Approval rejected'));
      this.pendingCallbacks.delete(requestId);
    }

    return request;
  }

  /**
   * Save execution snapshot
   */
  saveSnapshot(snapshot) {
    if (!(snapshot instanceof ExecutionSnapshot)) {
      snapshot = new ExecutionSnapshot(snapshot);
    }
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  /**
   * Get snapshot
   */
  getSnapshot(snapshotId) {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Get approval request
   */
  getRequest(requestId) {
    return this.requests.get(requestId);
  }

  /**
   * Get all pending requests
   */
  getPendingRequests() {
    return Array.from(this.requests.values()).filter((r) => r.isPending());
  }

  /**
   * Get audit log
   */
  getAuditLog(options = {}) {
    let log = this.auditLog;

    if (options.requestId) {
      log = log.filter((e) => e.data.requestId === options.requestId);
    }

    if (options.startTime) {
      log = log.filter((e) => new Date(e.timestamp) >= new Date(options.startTime));
    }

    if (options.action) {
      log = log.filter((e) => e.action === options.action);
    }

    return log;
  }

  /**
   * Internal: log audit event
   */
  _logAudit(action, data) {
    this.auditLog.push({
      action,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Clear old requests and snapshots
   */
  cleanup(olderThan = 3600000) {
    // default 1 hour
    const cutoff = new Date(Date.now() - olderThan);

    for (const [id, request] of this.requests) {
      if (new Date(request.createdAt) < cutoff && !request.isPending()) {
        this.requests.delete(id);
      }
    }

    for (const [id, snapshot] of this.snapshots) {
      if (new Date(snapshot.timestamp) < cutoff) {
        this.snapshots.delete(id);
      }
    }
  }

  toJSON() {
    return {
      pendingRequests: this.getPendingRequests().map((r) => r.toJSON()),
      totalRequests: this.requests.size,
      totalSnapshots: this.snapshots.size,
      auditLogSize: this.auditLog.length,
    };
  }
}

/**
 * ApprovalManager — manage multiple approval handlers
 */
class ApprovalManager {
  constructor(options = {}) {
    this.handlers = new Map(); // name → HumanApprovalHandler
    this.globalApprovalFn = options.approvalFn || null;
  }

  /**
   * Create approval handler
   */
  createHandler(name, options = {}) {
    const handler = new HumanApprovalHandler({
      approvalFn: this.globalApprovalFn || options.approvalFn,
      ...options,
    });
    this.handlers.set(name, handler);
    return handler;
  }

  /**
   * Get handler
   */
  getHandler(name) {
    if (!this.handlers.has(name)) {
      this.handlers.set(name, new HumanApprovalHandler());
    }
    return this.handlers.get(name);
  }

  /**
   * Request approval across all handlers
   */
  async requestApprovalGlobal(requestId, options = {}) {
    const handlerName = options.handler || 'default';
    const handler = this.getHandler(handlerName);
    return await handler.requestApproval(options);
  }

  /**
   * Approve across handlers
   */
  approve(requestId, response = true, approver = 'human', reason = '') {
    for (const handler of this.handlers.values()) {
      const request = handler.getRequest(requestId);
      if (request) {
        return handler.approve(requestId, response, approver, reason);
      }
    }
    throw new Error(`Request not found: ${requestId}`);
  }

  /**
   * Reject across handlers
   */
  reject(requestId, reason = '', approver = 'human') {
    for (const handler of this.handlers.values()) {
      const request = handler.getRequest(requestId);
      if (request) {
        return handler.reject(requestId, reason, approver);
      }
    }
    throw new Error(`Request not found: ${requestId}`);
  }

  /**
   * Get all pending requests across handlers
   */
  getAllPending() {
    const all = [];
    for (const [name, handler] of this.handlers) {
      const pending = handler.getPendingRequests();
      all.push(...pending.map((r) => ({ handler: name, request: r })));
    }
    return all;
  }
}

module.exports = {
  ApprovalRequest,
  InterruptPoint,
  ExecutionSnapshot,
  HumanApprovalHandler,
  ApprovalManager,
};
