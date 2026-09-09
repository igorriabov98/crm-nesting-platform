export function isActiveCuttingAreaRequest(status: string) {
  return status !== 'cancelled'
}
