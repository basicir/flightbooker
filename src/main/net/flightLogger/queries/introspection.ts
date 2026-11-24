import { getIntrospectionQuery, type IntrospectionQuery as IntrospectionResult } from 'graphql'
import { defineQuery } from '../defineQuery'

/** A séma lekérése (`__schema`), a felderítés docs/schema.graphql-be menti. Ez is csak olvasás. */
export const IntrospectionQuery = defineQuery<IntrospectionResult>(
  'IntrospectionQuery',
  getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true }),
)
