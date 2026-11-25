/** Port of `plane.utils.issue_relation_mapper`. */
const inverseRelations: Record<string, string> = {
  start_after: 'start_before',
  finish_after: 'finish_before',
  blocked_by: 'blocking',
  blocking: 'blocked_by',
  start_before: 'start_after',
  finish_before: 'finish_after',
  implemented_by: 'implements',
  implements: 'implemented_by'
}
const actualRelations: Record<string, string> = {
  start_after: 'start_before',
  finish_after: 'finish_before',
  blocking: 'blocked_by',
  blocked_by: 'blocked_by',
  start_before: 'start_before',
  finish_before: 'finish_before',
  implemented_by: 'implemented_by',
  implements: 'implemented_by'
}

/** Relation as seen from the other issue. Unknown or symmetric types map to themselves. */
export function getInverseRelation(relationType: string) {
  return inverseRelations[relationType] ?? relationType
}

/** Relation type as stored in the database. */
export function getActualRelation(relationType: string) {
  return actualRelations[relationType] ?? relationType
}

/** Types whose stored row has the target as `issue_id` and the URL issue as `related_issue_id`. */
export const reversedRelationTypes = new Set(['blocking', 'start_after', 'finish_after', 'implements'])
