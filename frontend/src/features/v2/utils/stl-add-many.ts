// 여러 STL 을 한 번에 저장하는 순수 헬퍼 — 사고 방지 3차 ⑥ (C4 작은 쪽).
//   useStlFilesV2.addMany 가 repo.createStlFile 을 create 로 넘겨 쓴다(규칙 1 — 저장은 repo 경유).
//   목록 갱신(refresh)은 여기서 하지 않는다 — 부르는 쪽이 끝에 한 번. 파일마다 갱신하면 files 가 N번 바뀌어
//   앞 파일의 메시 로드가 취소·재파싱됐다(useFileMeshSync cancelled).

export interface AddManyItem {
  fileName: string;
  blob: Blob;
}

export interface AddManyResult<T> {
  /** 저장에 성공한 레코드 — 입력 순서 그대로. */
  created: T[];
  /** 저장에 실패한 파일 — 이름과 사유. */
  failed: { fileName: string; message: string }[];
}

/** 순서대로 create 를 부르고, 하나가 실패해도 나머지는 계속한다. refresh 는 부르는 쪽이 끝에 한 번. */
export async function addStlFilesSequential<T>(
  create: (fileName: string, blob: Blob) => Promise<T>,
  items: readonly AddManyItem[],
): Promise<AddManyResult<T>> {
  const created: T[] = [];
  const failed: { fileName: string; message: string }[] = [];
  for (const item of items) {
    try {
      created.push(await create(item.fileName, item.blob));
    } catch (e) {
      failed.push({
        fileName: item.fileName,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { created, failed };
}
