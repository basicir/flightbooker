/** Lapozási változók, amelyeket a kliens tölt ki. */
export interface PageVariables extends Record<string, unknown> {
  first?: number
  after?: string | null
}

export const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
