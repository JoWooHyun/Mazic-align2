interface MeshInfo {
  triangles: number;
  boundingSize: { x: number; y: number; z: number };
}

interface StatusBarProps {
  totalModels: number;
  selectedCount: number;
  selectedMeshInfo: MeshInfo | null;
  buildPlateSize: { width: number; depth: number; height: number };
  gizmoMode: string;
}

const StatusBar: React.FC<StatusBarProps> = ({
  totalModels,
  selectedCount,
  selectedMeshInfo,
  buildPlateSize,
  gizmoMode,
}) => {
  const modeLabels: Record<string, string> = {
    select: 'Select',
    move: 'Move',
    rotate: 'Rotate',
    scale: 'Scale',
  };

  return (
    <div className="h-7 bg-gray-800 border-t border-gray-700 flex items-center px-4 text-xs text-gray-400 space-x-6 flex-shrink-0">
      {/* Tool Mode */}
      <span>
        Mode: <span className="text-gray-200">{modeLabels[gizmoMode] || gizmoMode}</span>
      </span>

      {/* Separator */}
      <span className="text-gray-600">|</span>

      {/* Model Count */}
      <span>
        Models: <span className="text-gray-200">{selectedCount > 0 ? `${selectedCount}/${totalModels}` : totalModels}</span>
      </span>

      {/* Selected Mesh Info */}
      {selectedMeshInfo && (
        <>
          <span className="text-gray-600">|</span>
          <span>
            Triangles: <span className="text-gray-200">{selectedMeshInfo.triangles.toLocaleString()}</span>
          </span>
          <span className="text-gray-600">|</span>
          <span>
            Size: <span className="text-gray-200">
              {selectedMeshInfo.boundingSize.x.toFixed(1)} x {selectedMeshInfo.boundingSize.y.toFixed(1)} x {selectedMeshInfo.boundingSize.z.toFixed(1)} mm
            </span>
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Build Plate */}
      <span>
        Build: <span className="text-gray-200">{buildPlateSize.width} x {buildPlateSize.depth} x {buildPlateSize.height} mm</span>
      </span>
    </div>
  );
};

export default StatusBar;
