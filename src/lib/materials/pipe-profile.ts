export type PipeProfileSource = {
  pipe_type?: unknown
  diameter_mm?: unknown
  size?: unknown
  piece_description?: unknown
  wall_thickness_mm?: unknown
}

export type CanonicalPipeProfile = {
  pipeType: 'round' | 'square' | 'rectangular' | 'wire'
  diameterMm: number | null
  pieceDescription: string | null
  wallThicknessMm: number | null
}

const PIPE_TYPES = new Set<CanonicalPipeProfile['pipeType']>(['round', 'square', 'rectangular', 'wire'])

export function positivePipeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function singlePipeDimension(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return positivePipeNumber(value)
}

export function pipeSectionDimensions(value: unknown): [number, number] | null {
  const parts = String(value ?? '')
    .trim()
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => positivePipeNumber(part.trim()))
  if (parts.length < 2 || parts.some((part) => part === null)) return null
  return [parts[0] as number, parts[1] as number]
}

export function roundPipeOuterDiameterMm(source: PipeProfileSource) {
  return positivePipeNumber(source.diameter_mm)
    ?? singlePipeDimension(source.piece_description)
    ?? singlePipeDimension(source.size)
}

export function validatePipeProfileGeometry(
  source: PipeProfileSource,
  options: { requireComplete?: boolean } = {},
) {
  const requireComplete = options.requireComplete ?? true
  const pipeType = normalizedPipeType(source.pipe_type)
  if (!pipeType) return requireComplete ? 'Выберите подтип трубы' : null

  const textualSize = pipeText(source.piece_description) ?? pipeText(source.size)
  if (pipeType === 'wire') {
    if (positivePipeNumber(source.diameter_mm) === null) {
      return requireComplete || pipeValuePresent(source.diameter_mm) ? 'Введите диаметр проволоки' : null
    }
    return null
  }

  const wall = positivePipeNumber(source.wall_thickness_mm)
  if (pipeType === 'round') {
    if (textualSize && singlePipeDimension(textualSize) === null) {
      return 'Для круглой трубы укажите один наружный диаметр, а не размер вида 40×40.'
    }
    const diameter = roundPipeOuterDiameterMm(source)
    if (diameter === null) {
      return requireComplete || pipeValuePresent(source.diameter_mm) ? 'Введите наружный диаметр круглой трубы' : null
    }
    if (wall === null) {
      return requireComplete || pipeValuePresent(source.wall_thickness_mm) ? 'Введите толщину стенки трубы' : null
    }
    if (wall * 2 >= diameter) {
      return 'Толщина стенки трубы не может быть больше или равна половине наружного диаметра.'
    }
    return null
  }

  const dimensions = pipeSectionDimensions(textualSize)
  if (!dimensions) {
    return requireComplete || Boolean(textualSize) ? 'Размер трубы укажите как ширина × высота' : null
  }
  if (wall === null) {
    return requireComplete || pipeValuePresent(source.wall_thickness_mm) ? 'Введите толщину стенки трубы' : null
  }
  if (wall * 2 >= Math.min(dimensions[0], dimensions[1])) {
    return 'Толщина стенки трубы не может быть больше или равна половине меньшей стороны размера.'
  }
  return null
}

export function requireCanonicalPipeProfile(source: PipeProfileSource): CanonicalPipeProfile {
  const validationError = validatePipeProfileGeometry(source)
  if (validationError) throw new Error(validationError)

  const pipeType = normalizedPipeType(source.pipe_type)
  if (!pipeType) throw new Error('Выберите подтип трубы')
  if (pipeType === 'wire') {
    return {
      pipeType,
      diameterMm: positivePipeNumber(source.diameter_mm),
      pieceDescription: null,
      wallThicknessMm: null,
    }
  }
  if (pipeType === 'round') {
    return {
      pipeType,
      diameterMm: roundPipeOuterDiameterMm(source),
      pieceDescription: null,
      wallThicknessMm: positivePipeNumber(source.wall_thickness_mm),
    }
  }
  return {
    pipeType,
    diameterMm: null,
    pieceDescription: pipeText(source.piece_description) ?? pipeText(source.size),
    wallThicknessMm: positivePipeNumber(source.wall_thickness_mm),
  }
}

function normalizedPipeType(value: unknown) {
  const normalized = String(value ?? '').trim() as CanonicalPipeProfile['pipeType']
  return PIPE_TYPES.has(normalized) ? normalized : null
}

function pipeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pipeValuePresent(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}
