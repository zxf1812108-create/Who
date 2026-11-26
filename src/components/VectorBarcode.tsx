import React from 'react';

interface VectorBarcodeProps {
  descriptor: number[];
}

export const VectorBarcode: React.FC<VectorBarcodeProps> = ({ descriptor }) => {
  // Visualize all 128 real dimensions as normalized vertical bars
  const maxAbs = Math.max(
    0.25,
    ...descriptor.map((v) => Math.abs(v))
  );

  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-[1px] h-12 px-2 py-1.5 bg-[#F8F8F7] border border-neutral-200/80 rounded-xl overflow-hidden"
        aria-label="128维人脸特征向量分布图"
      >
        {descriptor.map((val, idx) => {
          const ratio = Math.min(1, Math.abs(val) / maxAbs);
          const heightPct = Math.max(12, Math.round(ratio * 100));
          const isPositive = val >= 0;
          return (
            <div
              key={idx}
              className="flex-1 flex items-center justify-center h-full"
            >
              <div
                className={`w-full rounded-[1px] ${
                  isPositive ? 'bg-neutral-900/80' : 'bg-neutral-400/65'
                }`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
        <span>维度: {descriptor.length}D Float32</span>
        <span>
          范围: [{Math.min(...descriptor).toFixed(3)}, {Math.max(...descriptor).toFixed(3)}]
        </span>
      </div>
    </div>
  );
};
