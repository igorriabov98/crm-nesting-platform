export const MEETING_TYPES = {
  general: { label: 'Общее собрание', color: 'blue', icon: 'Globe' },
  factory_bergovo: { label: 'Совещание с производством Берегово', color: 'green', icon: 'Factory' },
  factory_uzhgorod: { label: 'Совещание с производством Ужгород', color: 'orange', icon: 'Factory' },
  tech_engineer_supply: { label: 'Технолог+Инженер+Снабжение', color: 'purple', icon: 'Users' },
}

export type MeetingTypeInfo = {
  label: string
  color: string
  icon?: string
}

export type MeetingTypesMap = Record<string, MeetingTypeInfo>

export function buildMeetingTypesMap(types?: Array<{ key: string; label: string; color: string | null }>): MeetingTypesMap {
  const map: MeetingTypesMap = { ...MEETING_TYPES }

  for (const type of types || []) {
    map[type.key] = {
      label: type.label,
      color: type.color || 'blue',
      icon: map[type.key]?.icon || 'Calendar',
    }
  }

  return map
}

export const MEETING_STATUSES = {
  planned: { label: 'Запланировано', color: 'blue' },
  completed: { label: 'Проведено', color: 'green' },
  cancelled: { label: 'Отменено', color: 'gray' },
}

export const MACHINE_STATUSES = {
  created: { label: 'Создана', color: 'gray', icon: 'Plus' },
  under_review: { label: 'На рассмотрении', color: 'blue', icon: 'Clock' },
  factory_assigned: { label: 'Назначен завод', color: 'yellow', icon: 'Factory' },
  in_production: { label: 'В производстве', color: 'green', icon: 'Cog' },
  shipped: { label: 'Отгружена', color: 'emerald', icon: 'Truck' },
  confirmed: { label: 'Подтверждена', color: 'green', icon: 'CheckCircle' },
  planned: { label: 'Запланирована', color: 'blue', icon: 'Calendar' },
  request_ready: { label: 'Заявка готова', color: 'purple', icon: 'FileCheck' },
  purchasing: { label: 'В закупке', color: 'orange', icon: 'ShoppingCart' },
  material_received: { label: 'Материал получен', color: 'emerald', icon: 'PackageCheck' },
}

export const MATERIAL_TYPES = {
  standard: { label: 'Стандартный', color: 'green' },
  non_standard: { label: 'Нестандартный', color: 'orange' },
  undefined: { label: 'Не определён', color: 'gray' },
}
