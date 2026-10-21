/**
 * Config.gs — constants, schema and default settings.
 * Everything here is static. Runtime settings live in the Settings sheet.
 */

var APP_NAME = 'Graphics Team Portal';

/** Sheet name → column list. The first column is the primary key. */
var SCHEMA = {
  Users: ['userId', 'email', 'name', 'role', 'active', 'createdAt', 'updatedAt'],
  Departments: ['departmentId', 'name', 'active', 'createdAt'],
  Requirements: ['requirementId', 'requesterName', 'department', 'email', 'phone', 'title', 'creativeType',
    'purpose', 'brief', 'campaign', 'product', 'quantity', 'dimensions', 'platform', 'copyText',
    'referenceUrls', 'typeFields', 'preferredDate', 'priorityRequested', 'instructions', 'folderId',
    'status', 'notifiedAt', 'submittedAt', 'updatedAt', 'preferredTime', 'submittedBy'],
  ReferenceFiles: ['attachmentId', 'requirementId', 'taskId', 'fileId', 'fileName', 'mimeType', 'sizeBytes',
    'uploadedBy', 'uploadedAt'],
  Tasks: ['taskId', 'requirementId', 'title', 'brief', 'creativeType', 'purpose', 'campaign', 'product',
    'deliverablesRequired', 'dimensions', 'formats', 'copyText', 'referenceUrls', 'assigneeEmail',
    'assignedBy', 'assignedAt', 'startDate', 'dueDate', 'priority', 'status', 'prevStatus', 'progress',
    'instructions', 'internalNotes', 'folderId', 'completedAt', 'dueSoonNotifiedAt', 'overdueNotifiedAt',
    'createdBy', 'createdAt', 'updatedAt', 'dueTime', 'finalLink'],
  TaskAssignments: ['assignmentId', 'taskId', 'assigneeEmail', 'previousAssignee', 'assignedBy', 'dueDate',
    'priority', 'note', 'assignedAt', 'dueTime'],
  TaskActivity: ['activityId', 'taskId', 'actorEmail', 'actorRole', 'action', 'fromValue', 'toValue', 'note',
    'visibility', 'createdAt'],
  CreativeSubmissions: ['deliverableId', 'taskId', 'title', 'purpose', 'deliverableType', 'status',
    'latestVersionNo', 'latestVersionId', 'approvedVersionId', 'createdBy', 'createdAt', 'updatedAt'],
  CreativeVersions: ['versionId', 'deliverableId', 'taskId', 'versionNo', 'fileId', 'fileName', 'mimeType',
    'sizeBytes', 'note', 'uploadedBy', 'uploadedAt', 'status', 'submittedAt', 'approvedFileId'],
  ApprovalRequests: ['requestId', 'versionId', 'deliverableId', 'taskId', 'status', 'createdBy', 'createdAt',
    'closedAt'],
  ReviewTokens: ['tokenId', 'requestId', 'tokenHash', 'createdBy', 'createdAt', 'expiresAt', 'revokedAt',
    'revokeReason', 'lastOpenedAt'],
  ApprovalDecisions: ['decisionId', 'requestId', 'versionId', 'deliverableId', 'taskId', 'decision', 'comment',
    'reviewerName', 'reviewerEmail', 'channel', 'decidedBy', 'decidedAt'],
  Notifications: ['notificationId', 'recipientEmail', 'type', 'title', 'body', 'route', 'createdAt', 'readAt'],
  Settings: ['key', 'value', 'updatedAt'],
  RequesterLinks: ['linkId', 'email', 'tokenHash', 'createdAt', 'expiresAt', 'lastUsedAt']
};

/** Bump when columns are appended to SCHEMA; Db.gs migrates the live sheet once. */
var SCHEMA_VERSION = 3;

var ROLES = { LEADER: 'leader', DESIGNER: 'designer' };

var STATUS = {
  NEW: 'New Requirement',
  UNDER_REVIEW: 'Under Review',
  READY: 'Ready for Assignment',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted for Approval',
  CHANGES: 'Changes Requested',
  RESUBMITTED: 'Resubmitted for Approval',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled'
};

var STATUS_ORDER = [STATUS.NEW, STATUS.UNDER_REVIEW, STATUS.READY, STATUS.ASSIGNED, STATUS.IN_PROGRESS,
  STATUS.SUBMITTED, STATUS.CHANGES, STATUS.RESUBMITTED, STATUS.APPROVED, STATUS.COMPLETED, STATUS.ON_HOLD,
  STATUS.CANCELLED];

/** Statuses where the task still needs an owner. */
var PRE_ASSIGN = [STATUS.NEW, STATUS.UNDER_REVIEW, STATUS.READY];
/** Statuses that count as "closed". */
var CLOSED = [STATUS.COMPLETED, STATUS.CANCELLED];

/** Deliverable (creative submission) and version statuses. */
var DSTATUS = { DRAFT: 'Draft', AWAITING: 'Awaiting Approval', CHANGES: 'Changes Requested', APPROVED: 'Approved' };
var VSTATUS = { DRAFT: 'Draft', AWAITING: 'Awaiting Approval', CHANGES: 'Changes Requested', APPROVED: 'Approved',
  SUPERSEDED: 'Superseded' };

/**
 * Manual status transitions. System transitions (upload, review decisions)
 * are applied by recomputeTaskStatus_ and are not listed here.
 * Format: from → { to: [roles allowed] }
 */
var MANUAL_TRANSITIONS = (function () {
  var L = [ROLES.LEADER], LD = [ROLES.LEADER, ROLES.DESIGNER];
  var t = {};
  t[STATUS.NEW] = mk([[STATUS.UNDER_REVIEW, L], [STATUS.READY, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.UNDER_REVIEW] = mk([[STATUS.READY, L], [STATUS.NEW, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.READY] = mk([[STATUS.UNDER_REVIEW, L], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.ASSIGNED] = mk([[STATUS.IN_PROGRESS, LD], [STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.IN_PROGRESS] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.SUBMITTED] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.CHANGES] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.RESUBMITTED] = mk([[STATUS.ON_HOLD, L], [STATUS.CANCELLED, L]]);
  t[STATUS.APPROVED] = mk([[STATUS.COMPLETED, L], [STATUS.IN_PROGRESS, L]]);
  t[STATUS.COMPLETED] = mk([[STATUS.IN_PROGRESS, L]]);              // reopen
  t[STATUS.ON_HOLD] = mk([[STATUS.CANCELLED, L]]);                   // resume handled separately
  t[STATUS.CANCELLED] = mk([[STATUS.NEW, L]]);                       // restore
  function mk(pairs) { var o = {}; pairs.forEach(function (p) { o[p[0]] = p[1]; }); return o; }
  return t;
})();

var PROGRESS_STEPS = [0, 25, 50, 75, 100];

/** Default settings. Leaders can change these from the Settings page. */
var DEFAULT_SETTINGS = {
  companyName: 'Rosier Foods',
  portalName: APP_NAME,
  allowedDomain: '',            // filled at setup from the owner's email domain
  requireRequesterDomain: false, // true = requester email must belong to allowedDomain
  allowEmbedding: false,        // let the form/app load inside Google Sites or another site
  publicUrl: '',                // Public deployment /exec URL
  internalUrl: '',              // Internal deployment /exec URL
  brandGuidelinesUrl: '',
  priorities: ['Low', 'Medium', 'High', 'Urgent'],
  reviewerIdentity: 'required', // required | optional | anonymous
  allowReviewerDownload: true,
  tokenExpiryDays: 14,
  emailNotifications: true,
  emailRequesterOnSubmit: true,
  sendReviewLinkToRequester: true,
  autoCompleteOnApproval: true,
  workloadThreshold: 5,
  dueSoonHours: 24,
  maxUploadMB: 200,
  maxPublicUploadMB: 25,
  maxPublicFiles: 10,
  allowedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'psd', 'ai', 'eps', 'indd', 'tif',
    'tiff', 'mp4', 'mov', 'gif', 'zip', 'docx', 'pptx', 'xlsx', 'txt'],
  publicExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'docx', 'pptx', 'xlsx', 'txt', 'zip'],
  creativeTypes: [
    { id: 'social_post', label: 'Social media post', fields: [
      { key: 'platform', label: 'Platform', type: 'select', required: true,
        options: ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'YouTube', 'WhatsApp', 'Multiple'] },
      { key: 'format', label: 'Format', type: 'select', required: true,
        options: ['Feed post 1:1 (1080×1080)', 'Feed post 4:5 (1080×1350)', 'Story / Reel cover 9:16 (1080×1920)',
          'Carousel', 'Landscape 16:9 (1920×1080)', 'Custom'] },
      { key: 'variations', label: 'Number of variations', type: 'number', required: false },
      { key: 'caption', label: 'Caption (if you have one)', type: 'textarea', required: false }] },
    { id: 'website_banner', label: 'Website banner', fields: [
      { key: 'width', label: 'Width (px)', type: 'number', required: true },
      { key: 'height', label: 'Height (px)', type: 'number', required: true },
      { key: 'variants', label: 'Variants', type: 'select', required: true,
        options: ['Desktop only', 'Mobile only', 'Desktop + Mobile'] },
      { key: 'cta', label: 'CTA button text', type: 'text', required: false },
      { key: 'placement', label: 'Placement on site', type: 'text', required: true }] },
    { id: 'marketplace', label: 'Marketplace / quick-commerce listing', fields: [
      { key: 'marketplace', label: 'Marketplace', type: 'select', required: true,
        options: ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'Instamart', 'Other'] },
      { key: 'assetKind', label: 'What is needed', type: 'select', required: true,
        options: ['Listing images', 'A+ content', 'Banner / ad creative', 'Brand store'] },
      { key: 'sku', label: 'SKU / product variant', type: 'text', required: false }] },
    { id: 'performance_ad', label: 'Performance ad (Meta / Google)', fields: [
      { key: 'adPlatform', label: 'Ad platform', type: 'select', required: true,
        options: ['Meta', 'Google Display', 'YouTube', 'Other'] },
      { key: 'sizes', label: 'Sizes needed', type: 'text', required: true },
      { key: 'headline', label: 'Headline / hook', type: 'text', required: false },
      { key: 'cta', label: 'CTA', type: 'text', required: false }] },
    { id: 'print', label: 'Print (poster, flyer, standee)', fields: [
      { key: 'printSize', label: 'Print size', type: 'text', required: true },
      { key: 'orientation', label: 'Orientation', type: 'select', required: false, options: ['Portrait', 'Landscape'] },
      { key: 'bleed', label: 'Bleed / printer specs', type: 'text', required: false }] },
    { id: 'packaging', label: 'Packaging / label', fields: [
      { key: 'packFormat', label: 'Pack format & size', type: 'text', required: true },
      { key: 'dieline', label: 'Dieline available?', type: 'select', required: true, options: ['Yes, attached', 'No'] }] },
    { id: 'email', label: 'Email / WhatsApp creative', fields: [
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: ['Email', 'WhatsApp', 'SMS / RCS'] },
      { key: 'width', label: 'Width (px)', type: 'number', required: false }] },
    { id: 'presentation', label: 'Presentation / deck', fields: [
      { key: 'slides', label: 'Approx. number of slides', type: 'number', required: false },
      { key: 'template', label: 'Template to use', type: 'text', required: false }] },
    { id: 'other', label: 'Something else', fields: [] }
  ]
};

/** Keys a leader may edit from the Settings page, and their types. */
var EDITABLE_SETTINGS = {
  companyName: 'string', portalName: 'string', allowedDomain: 'string', requireRequesterDomain: 'boolean',
  allowEmbedding: 'boolean', publicUrl: 'url', internalUrl: 'url', brandGuidelinesUrl: 'url', priorities: 'list',
  reviewerIdentity: ['required', 'optional', 'anonymous'], allowReviewerDownload: 'boolean',
  tokenExpiryDays: 'number', emailNotifications: 'boolean', emailRequesterOnSubmit: 'boolean',
  sendReviewLinkToRequester: 'boolean', autoCompleteOnApproval: 'boolean', workloadThreshold: 'number',
  dueSoonHours: 'number', maxUploadMB: 'number', maxPublicUploadMB: 'number', maxPublicFiles: 'number',
  allowedExtensions: 'list', publicExtensions: 'list', creativeTypes: 'json'
};

/** Drive folders created under the root. */
var DRIVE_FOLDERS = {
  references: '01_Incoming_References',
  submissions: '02_Creative_Submissions',
  approved: '03_Approved_Creatives',
  brand: '04_Brand_Guidelines',
  exports: '05_Exports',
  system: '00_System'
};

/** Hard technical limits (not editable). */
var LIMITS = {
  CHUNK_BYTES: 4 * 1024 * 1024,        // multiple of 256 KB, required by Drive resumable upload
  PREVIEW_INLINE_BYTES: 2 * 1024 * 1024,   // bigger images are shown via Drive's (much smaller) rendered preview
  ORIGINAL_INLINE_BYTES: 20 * 1024 * 1024,
  TEXT_SHORT: 200,
  TEXT_LONG: 8000,
  UPLOAD_TTL_SEC: 21600
};
