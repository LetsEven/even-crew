// Formatea un folio para mostrar sin ceros a la izquierda.
// "016" → "16", "000" → "0", "OR0000045939" → sin cambios (no es puramente numérico).
export function formatFolio(folio: string | number | null | undefined): string {
  if (folio == null || folio === "") return "";
  const s = String(folio);
  // Solo quitar ceros iniciales si es puramente numérico
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+(?=\d)/, "");
  }
  return s;
}
