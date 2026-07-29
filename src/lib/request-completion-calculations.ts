export function calculateWaste(weightKg: number, wastePercent: number) {
  const scrapKg = Math.round(weightKg * wastePercent / 100 * 1000) / 1000
  return { scrapKg, usefulKg: Math.round((weightKg - scrapKg) * 1000) / 1000 }
}

export function calculatePlasmaTime(hours: number, minutes: number) {
  const enteredMinutes = Math.max(0, Math.trunc(hours)) * 60 + Math.max(0, Math.trunc(minutes))
  const actualMinutes = Math.ceil(enteredMinutes * 1.25)
  return { enteredMinutes, addedMinutes: actualMinutes - enteredMinutes, actualMinutes }
}

export function nextWeekday(date: Date) {
  const result = new Date(date)
  const day = result.getUTCDay()
  result.setUTCDate(result.getUTCDate() + (day === 5 ? 3 : day === 6 ? 2 : 1))
  return result
}

