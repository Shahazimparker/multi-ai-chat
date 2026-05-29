export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'timeout';

export interface ApprovalRequestOptions {
  id?: string;
  type?: 'approval' | 'input' | 'selection' | 'feedback' | string;
  title?: string;
  description?: string;
  context?: Record<string, any>;
  options?: any[];
  timeout?: number | null;
  requiredBy?: string | null;
}

export interface ApprovalRequestJSON {
  id: string;
  type: string;
  title: string;
  description: string;
  context: Record<string, any>;
  options: any[];
  status: ApprovalStatus;
  response: any;
  reason: string | null;
  approver: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export class ApprovalRequest {
  constructor(options?: ApprovalRequestOptions);
  id: string;
  type: string;
  title: string;
  description: string;
  context: Record<string, any>;
  options: any[];
  timeout: number | null;
  requiredBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: ApprovalStatus;
  approvedAt: string | null;
  approver: string | null;
  response: any;
  reason: string | null;
  approve(response?: any, approver?: string, reason?: string): this;
  reject(reason?: string, approver?: string): this;
  expire(): this;
  isExpired(): boolean;
  isPending(): boolean;
  toJSON(): ApprovalRequestJSON;
}

export interface InterruptPointOptions {
  nodeId?: string;
  type?: 'before' | 'after' | string;
  condition?: ((output: any) => boolean | Promise<boolean>) | null;
  approvalType?: string;
  title?: string;
  description?: string;
  options?: any[];
  timeout?: number;
  autoApprove?: boolean;
}

export class InterruptPoint {
  constructor(options?: InterruptPointOptions);
  shouldInterrupt(output: any): Promise<boolean>;
  toJSON(): Record<string, any>;
}

export interface ExecutionSnapshotOptions {
  id?: string;
  nodeId?: string;
  type?: string;
  input?: any;
  output?: any;
  state?: Record<string, any>;
  metadata?: Record<string, any>;
  executionPath?: any[];
}

export class ExecutionSnapshot {
  constructor(options?: ExecutionSnapshotOptions);
  id: string;
  nodeId: string;
  type: string;
  input: any;
  output: any;
  state: Record<string, any>;
  metadata: Record<string, any>;
  timestamp: string;
  executionPath: any[];
  toJSON(): Record<string, any>;
}

export interface HumanApprovalHandlerOptions {
  approvalFn?: ((request: ApprovalRequest) => void | Promise<void>) | null;
  store?: any;
  waitForApproval?: boolean;
  defaultApprover?: string;
  autoRejectExpired?: boolean;
  defaultTimeout?: number;
}

export class HumanApprovalHandler {
  constructor(options?: HumanApprovalHandlerOptions);
  requestApproval(options?: ApprovalRequestOptions): Promise<ApprovalRequest>;
  approve(requestId: string, response?: any, approver?: string, reason?: string): Promise<ApprovalRequest>;
  reject(requestId: string, reason?: string, approver?: string): Promise<ApprovalRequest>;
  saveSnapshot(snapshot: ExecutionSnapshot | ExecutionSnapshotOptions): ExecutionSnapshot;
  getSnapshot(snapshotId: string): ExecutionSnapshot | undefined;
  getRequest(requestId: string): ApprovalRequest | undefined;
  getPendingRequests(): ApprovalRequest[];
  listPendingRequests(): Promise<ApprovalRequestJSON[]>;
  getAuditLog(options?: Record<string, any>): any[];
  cleanup(olderThan?: number): void;
  toJSON(): Record<string, any>;
}

export interface ApprovalManagerOptions {
  approvalFn?: ((request: ApprovalRequest) => void | Promise<void>) | null;
  store?: any;
  waitForApproval?: boolean;
}

export class ApprovalManager {
  constructor(options?: ApprovalManagerOptions);
  createHandler(name: string, options?: HumanApprovalHandlerOptions): HumanApprovalHandler;
  getHandler(name: string): HumanApprovalHandler;
  requestApprovalGlobal(requestId: string, options?: ApprovalRequestOptions & { handler?: string }): Promise<ApprovalRequest>;
  approve(requestId: string, response?: any, approver?: string, reason?: string): Promise<ApprovalRequest>;
  reject(requestId: string, reason?: string, approver?: string): Promise<ApprovalRequest>;
  getAllPending(): Array<{ handler: string; request: ApprovalRequest }>;
  listPending(handlerName?: string): Promise<ApprovalRequestJSON[]>;
}
