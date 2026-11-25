/**
 * PD-0570 to PD-0576 (issue attachments). They were ported with the issue collaboration group on R2 (upload through
 * the Worker, confirm with PATCH, stream on GET), so this module only re-exports them under the checklist names.
 */
export {
  confirmIssueAttachment as updateIssueAttachment,
  createIssueAttachment,
  deleteIssueAttachment,
  downloadIssueAttachment as getIssueAttachment,
  listIssueAttachments,
  uploadIssueAttachmentContent
} from '@/server/issue/attachment'
