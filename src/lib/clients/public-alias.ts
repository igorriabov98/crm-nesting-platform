export function buildClientPublicAlias(name: string) {
  const words = name.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []
  const alias = words.map((word) => Array.from(word).slice(0, 3).join('').toLocaleUpperCase('uk-UA')).join('.')
  return alias || 'КЛИЕНТ'
}
