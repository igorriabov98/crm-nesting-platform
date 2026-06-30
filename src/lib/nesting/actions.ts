'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import {
  deleteProject,
  getParts,
  startCalculation,
  updatePart,
  type NestingStrategy,
} from '@/lib/nesting/api'

export async function deleteNestingProject(projectId: string) {
  await deleteProject(projectId)
  revalidatePath(ROUTES.NESTING)
}

export async function getNestingParts(projectId: string) {
  return getParts(projectId)
}

export async function updateNestingPart(
  projectId: string,
  partId: string,
  data: Partial<{
    material: string
    steelTypeId: string | null
    steelTypeName: string | null
    steelTypeRaw: string | null
    quantity: number
    grainLock: boolean
    isSheetMetal: boolean
    thickness: number
    width: number
    height: number
    hasBends: boolean
  }>
) {
  const result = await updatePart(projectId, partId, data)
  revalidatePath(`${ROUTES.NESTING}/${projectId}/parts`)
  revalidatePath(ROUTES.NESTING)
  return result
}

export async function startNestingCalculation(projectId: string, strategy: NestingStrategy) {
  const result = await startCalculation(projectId, strategy)
  revalidatePath(`${ROUTES.NESTING}/${projectId}/parts`)
  revalidatePath(ROUTES.NESTING)
  return result
}
