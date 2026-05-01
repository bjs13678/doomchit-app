import { useState, useRef, useEffect } from 'react';
import { Play, ChevronLeft, ChevronRight, ArrowLeft, Trophy } from 'lucide-react';

interface Clip {
  index: number;
  duration: number;
  video_url: string;
  thumb_url: string;
}

interface Props {
  clips: Clip[];
  jobId: string;
  apiUrl: string;
  onStartChallenge: (clipUrl: string, speed: number) => void; 
  onBack: () => void;
}

const SPEEDS = [
  { label: '매우 쉬움', rate: 0.5 },
  { label: '쉬움', rate: 0.75 },
  { label: '기본', rate: 1.0 },
  { label: '빠름', rate: 1.25 },
  { label: '매우 빠름', rate: 1.5 },
];

export default function Learn({ clips, jobId, apiUrl, onStartChallenge, onBack }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const totalClips = clips.length;
  const totalSteps = totalClips + 1; 
  const isFinalStep = currentIndex === totalClips;
  const current = !isFinalStep ? clips[currentIndex] : null;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleNext = () => {
    if (currentIndex < totalSteps - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsPlaying(false);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setIsPlaying(false);
    }
  };

  const handlePlayVideo = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-between py-10 px-4">
      <div className="w-full flex justify-between items-center mb-6">
        <button onClick={onBack} className="text-white p-2">
          <ArrowLeft size={28} />
        </button>
        <div className="text-white font-bold tracking-widest text-lg flex items-center gap-2">
          <span className="text-green-400">STEP {currentIndex + 1}</span> 
          <span className="text-white/30">/ {totalSteps}</span>
        </div>
        <div className="w-10"></div>
      </div>

      <div className="w-full max-w-sm mb-6">
        <div className="flex justify-between items-center bg-zinc-900 rounded-2xl p-2">
          {SPEEDS.map((speed) => (
            <button
              key={speed.label}
              onClick={() => setPlaybackRate(speed.rate)}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                playbackRate === speed.rate 
                  ? 'bg-white text-black shadow-md' 
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full max-w-sm aspect-[9/16] bg-black rounded-3xl overflow-hidden shadow-2xl flex-1 mb-8">
        {isFinalStep ? (
          <img 
            src={`${apiUrl}/thumb/${jobId}/0`} 
            alt="Final" 
            className="w-full h-full object-contain bg-black opacity-40 blur-sm" 
          />
        ) : (
          /* 💡 핵심 수정 포인트: object-cover -> object-contain bg-black */
          <video
            ref={videoRef}
            src={`${apiUrl}${current!.video_url}`}
            className="w-full h-full object-contain bg-black"
            onEnded={() => setIsPlaying(false)}
            playsInline
          />
        )}

        {!isPlaying && !isFinalStep && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm cursor-pointer" onClick={handlePlayVideo}>
            <div className="bg-white/20 p-5 rounded-full backdrop-blur-md">
              <Play size={40} className="text-white fill-white ml-1" />
            </div>
          </div>
        )}
        
        {isFinalStep && !isPlaying && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center w-full">
             <Trophy className="w-16 h-16 text-green-400 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)]" />
             <p className="text-white font-black text-2xl tracking-widest drop-shadow-md">FINAL STAGE</p>
             <p className="text-white/60 mt-2 font-bold">배운 동작을 하나로 이어서 도전!</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 w-full max-w-sm shrink-0 mb-4">
        <button 
          onClick={handlePrev} 
          disabled={currentIndex === 0} 
          className="flex-1 py-4 bg-zinc-900 rounded-2xl font-black text-white disabled:opacity-30 disabled:bg-transparent flex items-center justify-center transition-all hover:bg-zinc-800"
        >
          <ChevronLeft className="mr-1" />이전
        </button>
        <button 
          onClick={handleNext} 
          disabled={isFinalStep} 
          className="flex-1 py-4 bg-zinc-900 rounded-2xl font-black text-white disabled:opacity-30 disabled:bg-transparent flex items-center justify-center transition-all hover:bg-zinc-800"
        >
          다음<ChevronRight className="ml-1" />
        </button>
      </div>

      <button 
        onClick={() => onStartChallenge(isFinalStep ? `/full-video/${jobId}` : current!.video_url, playbackRate)} 
        className={`w-full max-w-sm py-5 font-black text-lg rounded-2xl flex items-center justify-center gap-3 shrink-0 transition-all ${
          isFinalStep 
            ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black shadow-[0_0_30px_rgba(74,222,128,0.4)] hover:scale-[1.02]' 
            : 'bg-white text-black hover:bg-gray-200'
        }`}
      >
        <Play fill="black" size={24} />
        {isFinalStep ? '최종 챌린지 시작!' : '이 동작 챌린지 시작!'}
      </button>
    </div>
  );
}
