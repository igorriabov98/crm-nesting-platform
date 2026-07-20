import type { EmployeeAssignment } from '@/lib/types'
import type {
  PeoplePlanningMachine,
  PeoplePlanningSection,
  PeoplePlanningStageProgress,
} from '@/lib/people-planning/types'

const SECTION_ORDER: Array<{ rank: number; matches: string[] }> = [
  { rank: 10, matches: ['заготов'] },
  { rank: 20, matches: ['сборк', 'сварк'] },
  { rank: 30, matches: ['зачист'] },
  { rank: 40, matches: ['маляр', 'покраск'] },
  { rank: 50, matches: ['упаков'] },
  { rank: 60, matches: ['отгруз'] },
]

function normalizedSectionName(section: Pick<PeoplePlanningSection, 'name' | 'parentName' | 'production_stage_type'>) {
  return `${section.parentName} ${section.name} ${section.production_stage_type || ''}`.trim().toLocaleLowerCase('ru')
}

export function peoplePlanningSectionRank(section: Pick<PeoplePlanningSection, 'name' | 'parentName' | 'production_stage_type'>) {
  const normalized = normalizedSectionName(section)
  if (section.production_stage_type === 'cutting') return 10
  return SECTION_ORDER.find(({ matches }) => matches.some((match) => normalized.includes(match)))?.rank ?? 90
}

export function comparePeoplePlanningSections(left: PeoplePlanningSection, right: PeoplePlanningSection) {
  return peoplePlanningSectionRank(left) - peoplePlanningSectionRank(right)
    || left.parentName.localeCompare(right.parentName, 'ru')
    || left.sort_order - right.sort_order
    || left.name.localeCompare(right.name, 'ru')
}

export function comparePeoplePlanningMachines(
  left: Pick<PeoplePlanningMachine, 'productionWorkshop' | 'queueNumber' | 'createdAt' | 'name'>,
  right: Pick<PeoplePlanningMachine, 'productionWorkshop' | 'queueNumber' | 'createdAt' | 'name'>,
) {
  const workshopDifference = (left.productionWorkshop ?? Number.MAX_SAFE_INTEGER)
    - (right.productionWorkshop ?? Number.MAX_SAFE_INTEGER)
  if (workshopDifference) return workshopDifference

  const queueDifference = (left.queueNumber ?? Number.MAX_SAFE_INTEGER)
    - (right.queueNumber ?? Number.MAX_SAFE_INTEGER)
  if (queueDifference) return queueDifference

  return left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name, 'ru')
}

function roundedPercent(value: number) {
  return Math.round(Math.min(Math.max(value, 0), 100) * 10) / 10
}

export function buildPeoplePlanningStageProgress(
  machineId: string,
  totalWeightKg: number,
  sections: PeoplePlanningSection[],
  assignments: Array<Pick<EmployeeAssignment, 'machine_id' | 'section_id' | 'status' | 'kg_planned'>>,
): PeoplePlanningStageProgress[] {
  const totals = new Map<string, { confirmedKg: number; pendingKg: number }>()

  for (const assignment of assignments) {
    if (assignment.machine_id !== machineId) continue
    const current = totals.get(assignment.section_id) || { confirmedKg: 0, pendingKg: 0 }
    if (assignment.status === 'confirmed') current.confirmedKg += Number(assignment.kg_planned || 0)
    else current.pendingKg += Number(assignment.kg_planned || 0)
    totals.set(assignment.section_id, current)
  }

  return sections.map((section) => {
    const total = totals.get(section.id) || { confirmedKg: 0, pendingKg: 0 }
    const progressPercent = totalWeightKg > 0
      ? roundedPercent((total.confirmedKg / totalWeightKg) * 100)
      : 0
    return {
      sectionId: section.id,
      sectionName: section.name,
      parentName: section.parentName,
      displayName: section.displayName,
      confirmedKg: total.confirmedKg,
      pendingKg: total.pendingKg,
      progressPercent,
      remainingKg: Math.max(totalWeightKg - total.confirmedKg, 0),
      remainingPercent: roundedPercent(100 - progressPercent),
    }
  })
}
