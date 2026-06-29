export const MACHINE_DELIVERY_BASIS_VALUES = ['own_delivery', 'partner_truck'] as const

export type MachineDeliveryBasisType = (typeof MACHINE_DELIVERY_BASIS_VALUES)[number]

export const MACHINE_DELIVERY_BASIS_OPTIONS: Record<MachineDeliveryBasisType, {
  label: string
  deliveryBasisEn: string
  deliveryBasisUa: string
}> = {
  own_delivery: {
    label: 'Отправляем сами',
    deliveryBasisEn: 'Delivery Basis: DAP - Charleville-Mésières, France',
    deliveryBasisUa: 'Базис постачання: DAP - Шарлевіль-Мезьєр,Франція',
  },
  partner_truck: {
    label: 'С партнерами',
    deliveryBasisEn: 'Delivery Basis: FCA – Beregove,Ukraine',
    deliveryBasisUa: 'Базис постачання:  FCA  – Берегове,Україна',
  },
}

export function isMachineDeliveryBasisType(value: string | null | undefined): value is MachineDeliveryBasisType {
  return MACHINE_DELIVERY_BASIS_VALUES.includes(value as MachineDeliveryBasisType)
}

export function getMachineDeliveryBasisOption(value: string | null | undefined) {
  return isMachineDeliveryBasisType(value) ? MACHINE_DELIVERY_BASIS_OPTIONS[value] : null
}
