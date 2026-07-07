import { useState, useEffect } from 'react';
import {
  uploadSTLFile,
  getSTLFilesByProjectId,
  toggleSTLVisibility,
  deleteSTLFile,
  createAdjustmentLog,
  updateSTLTransform,
} from '@services/stl.service';
import type { STLFile, AdjustmentType, DeltaValue } from '@types/stl.types';

/**
 * STL 파일 관리 커스텀 훅
 */
export const useSTLFiles = (projectId?: string) => {
  const [stlFiles, setSTLFiles] = useState<STLFile[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * STL 파일 목록 조회
   */
  const fetchSTLFiles = async (projId: string) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch project files from backend
      const backendFiles = await getSTLFilesByProjectId(projId);

      console.log('[useSTLFiles] Loaded files from backend:', backendFiles.length);

      setSTLFiles(backendFiles);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch STL files';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  /**
   * STL 파일 업로드
   */
  const uploadFile = async (
    projId: string,
    file: File,
    userId: string
  ): Promise<STLFile | null> => {
    setLoading(true);
    setError(null);
    try {
      const newFile = await uploadSTLFile(projId, file, userId);
      setSTLFiles((prev) => [...prev, newFile]);
      return newFile;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload STL file';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * STL 파일 가시성 토글
   */
  const toggleVisibility = async (stlId: string, visibility: boolean): Promise<boolean> => {
    try {
      // Local files don't need backend update
      if (!stlId.startsWith('local-')) {
        await toggleSTLVisibility(stlId, visibility);
      }

      setSTLFiles((prev) =>
        prev.map((file) => (file.stlId === stlId ? { ...file, visibility } : file))
      );
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to toggle visibility';
      setError(errorMessage);
      return false;
    }
  };

  /**
   * STL 파일 삭제
   */
  const deleteFile = async (stlId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      // Local files don't need backend update
      if (!stlId.startsWith('local-')) {
        await deleteSTLFile(stlId);
      }

      setSTLFiles((prev) => prev.filter((file) => file.stlId !== stlId));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete STL file';
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * STL 조정 및 로그 생성
   */
  const adjustSTL = async (
    projId: string,
    stlId: string,
    userId: string,
    adjustmentType: AdjustmentType,
    deltaValue: DeltaValue,
    newTransform: STLFile['currentTransform']
  ): Promise<boolean> => {
    try {
      // 조정 로그 생성 (Skip for local files)
      if (!stlId.startsWith('local-')) {
        await createAdjustmentLog(projId, stlId, userId, adjustmentType, deltaValue);
        // Transform 업데이트
        await updateSTLTransform(stlId, newTransform);
      }

      // 로컬 상태 업데이트
      setSTLFiles((prev) =>
        prev.map((file) =>
          file.stlId === stlId ? { ...file, currentTransform: newTransform, previewTransform: undefined } : file
        )
      );

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to adjust STL';
      setError(errorMessage);
      return false;
    }
  };

  /**
   * STL 미리보기 (로그 없이 로컬 상태만 업데이트)
   */
  const previewSTL = (stlId: string, transform: STLFile['currentTransform']) => {
    setSTLFiles((prev) =>
      prev.map((file) =>
        file.stlId === stlId ? { ...file, previewTransform: transform } : file
      )
    );
  };

  /**
   * 로컬 STL 추가 (복사/붙여넣기 등 — 백엔드 미저장, 세션 한정)
   */
  const addLocalSTL = (file: STLFile) => {
    setSTLFiles((prev) => [...prev, file]);
  };

  // projectId가 제공되면 자동으로 STL 파일 목록 조회
  useEffect(() => {
    if (projectId) {
      fetchSTLFiles(projectId);
    }
  }, [projectId]);

  return {
    stlFiles,
    loading,
    error,
    fetchSTLFiles,
    uploadFile,
    toggleVisibility,
    deleteFile,
    adjustSTL,
    previewSTL,
    addLocalSTL,
  };
};
