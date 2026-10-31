/**
 * FEAT-090 — UTM key owner (mission-control/.ai/features/FEAT-090-…/api-contract.md v1 §1.1, §3, §7).
 *
 * One UTM key (`prefix` + `sourceId` + `mediumId` + `campaignId`) belongs to exactly **one** admin. The row is
 * claimed the moment an ad template first saves that key; every report then attributes its sign-ups / deposits to
 * that owner. `GET /utm-keys` and `PATCH /utm-keys/:id` are **GOD only** (`/settings/utm-keys`); there is no POST
 * and no DELETE — a claim only ever comes from a template save, and a key is moved, never released.
 */

/** the owner join reused by `AdTemplate.utmOwner`, `UtmReportRow.owner` and `PerfUtmRow.owner` */
export interface UtmOwnerRef {
  id: string
  displayName: string
}

/** `UtmKeyView` — exactly these 14 keys, in this order (§1.1) */
export interface UtmKeyView {
  id: string
  prefix: string
  source: string
  medium: string
  campaign: string
  sourceId: string
  mediumId: string
  campaignId: string
  /** `null` when the owner's admin row is gone */
  owner: UtmOwnerRef | null
  /** ad templates whose `config.utm` ids equal the key, over every workspace */
  templateCount: number
  /** builds whose `utm` ids equal the key (any status, any workspace) */
  buildCount: number
  /** max `utmFacts.day` of the key, `YYYY-MM-DD`, `null` when the key never produced a fact */
  lastFactDay: string | null
  createdAt: string
  updatedAt: string
}

/** `GET /utm-keys[?ownerAdminId=&prefix=]` 200 — sorted `prefix, source, medium, campaign`, no pagination */
export interface UtmKeysResponse {
  count: number
  keys: UtmKeyView[]
}

/** `PATCH /utm-keys/:id` body (GOD, strict, exactly one key) */
export interface PatchUtmKeyBody {
  ownerAdminId: string
}
