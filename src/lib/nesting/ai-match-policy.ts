export const AI_MATCH_APPLICATION_CONFIDENCE = 0.8

export function isAIMatchApplyEligible(match: {
  matchConfidence: number
  identityConfirmed: boolean
}) {
  return match.matchConfidence >= AI_MATCH_APPLICATION_CONFIDENCE && match.identityConfirmed
}
