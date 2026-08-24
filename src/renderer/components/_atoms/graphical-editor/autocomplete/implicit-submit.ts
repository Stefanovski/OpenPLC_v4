type AutocompleteVariable = {
  id?: string
  name: string
}

const resolveImplicitVariableMatch = (
  variables: AutocompleteVariable[] | undefined,
  searchValue: string,
): { id: string; name: string } | undefined => {
  const normalizedSearchValue = searchValue.trim().toLowerCase()
  if (!normalizedSearchValue) return undefined

  const exactMatch = variables?.find((variable) => variable.name.toLowerCase() === normalizedSearchValue)
  if (!exactMatch) return undefined

  return {
    id: exactMatch.id ?? '',
    name: exactMatch.name,
  }
}

export { resolveImplicitVariableMatch }
export type { AutocompleteVariable }
