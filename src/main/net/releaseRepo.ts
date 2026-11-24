/**
 * A program kiadásait tartó GitHub-repó (FRS-02). Az engedélyezési lista (ALP-02) csak ennek a
 * repónak a kiadáslistáját és kiadási fájljait engedi; a név a telepített programba is beépül,
 * ezért a repó átnevezése után a már kiadott példányok nem találnák a frissítéseket.
 * A kiadási folyamat (tools/release/next-version.ts) ellenőrzi, hogy egyezik a GitHub-repóval.
 */
export const RELEASE_REPO = { owner: 'basicir', name: 'flightbooker' } as const

export const releaseRepoSlug = (): string => `${RELEASE_REPO.owner}/${RELEASE_REPO.name}`
