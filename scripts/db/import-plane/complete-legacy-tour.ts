import type { DatabaseSync } from 'node:sqlite'

const checklist = {
  project_created: true,
  project_joined: true,
  work_item_created: true,
  team_members_invited: true,
  page_created: true,
  ai_chat_tried: true,
  integration_linked: true,
  view_created: true,
  sticky_created: true
}
const tips = { mobile_app_download: true }
const exploredFeatures = { github_integrated: true, slack_integrated: true, ai_chat_tried: true }
const productTour = { work_items: true, cycles: true, modules: true, intake: true, pages: true }

/** Backfill the 0118 tour state on existing profiles and workspace memberships in an import snapshot. */
export function completeLegacyTour(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE profiles SET is_navigation_tour_completed = 1, product_tour = ?').run(
      JSON.stringify(productTour)
    )
    db.prepare('UPDATE workspace_members SET getting_started_checklist = ?, tips = ?, explored_features = ?').run(
      JSON.stringify(checklist),
      JSON.stringify(tips),
      JSON.stringify(exploredFeatures)
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
