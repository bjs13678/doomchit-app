import React, { useState, useRef } from 'react';
import { Upload, Palette, Video, Loader2 } from 'lucide-react';

const PRESET_COLORS = [
  { name: '초록', hex: '#00FF00' },
  { name: '시안 (파랑)', hex: '#00FFFF' },
  { name: '노랑', hex: '#FFFF00' },
  { name: '마젠타 (분홍)', hex: '#FF00FF' },
  { name: '흰색', hex: '#FFFFFF' },
];

interface Props {
  apiUrl: string;
  onUploadComplete: (jobId: string, clips: any[], userColor: string) => void;
}

export default function UploadComponent({ apiUrl, onUploadComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  
  // 💡 색상 상태 관리 (기본값 설정)
  const [userColor, setUserColor] = useState('#00FF00'); // 내 스틱맨 기본: 초록
  const [targetColor, setTargetColor] = useState('#00FFFF'); // 타겟 스틱맨 기본: 시안
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setStatusMessage('서버로 영상 전송 중...');

    const formData = new FormData();
    formData.append('file', file);
    // 💡 백엔드(server.py)로 타겟 색상 정보 전송!
    formData.append('targetColor', targetColor); 

    try {
      const response = await fetch(`${apiUrl}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      const jobId = data.job_id;

      // 분석 상태 폴링 (확인)
      const interval = setInterval(async () => {
        const statusRes = await fetch(`${apiUrl}/status/${job_id}`);
        const statusData = await statusRes.json();

        setProgress(statusData.progress);
        setStatusMessage(statusData.message);

        if (statusData.status === 'done') {
          clearInterval(interval);
          setIsUploading(false);
          // 💡 완료 시 App.tsx로 jobId, 영상 클립, 그리고 '내 스틱맨 색상'을 넘겨줌
          onUploadComplete(jobId, statusData.clips, userColor); 
        } else if (statusData.status === 'error') {
          clearInterval(interval);
          setIsUploading(false);
          alert('분석 중 오류가 발생했습니다.');
        }
      }, 2000);

    } catch (error) {
      console.error(error);
      setIsUploading(false);
      alert('업로드 실패!');
    }
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-900 rounded-3xl p-8 shadow-2xl flex flex-col items-center">
        
        <h1 className="text-3xl font-black text-white mb-2 tracking-tight">새 챌린지 준비</h1>
        <p className="text-zinc-400 font-bold mb-8 text-center">따라 할 영상을 올리고 스틱맨 색상을 맞춰보세요!</p>

        {/* 영상 업로드 영역 */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="w-full aspect-video bg-black rounded-2xl border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer hover:border-green-400 hover:bg-zinc-800/50 transition-all mb-8 relative overflow-hidden"
        >
          {file ? (
            <div className="flex flex-col items-center z-10">
              <Video size={48} className="text-green-400 mb-2" />
              <p className="text-white font-bold">{file.name}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center z-10 text-zinc-500">
              <Upload size={48} className="mb-2" />
              <p className="font-bold">터치하여 영상 선택</p>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" className="hidden" />
        </div>

        {/* 🎨 색상 선택 패널 */}
        <div className="w-full bg-black/50 p-5 rounded-2xl mb-8 border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="text-zinc-400" size={20} />
            <h2 className="text-white font-bold text-lg">스틱맨 색상 맞춤 설정</h2>
          </div>

          {/* 타겟 스틱맨 색상 (원본 영상) */}
          <div className="mb-6">
            <p className="text-sm font-bold text-zinc-400 mb-2 flex justify-between">
              <span>원본 영상 스틱맨 (AI 분석)</span>
              <input type="color" value={targetColor} onChange={(e) => setTargetColor(e.target.value)} className="w-6 h-6 rounded bg-transparent cursor-pointer" />
            </p>
            <div className="flex gap-2">
              {PRESET_COLORS.map(c => (
                <button 
                  key={`target-${c.hex}`} 
                  onClick={() => setTargetColor(c.hex)}
                  className={`flex-1 h-10 rounded-lg border-2 transition-all ${targetColor === c.hex ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* 내 동작 스틱맨 색상 (웹캠) */}
          <div>
            <p className="text-sm font-bold text-zinc-400 mb-2 flex justify-between">
              <span>내 동작 스틱맨 (웹캠)</span>
              <input type="color" value={userColor} onChange={(e) => setUserColor(e.target.value)} className="w-6 h-6 rounded bg-transparent cursor-pointer" />
            </p>
            <div className="flex gap-2">
              {PRESET_COLORS.map(c => (
                <button 
                  key={`user-${c.hex}`} 
                  onClick={() => setUserColor(c.hex)}
                  className={`flex-1 h-10 rounded-lg border-2 transition-all ${userColor === c.hex ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 업로드 버튼 및 진행률 */}
        {!isUploading ? (
          <button 
            onClick={handleUpload} 
            disabled={!file}
            className="w-full bg-green-400 text-black py-4 rounded-2xl font-black text-lg disabled:opacity-30 hover:bg-green-300 transition-all shadow-[0_0_20px_rgba(74,222,128,0.2)]"
          >
            분석 시작하기
          </button>
        ) : (
          <div className="w-full flex flex-col items-center">
            <Loader2 className="animate-spin text-green-400 mb-4" size={32} />
            <p className="text-white font-bold mb-2">{statusMessage}</p>
            <div className="w-full bg-zinc-800 h-4 rounded-full overflow-hidden">
              <div className="bg-green-400 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
