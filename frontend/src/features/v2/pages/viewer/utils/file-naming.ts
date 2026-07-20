// STL 파일 이름 관련 순수 유틸 (복제 시 (copy) 접미사 부여).
// (ViewerV2Page 에서 추출 — 동작 불변.)

/**
 * 이름 충돌 시 "(copy)" / "(copy N)" 접미사를 붙여 유일한 파일명을 만든다.
 * 붙여넣기·복제 경로에서 공용.
 */
export function addCopySuffix(
  name: string,
  existing: { fileName: string }[],
): string {
  const existingNames = new Set(existing.map((e) => e.fileName));
  if (!existingNames.has(name)) return name;
  const dotIdx = name.lastIndexOf(".");
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
  let candidate = `${stem} (copy)${ext}`;
  let i = 2;
  while (existingNames.has(candidate)) {
    candidate = `${stem} (copy ${i})${ext}`;
    i++;
  }
  return candidate;
}
