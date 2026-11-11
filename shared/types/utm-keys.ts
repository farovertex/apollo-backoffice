/**
 * FEAT-090 + FEAT-099 — UTM key ownership (mission-control/.ai/features/FEAT-099-…/api-contract.md v1 §0, §1.1, §2).
 *
 * One UTM key (`prefix` + `sourceId` + `mediumId` + `campaignId`) has three separate facts:
 *  - a **holder** (`owner`, = `owners[last].admin`): the admin who holds it now and forward — the claim gate, the
 *    GOD menu filter and `AdTemplate.utmOwner` all mean the holder;
 *  - an **owner of a day** (`owners[]`, append-only, `from` = `YYYY-MM-DD` Asia/Bangkok): the last entry whose
 *    `from <= day` — the money of the report pages follows it, so a handover never moves past days;
 *  - **released** (`released != null`): the holder stepped back and another admin may claim the key. A release
 *    changes nothing else — the holder keeps earning the key's facts until somebody else claims it.
 * `GET /utm-keys`, `PATCH /utm-keys/:id` (a handover) and `POST /utm-keys/:id/release` are **GOD only**
 * (`/settings/utm-keys`); there is no POST-create and no DELETE — a claim only comes from a template save.
 */

/** the owner join reused by `AdTemplate.utmOwner`, `UtmReportRow.owner` and `PerfUtmRow.owner` */
export interface UtmOwnerRef {
  id: string
  displayName: string
}

/** one handover of the timeline; the entry covers `from` up to the day before the next entry's `from` */
export interface UtmKeyOwnerEntry {
  /** `null` when that admin's row is gone */
  admin: UtmOwnerRef | null
  /** `YYYY-MM-DD`, Asia/Bangkok — render it as is, never parse it into a local `Date` */
  from: string
}

export type UtmKeyReleaseReason = 'manual' | 'prefixRemoved' | 'adminDeleted'

export interface UtmKeyReleased {
  /** ISO timestamp */
  at: string
  /** `null` for the admin-delete cascade (and for a vanished admin row) */
  by: UtmOwnerRef | null
  reason: UtmKeyReleaseReason
}

/** `UtmKeyView` — exactly these 17 keys, in this order (§1.1 v1.1; `owners`, `released`, `nextHandoverFrom` are last) */
export interface UtmKeyView {
  id: string
  prefix: string
  source: string
  medium: string
  campaign: string
  sourceId: string
  mediumId: string
  campaignId: string
  /** the **holder**; `null` when that admin's row is gone */
  owner: UtmOwnerRef | null
  /** ad templates whose `config.utm` ids equal the key, over every workspace */
  templateCount: number
  /** builds whose `utm` ids equal the key (any status, any workspace) */
  buildCount: number
  /** max `utmFacts.day` of the key, `YYYY-MM-DD`, `null` when the key never produced a fact */
  lastFactDay: string | null
  createdAt: string
  updatedAt: string
  /** the ownership timeline, ascending by `from`, length >= 1 */
  owners: UtmKeyOwnerEntry[]
  /** `null` while the key is held */
  released: UtmKeyReleased | null
  /** the day a handover to another admin takes effect if done now — computed by the API, render it, never recompute */
  nextHandoverFrom: string
}

/** `GET /utm-keys[?ownerAdminId=&prefix=]` 200 — sorted `prefix, source, medium, campaign`, no pagination */
export interface UtmKeysResponse {
  count: number
  keys: UtmKeyView[]
}

/** `PATCH /utm-keys/:id` body (GOD, strict, exactly one key) — a handover */
export interface PatchUtmKeyBody {
  ownerAdminId: string
}
